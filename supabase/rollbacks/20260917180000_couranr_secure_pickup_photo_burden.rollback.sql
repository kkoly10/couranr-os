-- Reverts closure O: restores the UNCONDITIONAL generic pickup photo.
--
-- Safe: no data is destroyed. Every proof, seal and credential row survives.
-- Rolling back REOPENS finding O — a Secure Pickup goes back to owing a generic
-- shipment_photo on top of its prepack photo, its sealed-package photo and, on
-- a large load, its securement photo. Run it only to unblock an incident.
--
-- The body below is 20260905190000's verbatim, so the forward and back states
-- are both real rather than a half-way one nobody has run. The function comment
-- is cleared for the same reason: 20260905190000 set none.

begin;

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

  if not exists (
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
      'latitude',p_latitude,
      'longitude',p_longitude,
      'accuracyM',p_accuracy_m
    ))
  );

  return v_dlv;
end
$fn$;

comment on function public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric) is null;

-- `create or replace` resets grants, so the original revoke/grant pair is
-- restated here exactly as 20260905190000 wrote it.
revoke all on function public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric)
  from public,anon,authenticated;
grant execute on function public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric)
  to service_role;

commit;
