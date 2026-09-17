-- Consumer Same Day V1: the recipient-identity seam, kept structurally inert.
--
-- Stripe Identity is NOT activated. This migration creates the evidence and
-- enforcement boundary a later, separately reviewed activation can use; it
-- creates no provider call, reads no provider key and cannot spend money.
--
-- Safety while the provider is absent is explicit:
--   * a protected-handoff request may be drafted/estimated but cannot leave
--     draft, so Couranr cannot authorize money or dispatch work it cannot finish;
--   * `unavailable` is recordable evidence but NEVER satisfies handoff;
--   * only a coherent `verified` result can authorize protected handoff;
--   * resolved evidence is immutable; an idempotent replay must be byte-equal.
--
-- This file owns the identity gate. 20260915120000 remains independently
-- reversible Stage 5a (seal condition only), so upgrading an already-migrated
-- database and rolling this migration back cannot leave a trigger whose writer
-- disappeared.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regclass('public.couranr_recipient_identity_verifications') is null
     or to_regclass('public.couranr_delivery_requests') is null
     or to_regclass('public.couranr_deliveries') is null then
    raise exception 'recipient_identity_preflight_missing_required_table';
  end if;
  if to_regprocedure('private.couranr_delivery_protection_level(uuid)') is null
     or to_regprocedure('private.couranr_enforce_consumer_dropoff_custody()') is null then
    raise exception 'recipient_identity_preflight_missing_stage_5a_function';
  end if;
end
$guard$;

/* A row is an evidence statement, not a bag of independently writable flags.
   Refuse unknown legacy shapes rather than rewriting them into a cleaner story. */
do $preflight$
declare
  v_bad bigint;
  v_live_protected bigint;
begin
  select count(*) into v_bad
    from public.couranr_recipient_identity_verifications r
   where not (
     (r.verification_state = 'verified'
       and nullif(btrim(coalesce(r.provider_reference,'')),'') is not null
       and r.identity_verified and r.adult_verified and r.authorized_recipient_match
       and r.verified_at is not null)
     or (r.verification_state = 'failed'
       and nullif(btrim(coalesce(r.provider_reference,'')),'') is not null
       and not (r.identity_verified and r.adult_verified and r.authorized_recipient_match)
       and (r.identity_verified or (not r.adult_verified and not r.authorized_recipient_match))
       and r.verified_at is null)
     or (r.verification_state in ('pending','processing')
       and nullif(btrim(coalesce(r.provider_reference,'')),'') is not null
       and not r.identity_verified and not r.adult_verified
       and not r.authorized_recipient_match and r.verified_at is null)
     or (r.verification_state = 'unavailable'
       and r.provider_reference is null
       and not r.identity_verified and not r.adult_verified
       and not r.authorized_recipient_match and r.verified_at is null)
     or (r.verification_state = 'canceled'
       and not r.identity_verified and not r.adult_verified
       and not r.authorized_recipient_match and r.verified_at is null)
   );
  if v_bad <> 0 then
    raise exception 'recipient_identity_preflight_incoherent_rows:%', v_bad;
  end if;
  select count(*) into v_live_protected
    from public.couranr_delivery_requests
   where requester_kind='consumer'
     and protection_level='protected_handoff'
     and request_state not in ('draft','awaiting_merchant_confirmation');
  if v_live_protected <> 0 then
    raise exception 'recipient_identity_preflight_live_protected_handoffs:%', v_live_protected;
  end if;
end
$preflight$;

alter table public.couranr_recipient_identity_verifications
  drop constraint if exists couranr_riv_outcome_coherence_chk;
alter table public.couranr_recipient_identity_verifications
  add constraint couranr_riv_outcome_coherence_chk check (
    (verification_state = 'verified'
      and nullif(btrim(coalesce(provider_reference,'')),'') is not null
      and identity_verified and adult_verified and authorized_recipient_match
      and verified_at is not null)
    or (verification_state = 'failed'
      and nullif(btrim(coalesce(provider_reference,'')),'') is not null
      and not (identity_verified and adult_verified and authorized_recipient_match)
      and (identity_verified or (not adult_verified and not authorized_recipient_match))
      and verified_at is null)
    or (verification_state in ('pending','processing')
      and nullif(btrim(coalesce(provider_reference,'')),'') is not null
      and not identity_verified and not adult_verified
      and not authorized_recipient_match and verified_at is null)
    or (verification_state = 'unavailable'
      and provider_reference is null
      and not identity_verified and not adult_verified
      and not authorized_recipient_match and verified_at is null)
    or (verification_state = 'canceled'
      and not identity_verified and not adult_verified
      and not authorized_recipient_match and verified_at is null)
  );

