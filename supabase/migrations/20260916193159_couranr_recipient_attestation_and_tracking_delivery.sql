-- Consumer Same Day V1 Stage 6: recipient-held tracking and adult attestation.
--
-- Reuses couranr_delivery_access_tokens. Its audience has always been fixed to
-- `recipient`; no second token system or browser-chosen audience is introduced.
-- The raw token remains ephemeral and hash-only in PostgreSQL.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regclass('public.couranr_delivery_access_tokens') is null
     or to_regclass('public.couranr_delivery_requests') is null
     or to_regclass('public.couranr_delivery_request_events') is null then
    raise exception 'recipient_attestation_preflight_missing_required_table';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='couranr_delivery_requests'
       and column_name='recipient_adult_attested_at'
  ) then
    raise exception 'recipient_attestation_preflight_missing_stage_2_column';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='couranr_delivery_requests'
       and column_name='recipient_attestation_version'
  ) or exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='couranr_delivery_access_tokens'
       and column_name in (
         'recipient_notification_claimed_at','recipient_notified_at',
         'recipient_notification_provider_id'
       )
  ) or to_regprocedure(
    'public.couranr_attest_recipient_adult(text,text,boolean)'
  ) is not null then
    raise exception 'recipient_attestation_preflight_already_applied_or_partial';
  end if;
  if exists (
    select 1 from public.couranr_delivery_requests
     where recipient_adult_attested_at is not null limit 1
  ) then
    raise exception 'recipient_attestation_preflight_unversioned_evidence_exists';
  end if;
end
$guard$;

alter table public.couranr_delivery_requests
  add column recipient_attestation_version text;

comment on column public.couranr_delivery_requests.recipient_attestation_version is
  'Version of the recipient adult-attestation statement accepted through the '
  'recipient-audience tracking credential. Paired with recipient_adult_attested_at.';

alter table public.couranr_delivery_requests
  add constraint couranr_dr_recipient_attestation_evidence_chk check (
    (recipient_attestation_version is null and recipient_adult_attested_at is null)
    or (nullif(btrim(coalesce(recipient_attestation_version,'')),'') is not null
      and recipient_adult_attested_at is not null)
  );

create function private.couranr_freeze_recipient_attestation_version()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
begin
  if old.recipient_attestation_version is not null
     and new.recipient_attestation_version is distinct from old.recipient_attestation_version then
    raise exception 'recipient_attestation_evidence_is_append_only' using errcode='CR409';
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_freeze_recipient_attestation_version()
  from public,anon,authenticated,service_role;

create trigger couranr_dr_freeze_recipient_attestation_version
  before update on public.couranr_delivery_requests
  for each row execute function private.couranr_freeze_recipient_attestation_version();

alter table public.couranr_delivery_access_tokens
  add column recipient_notification_claimed_at timestamptz,
  add column recipient_notified_at timestamptz,
  add column recipient_notification_provider_id text;

alter table public.couranr_delivery_access_tokens
  add constraint couranr_dat_recipient_notification_pair_chk check (
    (recipient_notified_at is null and recipient_notification_provider_id is null)
    or (recipient_notified_at is not null
      and recipient_notification_claimed_at is not null
      and nullif(btrim(coalesce(recipient_notification_provider_id,'')),'') is not null)
  );

comment on column public.couranr_delivery_access_tokens.recipient_notified_at is
  'When the existing recipient-audience tracking link was accepted by the email provider. '
  'Null means a crashed/incomplete dispatch is safe to revoke and replace.';

