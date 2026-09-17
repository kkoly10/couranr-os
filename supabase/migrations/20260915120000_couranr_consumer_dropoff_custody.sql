-- Consumer Same Day V1: the custody chain CLOSES at handoff.
--
-- Stage 4 sealed the shipment at pickup and proved the credential came last.
-- Nothing checked the seal again. A tamper-evident seal that is never looked at
-- is a sticker: its entire value is the comparison between what was applied and
-- what arrived, and until now couranr_delivery_security_seals.dropoff_condition
-- existed with its constraints and no writer at all.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: refuse the delivery when the seal is
-- damaged or missing. The driver records what they see, and a rule that blocked
-- completion on a broken seal would give the one person holding the package a
-- reason to report it intact. Recording the truth has to be the cheapest path.
-- A damaged or missing seal is an Operations matter through the existing
-- incident system, not a reason to strand a recipient's parcel on a doorstep.

begin;

create or replace function public.couranr_record_seal_condition(
  p_delivery_id uuid,
  p_actor_user_id uuid,
  p_condition text
)
returns public.couranr_delivery_security_seals
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_level text;
  v_seal public.couranr_delivery_security_seals;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  v_level := private.couranr_delivery_protection_level(p_delivery_id);
  if v_level is null or v_level not in ('secure_pickup','protected_handoff') then
    raise exception 'seal_not_required_for_delivery' using errcode='CR422';
  end if;

  if p_condition is null or p_condition not in ('intact','damaged','missing') then
    raise exception 'seal_condition_invalid' using errcode='CR422';
  end if;

  select * into v_seal from public.couranr_delivery_security_seals
   where delivery_id = p_delivery_id
   for update;
  if not found then
    raise exception 'security_seal_required' using errcode='CR409';
  end if;

  /* APPEND-ONLY, the same rule the consent evidence follows. A driver who could
     revise the condition after recording it could record 'damaged' at the door,
     see the reaction, and change it to 'intact'. One observation, one record. */
  if v_seal.dropoff_condition is not null then
    raise exception 'seal_condition_already_recorded' using errcode='CR409';
  end if;

  update public.couranr_delivery_security_seals set
    dropoff_condition = p_condition,
    dropoff_recorded_at = now(),
    dropoff_recorded_by_driver_id = v_asg.driver_id,
    updated_at = now()
  where id = v_seal.id
  returning * into v_seal;

  return v_seal;
end
$fn$;

comment on function public.couranr_record_seal_condition is
  'The driver''s one observation of the seal at handoff: intact, damaged or '
  'missing. Append-only — a condition that can be revised after seeing the '
  'reaction is not an observation. Does NOT block completion; a bad seal is an '
  'Operations incident, not a reason to strand a parcel.';

revoke all on function public.couranr_record_seal_condition(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.couranr_record_seal_condition(uuid,uuid,text)
  to service_role;

/* ─────────────── the handoff transition ──────────────────────────────────── */

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

  /* PROTECTED HANDOFF FORBIDS LEAVE-AT-DOOR. Unreachable today by construction
     — the consumer path hardcodes 'photo_or_pin' — which is exactly why it is
     written down: the rule that is true by accident is the one a later change
     breaks silently. Checked here rather than only at request time because this
     is the last point before the parcel leaves the driver's hands. */
  if v_level = 'protected_handoff' and new.proof_method = 'leave_at_door' then
    raise exception 'protected_handoff_forbids_leave_at_door' using errcode='CR409';
  end if;

  select dropoff_condition into v_condition
    from public.couranr_delivery_security_seals
   where delivery_id = new.id;
  if v_condition is null then
    raise exception 'seal_condition_required_at_dropoff' using errcode='CR409';
  end if;

  -- Note what is NOT here: 'damaged' and 'missing' both pass. The record is the
  -- product; refusing on it would make honesty the expensive answer.
  return new;
end
$fn$;

comment on function private.couranr_enforce_consumer_dropoff_custody is
  'Closes the custody chain: a governed secure delivery cannot reach delivered '
  'without the seal having been LOOKED AT, and a protected handoff can never be '
  'left at a door. Ungoverned deliveries return immediately.';

revoke all on function private.couranr_enforce_consumer_dropoff_custody()
  from public, anon, authenticated;

drop trigger if exists couranr_deliveries_consumer_dropoff_custody on public.couranr_deliveries;
create trigger couranr_deliveries_consumer_dropoff_custody
  before update on public.couranr_deliveries
  for each row execute function private.couranr_enforce_consumer_dropoff_custody();

commit;
