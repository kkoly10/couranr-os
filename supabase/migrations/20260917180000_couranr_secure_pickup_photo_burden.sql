-- Closure O: the generic pickup photo stops being demanded of a SECURE pickup.
--
-- FORWARD-ONLY. 20260905190000 is applied in production, so it is not edited:
-- this migration replaces public.couranr_complete_pickup_v2 BY NAME, restating
-- its body verbatim with exactly one change, and supabase/rollbacks/ carries
-- the original body byte-for-byte so the way back is a real state rather than a
-- half-way one nobody has run.
--
-- ─────────────────────────────── the problem ────────────────────────────────
-- A Secure Pickup (secure_pickup / protected_handoff) is asked for FOUR photos
-- in the worst case, plus a typed seal serial, plus the sender's credential:
--
--   shipment_photo      demanded unconditionally by couranr_complete_pickup_v2
--   item_prepack_photo  demanded by the custody trigger (20260915110000/…120000)
--   sealed_package_photo  likewise
--   securement_photo    when the load is large
--
-- For a SECURE shipment the generic photo carries no distinct evidentiary
-- value. The prepack photo is the one that proves WHAT was handed over — it is
-- taken before the item goes into the package, which is strictly more than a
-- shot of "everything you are collecting" can show. The sealed-package photo
-- proves what left the pickup and is the photograph the seal serial is read
-- from. The generic photo sits between them proving neither, and a driver
-- standing in front of a sender is being asked to take it anyway.
--
-- ─────────────────────────────── the change ─────────────────────────────────
-- ONE predicate is added. shipment_photo is still required for every pickup the
-- protection policy does not govern as secure, which is every business
-- delivery, every historical delivery, and every governed STANDARD delivery:
--
--   private.couranr_delivery_protection_level(p_delivery_id) returns the
--   GOVERNED level or null. Null — the ungoverned case — is the historical
--   compatibility answer, and it must behave exactly as it did yesterday.
--
-- `coalesce(... in (...), false)` and not a bare IN: `null in ('a','b')` is
-- NULL, `if not NULL then` does not execute, and the ungoverned pickup would
-- have silently STOPPED requiring the photo. That is the whole historical
-- surface, reached by a three-valued-logic slip, so it is spelled out.
--
-- WHAT IS DELIBERATELY NOT DUPLICATED HERE. The prepack photo, the sealed
-- photo, the seal, and the order they must happen in are enforced by
-- private.couranr_enforce_consumer_custody_sequence on the at_pickup ->
-- picked_up transition (20260915110000, corrected by 20260917120000). Restating
-- any of it inside this function would create a second answer to the same
-- question and would miss couranr_complete_pickup (v1), which the trigger
-- covers because it sits on the transition rather than inside one command. The
-- UPDATE at the end of this function fires that trigger, so a secure pickup
-- that reaches here without its documentation is still refused — by the rule
-- that owns it.
--
-- The large-load securement predicate is UNCHANGED, deliberately: box_truck, or
-- >= 150 lb, or >= 10 packages, with the pickup manifest's count preferred over
-- the shipment root's. A secure shipment that is genuinely large still owes the
-- securement photo, because that photo is about the DRIVE, not the custody
-- ceremony.
--
-- Net server-enforced pickup photo sets after this migration:
--   ungoverned / business / historical  shipment_photo (+ securement if large)
--   governed standard                   shipment_photo (+ securement if large)
--   secure_pickup / protected_handoff   item_prepack_photo + sealed_package_photo
--                                       (+ securement if large)
--
-- No provider calls are made by this migration. No row is rewritten.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