create function public.couranr_claim_consumer_recipient_tracking_delivery(
  p_request_id uuid,
  p_token_hash text,
  p_ttl_days integer
)
returns table(outcome text, token_id uuid, expires_at timestamptz)
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_request public.couranr_delivery_requests;
  v_token public.couranr_delivery_access_tokens;
  v_ttl integer := least(greatest(coalesce(p_ttl_days,30),1),30);
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR422';
  end if;

  select r.* into v_request from public.couranr_delivery_requests r
   where r.id=p_request_id for update;
  if not found or v_request.requester_kind<>'consumer'
     or v_request.business_account_id is not null
     or v_request.request_state<>'confirmed'
     or v_request.protection_policy_version is null
     or nullif(btrim(coalesce(v_request.recipient_email,'')),'') is null then
    raise exception 'consumer_recipient_tracking_not_available' using errcode='CR409';
  end if;

  select t.* into v_token from public.couranr_delivery_access_tokens t
   where t.request_id=v_request.id and t.revoked_at is null and t.expires_at>now()
   order by t.created_at desc limit 1 for update;

  if found and v_token.recipient_notified_at is not null then
    return query select 'sent'::text,v_token.id,v_token.expires_at;
    return;
  end if;
  if found and v_token.recipient_notification_claimed_at > now()-interval '2 minutes' then
    return query select 'in_progress'::text,v_token.id,v_token.expires_at;
    return;
  end if;
  if found then
    update public.couranr_delivery_access_tokens
       set revoked_at=now(),revoked_reason='recipient_notification_claim_expired'
     where id=v_token.id;
  end if;

  insert into public.couranr_delivery_access_tokens(
    request_id,business_account_id,token_hash,audience,expires_at,
    recipient_notification_claimed_at
  ) values (
    v_request.id,null,p_token_hash,'recipient',now()+make_interval(days=>v_ttl),now()
  ) returning * into v_token;

  return query select 'issued'::text,v_token.id,v_token.expires_at;
end
$fn$;

alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft','create_hosted_delivery_request',
    'calculate_delivery_request_estimate','create_quote_version',
    'submit_delivery_request','validate_hosted_delivery_request',
    'begin_delivery_request_review','accept_delivery_request_as_quoted',
    'auto_accept_delivery_request','auto_plan_delivery_request',
    'requote_delivery_request','decline_delivery_request',
    'record_payer_quote_approval','begin_delivery_preparation',
    'mark_delivery_ready','mark_delivery_not_ready','mark_delivery_unavailable',
    'cancel_delivery_request','apply_promotional_credit','record_consumer_trust',
    'record_recipient_adult_attestation'
  ));

create function public.couranr_mark_recipient_tracking_notification(
  p_token_hash text,
  p_provider_id text
)
returns public.couranr_delivery_access_tokens
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_token public.couranr_delivery_access_tokens;
  v_request public.couranr_delivery_requests;
  v_provider_id text := nullif(btrim(coalesce(p_provider_id,'')),'');
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR422';
  end if;
  if v_provider_id is null then
    raise exception 'notification_provider_id_required' using errcode='CR422';
  end if;

  select t.* into v_token from public.couranr_delivery_access_tokens t
   where t.token_hash=p_token_hash for update;
  if not found or v_token.revoked_at is not null or v_token.expires_at<=now()
     or v_token.audience<>'recipient' then
    raise exception 'tracking_token_not_available' using errcode='CR404';
  end if;
  if v_token.recipient_notification_claimed_at is null then
    raise exception 'recipient_notification_not_claimed' using errcode='CR409';
  end if;

  select r.* into v_request from public.couranr_delivery_requests r
   where r.id=v_token.request_id;
  if not found or v_request.requester_kind<>'consumer'
     or v_request.business_account_id is not null
     or v_request.protection_policy_version is null
     or nullif(btrim(coalesce(v_request.recipient_email,'')),'') is null then
    raise exception 'recipient_notification_not_allowed' using errcode='CR422';
  end if;

  if v_token.recipient_notified_at is not null then
    if v_token.recipient_notification_provider_id is distinct from v_provider_id then
      raise exception 'recipient_notification_already_recorded' using errcode='CR409';
    end if;
    return v_token;
  end if;

  update public.couranr_delivery_access_tokens set
    recipient_notified_at=now(),
    recipient_notification_provider_id=v_provider_id
  where id=v_token.id
  returning * into v_token;
  return v_token;
end
$fn$;