/* Provider capability does not exist yet. Refuse before commercial acceptance,
   not at the recipient's door after money and dispatch. A later activation
   migration removes this trigger only when a real provider path and its tests
   exist. Draft/estimate remains available so Couranr can show the safe reason. */
create or replace function private.couranr_block_unavailable_protected_handoff()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
begin
  if new.requester_kind = 'consumer'
     and new.protection_level = 'protected_handoff'
     and new.request_state not in ('draft','awaiting_merchant_confirmation')
     and (tg_op='INSERT'
       or old.request_state is distinct from new.request_state
       or old.protection_level is distinct from new.protection_level
       or old.requester_kind is distinct from new.requester_kind) then
    raise exception 'protected_handoff_identity_unavailable' using errcode='CR409';
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_block_unavailable_protected_handoff()
  from public,anon,authenticated,service_role;

drop trigger if exists couranr_dr_block_unavailable_protected_handoff
  on public.couranr_delivery_requests;
create trigger couranr_dr_block_unavailable_protected_handoff
  before insert or update of request_state,protection_level,requester_kind
  on public.couranr_delivery_requests
  for each row execute function private.couranr_block_unavailable_protected_handoff();

create or replace function public.couranr_record_recipient_identity_verification(
  p_delivery_id uuid,
  p_state text,
  p_provider_reference text,
  p_identity_verified boolean,
  p_adult_verified boolean,
  p_authorized_recipient_match boolean,
  p_policy_version text
)
returns public.couranr_recipient_identity_verifications
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_level text;
  v_row public.couranr_recipient_identity_verifications;
  v_ref text := nullif(btrim(coalesce(p_provider_reference,'')),'');
  v_verified_at timestamptz;
begin
  v_level := private.couranr_delivery_protection_level(p_delivery_id);
  if v_level is distinct from 'protected_handoff' then
    raise exception 'identity_verification_not_required' using errcode='CR422';
  end if;
  if p_state is null
     or p_state not in ('pending','processing','verified','failed','unavailable','canceled') then
    raise exception 'identity_state_invalid' using errcode='CR422';
  end if;
  if p_policy_version is null or btrim(p_policy_version) = '' then
    raise exception 'identity_policy_version_required' using errcode='CR422';
  end if;
  if p_identity_verified is null or p_adult_verified is null
     or p_authorized_recipient_match is null then
    raise exception 'identity_flags_required' using errcode='CR422';
  end if;

  if p_state = 'verified' and (
       v_ref is null or p_identity_verified is not true
       or p_adult_verified is not true or p_authorized_recipient_match is not true
     ) then
    raise exception 'verified_identity_evidence_incomplete' using errcode='CR422';
  end if;
  if p_state in ('pending','processing') and (
       v_ref is null or p_identity_verified or p_adult_verified or p_authorized_recipient_match
     ) then
    raise exception 'identity_in_progress_evidence_invalid' using errcode='CR422';
  end if;
  if p_state = 'failed' and (
       v_ref is null
       or (p_identity_verified and p_adult_verified and p_authorized_recipient_match)
       or (not p_identity_verified and (p_adult_verified or p_authorized_recipient_match))
     ) then
    raise exception 'failed_identity_evidence_invalid' using errcode='CR422';
  end if;
  if p_state = 'unavailable' and (
       v_ref is not null or p_identity_verified or p_adult_verified or p_authorized_recipient_match
     ) then
    raise exception 'unavailable_identity_evidence_invalid' using errcode='CR422';
  end if;
  if p_state = 'canceled' and (
       p_identity_verified or p_adult_verified or p_authorized_recipient_match
     ) then
    raise exception 'canceled_identity_evidence_invalid' using errcode='CR422';
  end if;

  v_verified_at := case when p_state='verified' then now() end;

  select * into v_row
    from public.couranr_recipient_identity_verifications
   where delivery_id=p_delivery_id and verification_state<>'canceled'
   for update;

  if found then
    /* A terminal replay is idempotent only when it says exactly the same thing.
       Purged provider references are the sole exception: a later webhook may
       not rehydrate a reference Couranr deliberately removed. */
    if v_row.verification_state in ('verified','failed','unavailable') then
      if v_row.verification_state is distinct from p_state
         or v_row.identity_verified is distinct from p_identity_verified
         or v_row.adult_verified is distinct from p_adult_verified
         or v_row.authorized_recipient_match is distinct from p_authorized_recipient_match
         or v_row.policy_version is distinct from btrim(p_policy_version)
         or (v_row.provider_reference_purged_at is null
           and v_row.provider_reference is distinct from v_ref) then
        raise exception 'identity_verification_already_resolved' using errcode='CR409';
      end if;
      return v_row;
    end if;

    if v_row.policy_version is distinct from btrim(p_policy_version)
       or (v_row.provider_reference is not null and v_row.provider_reference is distinct from v_ref)
       or not (
         (v_row.verification_state='pending' and p_state in ('pending','processing','verified','failed','canceled'))
         or (v_row.verification_state='processing' and p_state in ('processing','verified','failed','canceled'))
       ) then
      raise exception 'identity_verification_transition_invalid' using errcode='CR409';
    end if;

    update public.couranr_recipient_identity_verifications set
      provider_reference=coalesce(provider_reference,v_ref),
      identity_verified=p_identity_verified,
      adult_verified=p_adult_verified,
      authorized_recipient_match=p_authorized_recipient_match,
      verification_state=p_state,
      verified_at=v_verified_at,
      updated_at=now()
    where id=v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into public.couranr_recipient_identity_verifications(
    delivery_id,provider,provider_reference,identity_verified,adult_verified,
    authorized_recipient_match,verification_state,verified_at,policy_version
  ) values (
    p_delivery_id,'stripe_identity',v_ref,p_identity_verified,p_adult_verified,
    p_authorized_recipient_match,p_state,v_verified_at,btrim(p_policy_version)
  ) returning * into v_row;
  return v_row;