create or replace function public.couranr_complete_pickup_v2(
  p_delivery_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_m numeric
)
returns public.couranr_deliveries
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
  v_large boolean;
  v_weight numeric;
  v_count numeric;
  v_manifest jsonb;
  v_level text;
  v_secure boolean;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id,p_actor_user_id);

  select * into v_dlv from public.couranr_deliveries
   where id=p_delivery_id for update;
  if v_dlv.fulfillment_state <> 'at_pickup' then
    raise exception 'delivery_not_in_expected_state' using errcode='CR409';
  end if;
  if p_latitude is null or p_longitude is null then
    raise exception 'location_required' using errcode='CR400';
  end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'location_out_of_range' using errcode='CR400';
  end if;

  if exists (
    select 1 from public.couranr_pickup_discrepancies
     where delivery_id=p_delivery_id and discrepancy_state='open'
  ) then
    raise exception 'pickup_discrepancy_open' using errcode='CR409';
  end if;

  if not exists (
    select 1
      from public.couranr_handoff_codes c
     where c.delivery_id=p_delivery_id
       and c.code_kind='merchant_pickup'
       and c.code_state='consumed'
       and c.generation=(
         select max(latest.generation)
           from public.couranr_handoff_codes latest
          where latest.delivery_id=p_delivery_id
            and latest.code_kind='merchant_pickup'
       )
  ) then
    -- Regeneration has real revocation semantics: if the sender creates a
    -- newer pickup credential after an earlier one was consumed, the newer
    -- generation must be verified before custody can complete.
    raise exception 'pickup_code_not_accepted' using errcode='CR409';
  end if;

  -- THE ONE CHANGE. The governed level, never re-derived here: one function
  -- already joins delivery -> request and answers null for anything this policy
  -- does not govern.
  v_level := private.couranr_delivery_protection_level(p_delivery_id);
  v_secure := coalesce(v_level in ('secure_pickup','protected_handoff'), false);

  if not v_secure and not exists (
    select 1 from public.couranr_delivery_proofs
     where delivery_id=p_delivery_id
       and assignment_id=v_asg.id
       and proof_stage='pickup'
       and proof_type='shipment_photo'
  ) then
    raise exception 'shipment_photo_required' using errcode='CR409';
  end if;

  v_manifest := v_dlv.shipment->'pickupManifest';
  v_weight := nullif(v_dlv.shipment->>'weightLb','')::numeric;
  v_count := case
    when jsonb_typeof(v_manifest->'packageCount')='number'
      then (v_manifest->>'packageCount')::numeric
    else nullif(v_dlv.shipment->>'packageCount','')::numeric
  end;
  v_large := (v_dlv.vehicle_requirement->>'vehicleClass')='box_truck'
             or coalesce(v_weight,0)>=150
             or coalesce(v_count,0)>=10;

  if v_large and not exists (
    select 1 from public.couranr_delivery_proofs
     where delivery_id=p_delivery_id
       and assignment_id=v_asg.id
       and proof_stage='pickup'
       and proof_type='securement_photo'
  ) then
    raise exception 'securement_photo_required' using errcode='CR409';
  end if;

  insert into public.couranr_handoff_records(
    delivery_id,assignment_id,handoff_stage,
    observed_package_count,counterparty_first_name,confirmed_vehicle_id,
    latitude,longitude,accuracy_m,large_or_unusual,
    actor_driver_id,recorded_at
  ) values (
    p_delivery_id,v_asg.id,'pickup',
    null,null,v_asg.vehicle_id,
    p_latitude,p_longitude,p_accuracy_m,v_large,
    v_asg.driver_id,now()
  );

  update public.couranr_deliveries
     set fulfillment_state='picked_up',version=version+1,updated_at=now()
   where id=p_delivery_id
     and version=p_expected_version
     and fulfillment_state='at_pickup'
  returning * into v_dlv;
  if not found then
    raise exception 'delivery_not_in_expected_state' using errcode='CR409';
  end if;

  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    p_delivery_id,p_actor_user_id,'driver','complete_pickup',
    'at_pickup','picked_up',
    jsonb_strip_nulls(jsonb_build_object(
      'assignmentId',v_asg.id,
      'matchedExpected',true,
      'expectedPackageCount',v_count,
      'pickupManifestPresent',v_manifest is not null,
      'largeOrUnusual',v_large,
      'protectionLevel',v_level,
      'genericShipmentPhotoRequired',not v_secure,
      'latitude',p_latitude,
      'longitude',p_longitude,
      'accuracyM',p_accuracy_m
    ))
  );

  return v_dlv;
end
$fn$;

comment on function public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric) is
  'Pickup Handoff V2 custody confirmation. The generic shipment photo is '
  'required for every pickup EXCEPT a governed secure_pickup/protected_handoff, '
  'whose item_prepack_photo and sealed_package_photo already carry that '
  'evidence and are enforced, in order, by '
  'private.couranr_enforce_consumer_custody_sequence. The large-load securement '
  'photo is unchanged and applies at every level.';

-- `create or replace` RESETS grants, and pg_default_acl in this project grants
-- EXECUTE on every new function in public to anon, authenticated AND
-- service_role — so a replacement that omitted this would publish the function.
-- Revoked from PUBLIC as well as the two roles: a privilege inherited through
-- PUBLIC does not appear as a grantee row and would survive a narrower revoke.
revoke all on function public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric)
  to service_role;

commit;
