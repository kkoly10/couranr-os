-- =====================================================================
-- Driver execution, part 2: pickup completion, the three delivery
-- completions, pre-pickup unassignment, the completion receipt, and the
-- EXECUTE boundary for every function in both files.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- F. couranr_complete_pickup    at_pickup -> picked_up
--
-- The longest precondition list in the system, and every item is read from a
-- STORED row rather than taken on the caller's word:
--
--   * the merchant credential was accepted (its row is `consumed`)
--   * both required photos exist as FINALIZED proof rows — not as booleans
--     the browser set, and not as upload authorizations that were issued and
--     never verified
--   * no discrepancy is open
--   * the vehicle the driver confirms is the one the assignment records
--   * whether the large-or-unusual rules apply is DERIVED here, from the
--     plan's committed vehicle class and the declared shipment, so a browser
--     asserting "this is not unusual" cannot skip the securement photo on
--     exactly the load that needs it
-- ---------------------------------------------------------------------
create or replace function public.couranr_complete_pickup(
  p_delivery_id            uuid,
  p_expected_version       integer,
  p_actor_user_id          uuid,
  p_observed_package_count integer,
  p_staff_first_name       text,
  p_confirmed_vehicle_id   uuid,
  p_latitude               numeric,
  p_longitude              numeric,
  p_accuracy_m             numeric,
  p_dimensions             jsonb,
  p_loading_participants   text,
  p_loading_equipment      text,
  p_existing_damage        text,
  p_driver_acknowledged    boolean
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg   public.couranr_delivery_assignments;
  v_dlv   public.couranr_deliveries;
  v_large boolean;
  v_weight numeric;
  v_count  numeric;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  select * into v_dlv from public.couranr_deliveries where id = p_delivery_id for update;
  if v_dlv.fulfillment_state <> 'at_pickup' then
    raise exception 'delivery_not_in_expected_state' using errcode = 'CR409';
  end if;

  if p_latitude is null or p_longitude is null then
    raise exception 'location_required' using errcode = 'CR400';
  end if;
  if p_observed_package_count is null or p_observed_package_count < 0 then
    raise exception 'package_count_required' using errcode = 'CR400';
  end if;
  if p_staff_first_name is null or length(btrim(p_staff_first_name)) = 0 then
    raise exception 'staff_identifier_required' using errcode = 'CR400';
  end if;

  -- The vehicle actually present must be the assigned one. A driver who
  -- turned up in a different vehicle raises a discrepancy; they do not
  -- silently re-point the assignment.
  if p_confirmed_vehicle_id is distinct from v_asg.vehicle_id then
    raise exception 'vehicle_mismatch' using errcode = 'CR409';
  end if;

  if exists (select 1 from public.couranr_pickup_discrepancies
              where delivery_id = p_delivery_id and discrepancy_state = 'open') then
    raise exception 'pickup_discrepancy_open' using errcode = 'CR409';
  end if;

  if not exists (
    select 1 from public.couranr_handoff_codes
     where delivery_id = p_delivery_id
       and code_kind = 'merchant_pickup'
       and code_state = 'consumed'
  ) then
    raise exception 'pickup_code_not_accepted' using errcode = 'CR409';
  end if;

  if not exists (
    select 1 from public.couranr_delivery_proofs
     where delivery_id = p_delivery_id and assignment_id = v_asg.id
       and proof_stage = 'pickup' and proof_type = 'shipment_photo'
  ) then
    raise exception 'shipment_photo_required' using errcode = 'CR409';
  end if;

  if not exists (
    select 1 from public.couranr_delivery_proofs
     where delivery_id = p_delivery_id and assignment_id = v_asg.id
       and proof_stage = 'pickup' and proof_type = 'condition_photo'
  ) then
    raise exception 'condition_photo_required' using errcode = 'CR409';
  end if;

  -- Derived, never supplied. Mirrors requiresLargeShipmentProof() in
  -- lib/couranr/driver/states.ts; the unit tests hold the two together.
  v_weight := nullif(v_dlv.shipment ->> 'weightLb', '')::numeric;
  v_count  := nullif(v_dlv.shipment ->> 'packageCount', '')::numeric;
  v_large  := (v_dlv.vehicle_requirement ->> 'vehicleClass') = 'box_truck'
              or coalesce(v_weight, 0) >= 150
              or coalesce(v_count, 0) >= 10;

  if v_large then
    if not exists (
      select 1 from public.couranr_delivery_proofs
       where delivery_id = p_delivery_id and assignment_id = v_asg.id
         and proof_stage = 'pickup' and proof_type = 'securement_photo'
    ) then
      raise exception 'securement_photo_required' using errcode = 'CR409';
    end if;
    if p_loading_participants is null or length(btrim(p_loading_participants)) = 0 then
      raise exception 'loading_participants_required' using errcode = 'CR400';
    end if;
    if p_loading_equipment is null or length(btrim(p_loading_equipment)) = 0 then
      raise exception 'loading_equipment_required' using errcode = 'CR400';
    end if;
    if p_existing_damage is null or length(btrim(p_existing_damage)) = 0 then
      raise exception 'existing_damage_statement_required' using errcode = 'CR400';
    end if;
    if p_driver_acknowledged is not true then
      raise exception 'driver_acknowledgement_required' using errcode = 'CR400';
    end if;
  end if;

  insert into public.couranr_handoff_records (
    delivery_id, assignment_id, handoff_stage, observed_package_count,
    counterparty_first_name, confirmed_vehicle_id, latitude, longitude, accuracy_m,
    large_or_unusual, dimensions, loading_participants, loading_equipment,
    existing_damage_statement, driver_acknowledged, actor_driver_id, recorded_at
  ) values (
    p_delivery_id, v_asg.id, 'pickup', p_observed_package_count,
    btrim(p_staff_first_name), p_confirmed_vehicle_id, p_latitude, p_longitude, p_accuracy_m,
    v_large, p_dimensions, p_loading_participants, p_loading_equipment,
    p_existing_damage, p_driver_acknowledged, v_asg.driver_id, now()
  );

  update public.couranr_deliveries
     set fulfillment_state = 'picked_up', version = version + 1, updated_at = now()
   where id = p_delivery_id
     and version = p_expected_version
     and fulfillment_state = 'at_pickup'
  returning * into v_dlv;

  if not found then
    raise exception 'delivery_not_in_expected_state' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'driver', 'complete_pickup', 'at_pickup', 'picked_up',
    jsonb_build_object(
      'assignmentId', v_asg.id,
      'observedPackageCount', p_observed_package_count,
      'largeOrUnusual', v_large,
      'latitude', p_latitude, 'longitude', p_longitude, 'accuracyM', p_accuracy_m)
  );

  return v_dlv;