end
$fn$;

comment on function public.couranr_record_recipient_identity_verification is
  'Records coherent minimal recipient-identity evidence for protected handoff. '
  'Resolved rows are immutable; an idempotent replay must be evidence-equal. '
  'No provider call is implemented or activated by this function.';

revoke all on function public.couranr_record_recipient_identity_verification(
  uuid,text,text,boolean,boolean,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_record_recipient_identity_verification(
  uuid,text,text,boolean,boolean,boolean,text)
  to service_role;

/* Identity and recipient adult attestation are both custody prerequisites for
   protected handoff. `unavailable` is evidence, never authorization. */
create or replace function private.couranr_enforce_consumer_dropoff_custody()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_level text;
  v_condition text;
  v_request public.couranr_delivery_requests;
  v_identity public.couranr_recipient_identity_verifications;
begin
  if old.fulfillment_state<>'at_dropoff' or new.fulfillment_state<>'delivered' then
    return new;
  end if;

  v_level := private.couranr_delivery_protection_level(new.id);
  if v_level is null or v_level not in ('secure_pickup','protected_handoff') then
    return new;
  end if;
  if v_level='protected_handoff' and new.proof_method='leave_at_door' then
    raise exception 'protected_handoff_forbids_leave_at_door' using errcode='CR409';
  end if;

  select dropoff_condition into v_condition
    from public.couranr_delivery_security_seals where delivery_id=new.id;
  if v_condition is null then
    raise exception 'seal_condition_required_at_dropoff' using errcode='CR409';
  end if;

  if v_level='protected_handoff' then
    select r.* into v_request
      from public.couranr_delivery_requests r where r.id=new.request_id;
    if v_request.requester_kind='consumer'
       and v_request.recipient_adult_attested_at is null then
      raise exception 'recipient_adult_attestation_required' using errcode='CR409';
    end if;

    select r.* into v_identity
      from public.couranr_recipient_identity_verifications r
     where r.delivery_id=new.id and r.verification_state<>'canceled'
     limit 1;
    if not found then
      raise exception 'recipient_identity_verification_required' using errcode='CR409';
    end if;
    if v_identity.verification_state<>'verified'
       or not v_identity.identity_verified
       or not v_identity.adult_verified
       or not v_identity.authorized_recipient_match
       or v_identity.provider_reference is null then
      raise exception 'recipient_identity_not_verified' using errcode='CR409';
    end if;
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_enforce_consumer_dropoff_custody()
  from public,anon,authenticated,service_role;

drop trigger if exists couranr_deliveries_consumer_dropoff_custody
  on public.couranr_deliveries;
create trigger couranr_deliveries_consumer_dropoff_custody
  before update on public.couranr_deliveries
  for each row execute function private.couranr_enforce_consumer_dropoff_custody();

commit;
