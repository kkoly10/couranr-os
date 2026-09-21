-- Durable, email-addressed sender access for direct Consumer Same Day.
-- Distinct audience on the existing hashed delivery-token substrate. A sender
-- token is NEVER a recipient tracking/attestation/PIN token. Recovery rotates
-- the single bound guest session; it never creates a new request or fake tenant.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$ begin
  if to_regclass('public.couranr_delivery_access_tokens') is null
     or to_regclass('public.couranr_consumer_guest_sessions') is null then
    raise exception 'sender_access_unknown_schema';
  end if;
  if exists (select 1 from public.couranr_delivery_access_tokens where audience <> 'recipient') then
    raise exception 'sender_access_unknown_existing_audience';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid='public.couranr_delivery_access_tokens'::regclass
                    and conname='couranr_dat_audience_chk') then
    raise exception 'sender_access_missing_audience_guard';
  end if;
end $$;

alter table public.couranr_delivery_access_tokens
  drop constraint couranr_dat_audience_chk;
alter table public.couranr_delivery_access_tokens
  add constraint couranr_dat_audience_chk check (audience in ('recipient','sender'));

-- The existing consumer claim used to select the newest LIVE token without
-- an audience predicate. A sender email arriving first would otherwise be
-- mistaken for the recipient's delivered invitation and block that email.
create or replace function public.couranr_claim_consumer_recipient_tracking_delivery(
  p_request_id uuid,p_token_hash text,p_ttl_days integer
)
returns table(outcome text,token_id uuid,expires_at timestamptz)
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_request public.couranr_delivery_requests;
  v_token public.couranr_delivery_access_tokens;
  v_ttl integer:=least(greatest(coalesce(p_ttl_days,30),1),30);
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
   where t.request_id=v_request.id and t.audience='recipient'
     and t.revoked_at is null and t.expires_at>now()
   order by t.created_at desc limit 1 for update;
  if found and v_token.recipient_notified_at is not null then
    return query select 'sent'::text,v_token.id,v_token.expires_at; return;
  end if;
  if found and v_token.recipient_notification_claimed_at>now()-interval '2 minutes' then
    return query select 'in_progress'::text,v_token.id,v_token.expires_at; return;
  end if;
  if found then
    update public.couranr_delivery_access_tokens
       set revoked_at=now(),revoked_reason='recipient_notification_claim_expired'
     where id=v_token.id;
  end if;
  insert into public.couranr_delivery_access_tokens(
    request_id,business_account_id,token_hash,audience,expires_at,
    recipient_notification_claimed_at
  ) values (v_request.id,null,p_token_hash,'recipient',
            now()+make_interval(days=>v_ttl),now()) returning * into v_token;
  return query select 'issued'::text,v_token.id,v_token.expires_at;
end
$fn$;

-- The manually-issued tracking-link path likewise replaces recipient links
-- only, never a sender's distinct recovery capability.
create or replace function public.couranr_issue_delivery_access_token(
  p_request_id uuid,p_token_hash text,p_ttl_days integer
)
returns public.couranr_delivery_access_tokens
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_token public.couranr_delivery_access_tokens;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR422';
  end if;
  select r.* into v_req from public.couranr_delivery_requests r where r.id=p_request_id;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state<>'confirmed' then
    raise exception 'request_not_trackable' using errcode='CR409';
  end if;
  update public.couranr_delivery_access_tokens t
     set revoked_at=now(),revoked_reason='replaced_by_new_link'
   where t.request_id=p_request_id and t.audience='recipient' and t.revoked_at is null;
  insert into public.couranr_delivery_access_tokens(
    request_id,business_account_id,token_hash,audience,expires_at
  ) values(v_req.id,v_req.business_account_id,p_token_hash,'recipient',
           now()+make_interval(days=>least(greatest(coalesce(p_ttl_days,30),1),30)))
  returning * into v_token;
  return v_token;
end
$fn$;