end $fn$;

-- ---------------------------------------------------------------------
-- G. The one command that ends a delivery.
--
-- Private, and it takes NO target state — it does exactly one thing. The three
-- public completion commands each enforce their own proof rules and then call
-- this, so "close the assignment, release the resources, write the events" has
-- a single implementation and cannot drift between proof methods.
-- ---------------------------------------------------------------------
create or replace function public.couranr_finish_delivered(
  p_delivery_id      uuid,
  p_expected_version integer,
  p_actor_user_id    uuid,
  p_assignment_id    uuid,
  p_command          text,
  p_metadata         jsonb
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_dlv public.couranr_deliveries;
  v_asg public.couranr_delivery_assignments;
begin
  update public.couranr_deliveries
     set fulfillment_state = 'delivered', version = version + 1, updated_at = now()
   where id = p_delivery_id
     and version = p_expected_version
     and fulfillment_state = 'at_dropoff'
  returning * into v_dlv;

  if not found then
    -- A replay lands here: the delivery is already `delivered`, so nothing is
    -- written a second time. No duplicate proof, no duplicate event.
    raise exception 'delivery_not_in_expected_state' using errcode = 'CR409';
  end if;

  update public.couranr_delivery_assignments
     set assignment_state = 'completed',
         ended_at = now(),
         end_reason = 'delivered',
         version = version + 1,
         updated_at = now()
   where id = p_assignment_id
     and assignment_state = 'active'
  returning * into v_asg;

  if not found then
    -- The delivery moved but the assignment did not: our own invariant is
    -- broken, not the caller's input. CR422 -> 500, deliberately.
    raise exception 'assignment_not_active_at_completion' using errcode = 'CR422';
  end if;

  perform public.couranr_release_assignment_resources(v_asg.driver_id, v_asg.vehicle_id);

  insert into public.couranr_assignment_events (
    assignment_id, delivery_id, actor_user_id, actor_type, command,
    from_state, to_state, metadata
  ) values (
    v_asg.id, p_delivery_id, p_actor_user_id, 'driver', 'complete_assignment',
    'active', 'completed', jsonb_build_object('deliveryCommand', p_command)
  );

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'driver', p_command, 'at_dropoff', 'delivered',
    coalesce(p_metadata, '{}'::jsonb)
  );

  return v_dlv;