create function public.couranr_fail_recipient_tracking_notification(
  p_token_hash text,
  p_reason text
)
returns boolean
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_token public.couranr_delivery_access_tokens;
  v_reason text := left(
    regexp_replace(coalesce(nullif(btrim(p_reason),''),'provider_send_failed'), '[^a-z0-9_:-]+', '_', 'gi'),
    120
  );
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR422';
  end if;

  select t.* into v_token from public.couranr_delivery_access_tokens t
   where t.token_hash=p_token_hash for update;
  if not found then
    return false;
  end if;
  if v_token.recipient_notified_at is not null then
    raise exception 'recipient_notification_already_recorded' using errcode='CR409';
  end if;
  if v_token.revoked_at is not null then
    return true;
  end if;

  update public.couranr_delivery_access_tokens
     set revoked_at=now(),revoked_reason=v_reason
   where id=v_token.id;
  return true;
end
$fn$;

create function public.couranr_attest_recipient_adult(
  p_token_hash text,
  p_attestation_version text,
  p_accept boolean
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_token public.couranr_delivery_access_tokens;
  v_request public.couranr_delivery_requests;
  v_delivery public.couranr_deliveries;
  v_version text := nullif(btrim(coalesce(p_attestation_version,'')),'');
begin
  if p_accept is not true then
    raise exception 'recipient_adult_attestation_required' using errcode='CR422';
  end if;
  if v_version is null then
    raise exception 'recipient_attestation_version_required' using errcode='CR422';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'tracking_token_not_available' using errcode='CR404';
  end if;

  select t.* into v_token from public.couranr_delivery_access_tokens t
   where t.token_hash=p_token_hash for update;
  if not found or v_token.revoked_at is not null or v_token.expires_at<=now()
     or v_token.audience<>'recipient' then
    raise exception 'tracking_token_not_available' using errcode='CR404';
  end if;

  select r.* into v_request from public.couranr_delivery_requests r
   where r.id=v_token.request_id for update;
  if not found or v_request.requester_kind<>'consumer'
     or v_request.business_account_id is not null
     or v_request.protection_policy_version is null
     or v_request.protection_level<>'protected_handoff'
     or v_request.request_state<>'confirmed' then
    raise exception 'recipient_attestation_not_allowed' using errcode='CR409';
  end if;

  select d.* into v_delivery from public.couranr_deliveries d
   where d.request_id=v_request.id;
  if found and v_delivery.fulfillment_state in (
    'delivered','could_not_deliver','cancelled','return_required','returning','returned'
  ) then
    raise exception 'recipient_attestation_too_late' using errcode='CR409';
  end if;

  if v_request.recipient_adult_attested_at is not null then
    if v_request.recipient_attestation_version is distinct from v_version then
      raise exception 'recipient_attestation_already_recorded' using errcode='CR409';
    end if;
    return v_request;
  end if;

  update public.couranr_delivery_requests set
    recipient_attestation_version=v_version,
    recipient_adult_attested_at=now(),
    version=version+1,
    updated_at=now()
  where id=v_request.id
  returning * into v_request;

  update public.couranr_delivery_access_tokens
     set last_used_at=now() where id=v_token.id;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_request.id,null,'customer','record_recipient_adult_attestation',
    v_request.request_state,v_request.request_state,
    jsonb_build_object(
      'attestationVersion',v_version,
      'audience','recipient'
    )
  );
  return v_request;
end
$fn$;

comment on function public.couranr_attest_recipient_adult is
  'Records a versioned 18+ attestation from the active recipient-audience '
  'tracking credential for a governed protected handoff. Stores no raw token.';

comment on table public.couranr_delivery_access_tokens is
  'Hash-only recipient tracking capabilities. Read access remains scoped to one '
  'request; the sole write authority available through the recipient token is '
  'the versioned adult-attestation command for a governed protected handoff.';

revoke all on function public.couranr_mark_recipient_tracking_notification(text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_fail_recipient_tracking_notification(text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_claim_consumer_recipient_tracking_delivery(uuid,text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_attest_recipient_adult(text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_claim_consumer_recipient_tracking_delivery(uuid,text,integer)
  to service_role;
grant execute on function public.couranr_mark_recipient_tracking_notification(text,text)
  to service_role;
grant execute on function public.couranr_fail_recipient_tracking_notification(text,text)
  to service_role;
grant execute on function public.couranr_attest_recipient_adult(text,text,boolean)
  to service_role;

commit;
