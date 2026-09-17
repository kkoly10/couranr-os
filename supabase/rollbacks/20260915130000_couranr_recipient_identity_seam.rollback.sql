-- Compatibility rollback for the inert recipient-identity seam.
--
-- It restores Stage 5a's seal-only handoff trigger. It refuses once identity
-- evidence or a submitted protected-handoff request exists: removing the gate
-- after either fact exists would reinterpret commercial/custody history.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if exists (select 1 from public.couranr_recipient_identity_verifications limit 1) then
    raise exception 'refusing_identity_seam_rollback_with_identity_evidence';
  end if;
  if exists (
    select 1 from public.couranr_delivery_requests
     where protection_level='protected_handoff'
       and request_state not in ('draft','awaiting_merchant_confirmation')
     limit 1
  ) then
    raise exception 'refusing_identity_seam_rollback_with_live_protected_handoff';
  end if;
end
$guard$;

drop trigger if exists couranr_dr_block_unavailable_protected_handoff
  on public.couranr_delivery_requests;
drop function if exists private.couranr_block_unavailable_protected_handoff() restrict;

drop function if exists public.couranr_record_recipient_identity_verification(
  uuid,text,text,boolean,boolean,boolean,text) restrict;

alter table public.couranr_recipient_identity_verifications
  drop constraint if exists couranr_riv_outcome_coherence_chk;

/* Exact Stage 5a behavior: seal check and protected leave-at-door ban, with no
   identity dependency and therefore no writer/trigger split after rollback. */
create or replace function private.couranr_enforce_consumer_dropoff_custody()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_level text;
  v_condition text;
begin
  if old.fulfillment_state <> 'at_dropoff' or new.fulfillment_state <> 'delivered' then
    return new;
  end if;
  v_level := private.couranr_delivery_protection_level(new.id);
  if v_level is null or v_level not in ('secure_pickup','protected_handoff') then
    return new;
  end if;
  if v_level = 'protected_handoff' and new.proof_method = 'leave_at_door' then
    raise exception 'protected_handoff_forbids_leave_at_door' using errcode='CR409';
  end if;
  select dropoff_condition into v_condition
    from public.couranr_delivery_security_seals where delivery_id = new.id;
  if v_condition is null then
    raise exception 'seal_condition_required_at_dropoff' using errcode='CR409';
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