create or replace function public.couranr_redeem_delivery_access_token(p_token_hash text)
returns table(valid boolean, reason text, request_id uuid, delivery_id uuid,
              business_account_id uuid, request_state text)
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_tok public.couranr_delivery_access_tokens;
  v_req public.couranr_delivery_requests;
  v_delivery_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select false,'not_found'::text,null::uuid,null::uuid,null::uuid,null::text;
    return;
  end if;
  select t.* into v_tok from public.couranr_delivery_access_tokens t
   where t.token_hash=p_token_hash and t.audience='recipient';
  if not found or v_tok.revoked_at is not null or v_tok.expires_at<=now() then
    return query select false,'not_found'::text,null::uuid,null::uuid,null::uuid,null::text;
    return;
  end if;
  select r.* into v_req from public.couranr_delivery_requests r where r.id=v_tok.request_id;
  if not found then
    return query select false,'not_found'::text,null::uuid,null::uuid,null::uuid,null::text;
    return;
  end if;
  select d.id into v_delivery_id from public.couranr_deliveries d where d.request_id=v_req.id;
  update public.couranr_delivery_access_tokens t set last_used_at=now() where t.id=v_tok.id;
  return query select true,null::text,v_req.id,v_delivery_id,
                      v_req.business_account_id,v_req.request_state;
end
$fn$;

create function public.couranr_issue_sender_access_token(
  p_request_id uuid, p_token_hash text, p_ttl_days integer
)
returns public.couranr_delivery_access_tokens
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_token public.couranr_delivery_access_tokens;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'sender_token_not_available' using errcode='CR404';
  end if;
  select r.* into v_req from public.couranr_delivery_requests r where r.id=p_request_id;
  if not found or v_req.requester_kind<>'consumer' or v_req.business_account_id is not null
     or v_req.request_state not in ('pending_couranr_review','confirmed')
     or nullif(btrim(coalesce(v_req.consumer_contact_snapshot->>'email','')),'') is null then
    raise exception 'sender_token_not_available' using errcode='CR404';
  end if;
  insert into public.couranr_delivery_access_tokens(
    request_id,business_account_id,token_hash,audience,expires_at
  ) values (
    v_req.id,null,p_token_hash,'sender',
    now()+make_interval(days=>least(greatest(coalesce(p_ttl_days,30),1),30))
  ) returning * into v_token;
  return v_token;
end
$fn$;

create function public.couranr_recover_sender_guest_session(
  p_sender_token_hash text, p_new_guest_token_hash text
)
returns public.couranr_consumer_guest_sessions
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_token public.couranr_delivery_access_tokens;
  v_session public.couranr_consumer_guest_sessions;
begin
  if p_sender_token_hash is null or p_sender_token_hash !~ '^[0-9a-f]{64}$'
     or p_new_guest_token_hash is null or p_new_guest_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'sender_link_not_available' using errcode='CR404';
  end if;
  select t.* into v_token from public.couranr_delivery_access_tokens t
   where t.token_hash=p_sender_token_hash and t.audience='sender' for update;
  if not found or v_token.revoked_at is not null or v_token.expires_at<=now() then
    raise exception 'sender_link_not_available' using errcode='CR404';
  end if;
  if not exists(select 1 from public.couranr_delivery_requests r
                 where r.id=v_token.request_id and r.requester_kind='consumer'
                   and r.business_account_id is null) then
    raise exception 'sender_link_not_available' using errcode='CR404';
  end if;
  select s.* into v_session from public.couranr_consumer_guest_sessions s
   where s.request_id=v_token.request_id for update;
  if not found or v_session.revoked_at is not null then
    raise exception 'sender_link_not_available' using errcode='CR404';
  end if;
  update public.couranr_consumer_guest_sessions s
     set token_hash=p_new_guest_token_hash,
         expires_at=now()+interval '3 days', last_used_at=now()
   where s.id=v_session.id returning s.* into v_session;
  update public.couranr_delivery_access_tokens t set last_used_at=now() where t.id=v_token.id;
  return v_session;
end
$fn$;

revoke all on function public.couranr_issue_sender_access_token(uuid,text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_recover_sender_guest_session(text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_issue_sender_access_token(uuid,text,integer) to service_role;
grant execute on function public.couranr_recover_sender_guest_session(text,text) to service_role;
commit;