end $fn$;

-- Shared drop-off preconditions: the caller's assignment, the right state, a
-- location, and the delivery's IMMUTABLE proof method.
create or replace function public.couranr_assert_dropoff_ready(
  p_delivery_id   uuid,
  p_actor_user_id uuid,
  p_proof_method  text,
  p_latitude      numeric,
  p_longitude     numeric
)
returns public.couranr_delivery_assignments
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  select * into v_dlv from public.couranr_deliveries where id = p_delivery_id for update;
  if v_dlv.fulfillment_state <> 'at_dropoff' then
    raise exception 'delivery_not_in_expected_state' using errcode = 'CR409';
  end if;
  -- The driver does not choose how delivery is proven. The merchant chose at
  -- request time and the value has been immutable since capture.
  if v_dlv.proof_method is distinct from p_proof_method then
    raise exception 'wrong_proof_method' using errcode = 'CR409';
  end if;
  if p_latitude is null or p_longitude is null then
    raise exception 'location_required' using errcode = 'CR400';
  end if;

  return v_asg;
end $fn$;

-- Direct handoff. The recipient credential is REQUIRED; a photograph is not an
-- alternative to it.
create or replace function public.couranr_complete_direct_handoff_delivery(
  p_delivery_id          uuid,
  p_expected_version     integer,
  p_actor_user_id        uuid,
  p_recipient_first_name text,
  p_latitude             numeric,
  p_longitude            numeric,
  p_accuracy_m           numeric
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
begin
  v_asg := public.couranr_assert_dropoff_ready(
    p_delivery_id, p_actor_user_id, 'photo_or_pin', p_latitude, p_longitude);

  if p_recipient_first_name is null or length(btrim(p_recipient_first_name)) = 0 then
    raise exception 'recipient_first_name_required' using errcode = 'CR400';
  end if;

  if not exists (
    select 1 from public.couranr_handoff_codes
     where delivery_id = p_delivery_id
       and code_kind = 'recipient_dropoff'
       and code_state = 'consumed'
  ) then
    raise exception 'recipient_code_not_accepted' using errcode = 'CR409';
  end if;

  insert into public.couranr_handoff_records (
    delivery_id, assignment_id, handoff_stage, counterparty_first_name,
    latitude, longitude, accuracy_m, proof_method_used, actor_driver_id, recorded_at
  ) values (
    p_delivery_id, v_asg.id, 'dropoff', btrim(p_recipient_first_name),
    p_latitude, p_longitude, p_accuracy_m, 'photo_or_pin', v_asg.driver_id, now()
  );

  insert into public.couranr_delivery_proofs (
    delivery_id, assignment_id, proof_stage, proof_type,
    captured_latitude, captured_longitude, captured_accuracy_m,
    actor_driver_id, metadata, finalized_at
  ) values (
    p_delivery_id, v_asg.id, 'dropoff', 'recipient_pin',
    p_latitude, p_longitude, p_accuracy_m, v_asg.driver_id,
    jsonb_build_object('recipientFirstName', btrim(p_recipient_first_name)), now()
  );

  return public.couranr_finish_delivered(
    p_delivery_id, p_expected_version, p_actor_user_id, v_asg.id,
    'complete_direct_handoff_delivery',
    jsonb_build_object('assignmentId', v_asg.id, 'latitude', p_latitude,
                       'longitude', p_longitude, 'accuracyM', p_accuracy_m));
end $fn$;

-- Signature.
create or replace function public.couranr_complete_signature_delivery(
  p_delivery_id       uuid,
  p_expected_version  integer,
  p_actor_user_id     uuid,
  p_signer_first_name text,
  p_latitude          numeric,
  p_longitude         numeric,
  p_accuracy_m        numeric
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
begin
  v_asg := public.couranr_assert_dropoff_ready(
    p_delivery_id, p_actor_user_id, 'signature', p_latitude, p_longitude);

  if p_signer_first_name is null or length(btrim(p_signer_first_name)) = 0 then
    raise exception 'signer_first_name_required' using errcode = 'CR400';
  end if;

  -- The signature itself is a FINALIZED proof row, so its bytes were verified
  -- against the issued authorization before this command could succeed.
  if not exists (
    select 1 from public.couranr_delivery_proofs
     where delivery_id = p_delivery_id and assignment_id = v_asg.id
       and proof_stage = 'dropoff' and proof_type = 'signature'
  ) then
    raise exception 'signature_required' using errcode = 'CR409';
  end if;

  insert into public.couranr_handoff_records (
    delivery_id, assignment_id, handoff_stage, counterparty_first_name,
    latitude, longitude, accuracy_m, proof_method_used, actor_driver_id, recorded_at
  ) values (
    p_delivery_id, v_asg.id, 'dropoff', btrim(p_signer_first_name),
    p_latitude, p_longitude, p_accuracy_m, 'signature', v_asg.driver_id, now()
  );

  return public.couranr_finish_delivered(
    p_delivery_id, p_expected_version, p_actor_user_id, v_asg.id,
    'complete_signature_delivery',
    jsonb_build_object('assignmentId', v_asg.id, 'latitude', p_latitude,
                       'longitude', p_longitude, 'accuracyM', p_accuracy_m));
end $fn$;

-- Leave at door.
--
-- The stored authorization IS `proof_method = 'leave_at_door'`, which the
-- merchant chose at request time and which has been immutable since capture.
-- `couranr_assert_dropoff_ready` refuses any other value, so a driver cannot
-- reach this command for a delivery that was never authorized for it. There is
-- no separate customer-authorization column in the canonical schema today;
-- when the secure tracking slice adds one, this is the single place that must
-- also read it.
create or replace function public.couranr_complete_leave_at_door_delivery(
  p_delivery_id        uuid,
  p_expected_version   integer,
  p_actor_user_id      uuid,
  p_safe_location      boolean,
  p_weather_suitable   boolean,
  p_latitude           numeric,
  p_longitude          numeric,
  p_accuracy_m         numeric
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
begin
  v_asg := public.couranr_assert_dropoff_ready(
    p_delivery_id, p_actor_user_id, 'leave_at_door', p_latitude, p_longitude);

  if p_safe_location is not true then
    raise exception 'safe_location_confirmation_required' using errcode = 'CR400';
  end if;
  if p_weather_suitable is not true then
    raise exception 'weather_confirmation_required' using errcode = 'CR400';
  end if;

  if not exists (
    select 1 from public.couranr_delivery_proofs
     where delivery_id = p_delivery_id and assignment_id = v_asg.id
       and proof_stage = 'dropoff' and proof_type = 'delivery_photo'
  ) then
    raise exception 'delivery_photo_required' using errcode = 'CR409';
  end if;

  insert into public.couranr_handoff_records (
    delivery_id, assignment_id, handoff_stage, latitude, longitude, accuracy_m,
    proof_method_used, safe_location_confirmed, weather_suitable_confirmed,
    actor_driver_id, recorded_at
  ) values (
    p_delivery_id, v_asg.id, 'dropoff', p_latitude, p_longitude, p_accuracy_m,
    'leave_at_door', true, true, v_asg.driver_id, now()
  );

  return public.couranr_finish_delivered(
    p_delivery_id, p_expected_version, p_actor_user_id, v_asg.id,
    'complete_leave_at_door_delivery',
    jsonb_build_object('assignmentId', v_asg.id, 'latitude', p_latitude,
                       'longitude', p_longitude, 'accuracyM', p_accuracy_m));
end $fn$;

-- ---------------------------------------------------------------------
-- B. Pre-pickup unassignment. Operations only, and it closes at at_pickup.
--
-- A real operational capability: a driver breaks down, a shift ends, a route
-- is rebalanced. It is NOT a cleanup backdoor, which is why it refuses the
-- moment the driver has reached the merchant — after that the goods and the
-- merchant's time are involved and the answer is a discrepancy or an
-- exception, not a silent rewind.
-- ---------------------------------------------------------------------
create or replace function public.couranr_unassign_delivery_before_pickup(
  p_delivery_id      uuid,
  p_expected_version integer,
  p_actor_user_id    uuid,
  p_reason           text
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_dlv public.couranr_deliveries;
  v_asg public.couranr_delivery_assignments;
  v_from text;
begin
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode = 'CR403';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'CR400';
  end if;

  select * into v_dlv from public.couranr_deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;
  if v_dlv.fulfillment_state not in ('assigned', 'en_route_to_pickup') then
    raise exception 'too_late_to_unassign' using errcode = 'CR409';
  end if;
  v_from := v_dlv.fulfillment_state;

  select * into v_asg from public.couranr_delivery_assignments
   where delivery_id = p_delivery_id and assignment_state = 'active' for update;
  if not found then
    raise exception 'no_active_assignment' using errcode = 'CR409';
  end if;

  update public.couranr_delivery_assignments
     set assignment_state = 'cancelled',
         ended_at = now(),
         end_reason = btrim(p_reason),
         version = version + 1,
         updated_at = now()
   where id = v_asg.id;

  perform public.couranr_release_assignment_resources(v_asg.driver_id, v_asg.vehicle_id);

  update public.couranr_deliveries
     set fulfillment_state = 'scheduled', version = version + 1, updated_at = now()
   where id = p_delivery_id and version = p_expected_version
  returning * into v_dlv;

  if not found then
    raise exception 'delivery_version_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_assignment_events (
    assignment_id, delivery_id, actor_user_id, actor_type, command,
    from_state, to_state, metadata
  ) values (
    v_asg.id, p_delivery_id, p_actor_user_id, 'operations',
    'unassign_delivery_before_pickup', 'active', 'cancelled',
    jsonb_build_object('reason', btrim(p_reason))
  );

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'operations',
    'unassign_delivery_before_pickup', v_from, 'scheduled',
    jsonb_build_object('assignmentId', v_asg.id, 'reason', btrim(p_reason))
  );

  return v_dlv;
end $fn$;

-- ---------------------------------------------------------------------
-- H. The completion receipt.
--
-- Six fields, and the SELECT list IS the privacy boundary: no address, no
-- recipient contact, no payment identifier, no object path, no signed URL.
-- Scoped to the CALLER's own driver profile and to 24 hours, so a driver
-- cannot read another's completion and a finished delivery stops being
-- readable rather than lingering on a success screen forever.
-- ---------------------------------------------------------------------
create or replace function public.couranr_driver_completion_receipt(
  p_actor_user_id uuid
)
returns table (
  delivery_id             uuid,
  assignment_id           uuid,
  delivered_at            timestamptz,
  proof_method            text,
  pickup_proof_complete   boolean,
  delivery_proof_complete boolean
)
language sql security invoker set search_path = ''
as $fn$
  select
    d.id,
    a.id,
    a.ended_at,
    d.proof_method,
    exists (select 1 from public.couranr_delivery_proofs p
             where p.assignment_id = a.id and p.proof_stage = 'pickup'),
    exists (select 1 from public.couranr_delivery_proofs p
             where p.assignment_id = a.id and p.proof_stage = 'dropoff')
  from public.couranr_delivery_assignments a
  join public.couranr_drivers dr on dr.id = a.driver_id
  join public.couranr_deliveries d on d.id = a.delivery_id
  where dr.user_id = p_actor_user_id
    and a.assignment_state = 'completed'
    and a.ended_at is not null
    and a.ended_at > now() - interval '24 hours'
  order by a.ended_at desc
  limit 1;
$fn$;

-- =====================================================================
-- EXECUTE boundary.
--
-- `pg_default_acl` grants EXECUTE on every new function in `public` to anon,
-- authenticated AND service_role, so the REVOKE is what creates the boundary
-- and the GRANT alone would be a silent no-op. Verified with
-- has_function_privilege, never with information_schema grantee rows — those
-- miss privileges inherited through PUBLIC.
-- =====================================================================
do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'couranr_driver_assignment_for',
         'couranr_release_assignment_resources',
         'couranr_start_route_to_pickup',
         'couranr_arrive_at_pickup',
         'couranr_start_route_to_dropoff',
         'couranr_arrive_at_dropoff',
         'couranr_complete_pickup',
         'couranr_finish_delivered',
         'couranr_assert_dropoff_ready',
         'couranr_complete_direct_handoff_delivery',
         'couranr_complete_signature_delivery',
         'couranr_complete_leave_at_door_delivery',
         'couranr_unassign_delivery_before_pickup',
         'couranr_issue_handoff_code',
         'couranr_verify_handoff_code',
         'couranr_create_proof_upload',
         'couranr_finalize_proof_upload',
         'couranr_report_pickup_discrepancy',
         'couranr_resolve_pickup_discrepancy_safe_to_continue',
         'couranr_driver_completion_receipt')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    execute format('revoke all on function %s from service_role', v_sig);
    execute format('grant execute on function %s to service_role', v_sig);
  end loop;
end
$$;

commit;
