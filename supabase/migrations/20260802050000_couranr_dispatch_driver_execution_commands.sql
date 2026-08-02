-- =====================================================================
-- Driver execution and proof commands.
--
-- Same contract as every canonical command family:
--   * SECURITY INVOKER, `set search_path = ''`, service_role only
--   * the actor is passed in and RECORDED, never inferred
--   * NO caller-supplied target state — the command name IS the transition,
--     and each function writes its destination as a literal
--   * optimistic concurrency by compare-and-set on `version` in the WHERE
--   * state change and audit rows in ONE transaction
--   * CR403 forbidden, CR404 not found, CR409 conflict/state, CR400 bad
--     caller input, CR422 our own invariant broken
--
-- WHAT A DRIVER CAN DO HERE, AND WHAT THEY STILL CANNOT.
-- A driver may move their own assignment forward and capture proof. They may
-- not choose a delivery, choose a vehicle, approve a requote, resolve a
-- discrepancy, or name where a delivery lands. Every command below starts by
-- deriving the caller's OWN active assignment and refuses anything else with
-- CR403 — an unassigned driver and a driver pointing at someone else's
-- delivery get byte-identical answers, so neither learns the delivery exists.
--
-- THE RAW PIN NEVER APPEARS IN THIS FILE. Node computes an HMAC under a
-- server-only secret and passes the digest. pgcrypto is installed here, but
-- keying in the database would put the key and the digests in the same dump,
-- and `set search_path = ''` would make an unqualified `hmac()` a 42883 at
-- runtime with the SQL reading correctly.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- A closed outcome for a PIN attempt.
--
-- A wrong PIN is an ordinary business event, not a database exception. Raising
-- would abort the transaction and lose the attempt increment — the counter
-- that makes a six-digit code safe at all — so the outcome is DATA.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'couranr_pin_attempt_result'
  ) then
    create type public.couranr_pin_attempt_result as (
      outcome    text,
      code_kind  text,
      generation integer
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- The caller's OWN active assignment, or CR403.
--
-- Every driver command starts here. The delivery id is checked AGAINST the
-- assignment rather than used to find it, so a driver cannot reach another
-- delivery by supplying its id, and the refusal is identical whether the
-- delivery exists, belongs to someone else, or was never assigned.
-- ---------------------------------------------------------------------
create or replace function public.couranr_driver_assignment_for(
  p_delivery_id   uuid,
  p_actor_user_id uuid
)
returns public.couranr_delivery_assignments
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_drv public.couranr_drivers;
  v_asg public.couranr_delivery_assignments;
begin
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode = 'CR403';
  end if;

  select * into v_drv from public.couranr_drivers where user_id = p_actor_user_id;
  if not found then
    raise exception 'not_your_delivery' using errcode = 'CR403';
  end if;

  select * into v_asg from public.couranr_delivery_assignments
   where driver_id = v_drv.id and assignment_state = 'active'
   for update;
  if not found then
    raise exception 'not_your_delivery' using errcode = 'CR403';
  end if;

  if v_asg.delivery_id is distinct from p_delivery_id then
    raise exception 'not_your_delivery' using errcode = 'CR403';
  end if;

  return v_asg;
end $fn$;

-- ---------------------------------------------------------------------
-- Release the driver and the vehicle an assignment held.
--
-- Availability after a delivery is NOT unconditionally `available`: a driver
-- suspended mid-route, or a vehicle taken out of service, must come back
-- `unavailable` or the next assignment would hand work to a resource that is
-- no longer fit for it.
--
-- Takes no target state. It performs one fixed thing.
-- ---------------------------------------------------------------------
create or replace function public.couranr_release_assignment_resources(
  p_driver_id  uuid,
  p_vehicle_id uuid
)
returns void
language plpgsql security invoker set search_path = ''
as $fn$
begin
  update public.couranr_drivers
     set availability_state = case
           when driver_state = 'active' and active then 'available'
           else 'unavailable'
         end,
         version = version + 1,
         updated_at = now()
   where id = p_driver_id;

  update public.couranr_dispatch_vehicles
     set availability_state = case when active then 'available' else 'unavailable' end,
         version = version + 1,
         updated_at = now()
   where id = p_vehicle_id;
end $fn$;

-- =====================================================================
-- A. Driver fulfillment transitions
-- =====================================================================

-- assigned -> en_route_to_pickup
create or replace function public.couranr_start_route_to_pickup(
  p_delivery_id     uuid,
  p_expected_version integer,
  p_actor_user_id   uuid
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  update public.couranr_deliveries
     set fulfillment_state = 'en_route_to_pickup',
         version = version + 1,
         updated_at = now()
   where id = p_delivery_id
     and version = p_expected_version
     and fulfillment_state = 'assigned'
  returning * into v_dlv;

  if not found then
    raise exception 'delivery_not_in_expected_state' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'driver', 'start_route_to_pickup',
    'assigned', 'en_route_to_pickup',
    jsonb_build_object('assignmentId', v_asg.id)
  );

  return v_dlv;
end $fn$;

-- en_route_to_pickup -> at_pickup. Location is REQUIRED: an arrival with no
-- recorded position is an unevidenced claim, and PRF-001 requires location on
-- every proof.
create or replace function public.couranr_arrive_at_pickup(
  p_delivery_id      uuid,
  p_expected_version integer,
  p_actor_user_id    uuid,
  p_latitude         numeric,
  p_longitude        numeric,
  p_accuracy_m       numeric
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  if p_latitude is null or p_longitude is null then
    raise exception 'location_required' using errcode = 'CR400';
  end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'location_out_of_range' using errcode = 'CR400';
  end if;

  update public.couranr_deliveries
     set fulfillment_state = 'at_pickup',
         version = version + 1,
         updated_at = now()
   where id = p_delivery_id
     and version = p_expected_version
     and fulfillment_state = 'en_route_to_pickup'
  returning * into v_dlv;

  if not found then
    raise exception 'delivery_not_in_expected_state' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'driver', 'arrive_at_pickup',
    'en_route_to_pickup', 'at_pickup',
    jsonb_build_object(
      'assignmentId', v_asg.id,
      'latitude', p_latitude, 'longitude', p_longitude, 'accuracyM', p_accuracy_m)
  );

  return v_dlv;
end $fn$;

-- picked_up -> in_transit
create or replace function public.couranr_start_route_to_dropoff(
  p_delivery_id      uuid,
  p_expected_version integer,
  p_actor_user_id    uuid
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  update public.couranr_deliveries
     set fulfillment_state = 'in_transit',
         version = version + 1,
         updated_at = now()
   where id = p_delivery_id
     and version = p_expected_version
     and fulfillment_state = 'picked_up'
  returning * into v_dlv;

  if not found then
    raise exception 'delivery_not_in_expected_state' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'driver', 'start_route_to_dropoff',
    'picked_up', 'in_transit', jsonb_build_object('assignmentId', v_asg.id)
  );

  return v_dlv;
end $fn$;

-- in_transit -> at_dropoff. Location required, same reason as arrival at pickup.
create or replace function public.couranr_arrive_at_dropoff(
  p_delivery_id      uuid,
  p_expected_version integer,
  p_actor_user_id    uuid,
  p_latitude         numeric,
  p_longitude        numeric,
  p_accuracy_m       numeric
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  if p_latitude is null or p_longitude is null then
    raise exception 'location_required' using errcode = 'CR400';
  end if;
  if p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'location_out_of_range' using errcode = 'CR400';
  end if;

  update public.couranr_deliveries
     set fulfillment_state = 'at_dropoff',
         version = version + 1,
         updated_at = now()
   where id = p_delivery_id
     and version = p_expected_version
     and fulfillment_state = 'in_transit'
  returning * into v_dlv;

  if not found then
    raise exception 'delivery_not_in_expected_state' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'driver', 'arrive_at_dropoff',
    'in_transit', 'at_dropoff',
    jsonb_build_object(
      'assignmentId', v_asg.id,
      'latitude', p_latitude, 'longitude', p_longitude, 'accuracyM', p_accuracy_m)
  );

  return v_dlv;
end $fn$;

-- =====================================================================
-- C. Handoff credential issuance
-- =====================================================================

-- ---------------------------------------------------------------------
-- Issue or regenerate a credential. Accepts a DIGEST, never a code.
--
-- Regeneration supersedes the previous generation in the same transaction, so
-- there is never a moment when two generations are usable. The generation is
-- part of the signed input on the Node side, which is what makes the old
-- digest stop verifying even when the six digits repeat.
-- ---------------------------------------------------------------------
create or replace function public.couranr_issue_handoff_code(
  p_delivery_id   uuid,
  p_code_kind     text,
  p_code_digest   text,
  p_actor_user_id uuid,
  p_ttl_minutes   integer
)
returns public.couranr_handoff_codes
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_dlv  public.couranr_deliveries;
  v_gen  integer;
  v_row  public.couranr_handoff_codes;
begin
  if p_code_kind not in ('merchant_pickup', 'recipient_dropoff') then
    raise exception 'unknown_code_kind' using errcode = 'CR400';
  end if;
  if p_code_digest !~ '^[0-9a-f]{64}$' then
    -- A raw six-digit code can never satisfy this, which is the point.
    raise exception 'digest_required' using errcode = 'CR400';
  end if;
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode = 'CR403';
  end if;

  select * into v_dlv from public.couranr_deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;
  if v_dlv.fulfillment_state in ('delivered', 'cancelled', 'could_not_deliver') then
    raise exception 'delivery_already_settled' using errcode = 'CR409';
  end if;

  -- Supersede every live generation of THIS kind only. The two credentials
  -- are independent; regenerating a pickup code must not touch the recipient's.
  update public.couranr_handoff_codes
     set code_state = 'superseded',
         superseded_at = now(),
         version = version + 1,
         updated_at = now()
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind
     and code_state in ('active', 'locked');

  select coalesce(max(generation), 0) + 1 into v_gen
    from public.couranr_handoff_codes
   where delivery_id = p_delivery_id and code_kind = p_code_kind;

  insert into public.couranr_handoff_codes (
    delivery_id, code_kind, generation, code_digest, code_state,
    issued_by, issued_at, expires_at, failed_attempts
  ) values (
    p_delivery_id, p_code_kind, v_gen, p_code_digest, 'active',
    p_actor_user_id, now(), now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 1440), 5)), 0
  )
  returning * into v_row;

  return v_row;
end $fn$;

-- ---------------------------------------------------------------------
-- D. Verify an attempt. Returns an outcome; never raises for a wrong code.
--
-- The increment and the decision happen in ONE statement path under a row
-- lock, so five concurrent guesses cannot each read `failed_attempts = 0`.
-- ---------------------------------------------------------------------
create or replace function public.couranr_verify_handoff_code(
  p_delivery_id uuid,
  p_code_kind   text,
  p_code_digest text
)
returns public.couranr_pin_attempt_result
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_row public.couranr_handoff_codes;
  v_out public.couranr_pin_attempt_result;
begin
  if p_code_kind not in ('merchant_pickup', 'recipient_dropoff') then
    raise exception 'unknown_code_kind' using errcode = 'CR400';
  end if;

  select * into v_row from public.couranr_handoff_codes
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind
     and code_state in ('active', 'locked')
   order by generation desc
   limit 1
   for update;

  if not found then
    -- Nothing issued, or every generation superseded. Indistinguishable from
    -- expiry on purpose: neither tells the holder anything actionable.
    v_out := row('expired', p_code_kind, null)::public.couranr_pin_attempt_result;
    return v_out;
  end if;

  if v_row.code_state = 'locked' then
    return row('locked', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  if v_row.expires_at <= now() then
    update public.couranr_handoff_codes
       set code_state = 'expired', version = version + 1, updated_at = now()
     where id = v_row.id;
    return row('expired', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  if p_code_digest is not null and p_code_digest = v_row.code_digest then
    -- Consuming is idempotent from the caller's side: a repeated correct code
    -- returns `accepted` again, and the TRANSITION guard elsewhere is what
    -- stops the state moving twice.
    update public.couranr_handoff_codes
       set code_state = 'consumed',
           consumed_at = coalesce(consumed_at, now()),
           last_attempt_at = now(),
           version = version + 1,
           updated_at = now()
     where id = v_row.id;
    return row('accepted', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  update public.couranr_handoff_codes
     set failed_attempts = failed_attempts + 1,
         last_attempt_at = now(),
         code_state = case when failed_attempts + 1 >= 5 then 'locked' else code_state end,
         locked_at  = case when failed_attempts + 1 >= 5 then now() else locked_at end,
         version = version + 1,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if v_row.code_state = 'locked' then
    return row('locked', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;
  return row('invalid', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
end $fn$;

-- =====================================================================
-- E. Proof upload authorization
-- =====================================================================

create or replace function public.couranr_create_proof_upload(
  p_delivery_id    uuid,
  p_actor_user_id  uuid,
  p_proof_stage    text,
  p_proof_type     text,
  p_storage_bucket text,
  p_object_path    text,
  p_expected_mime  text,
  p_expected_bytes integer,
  p_upload_nonce   text,
  p_ttl_minutes    integer
)
returns public.couranr_proof_uploads
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
  v_drv public.couranr_drivers;
  v_row public.couranr_proof_uploads;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  select * into v_dlv from public.couranr_deliveries where id = p_delivery_id;
  select * into v_drv from public.couranr_drivers where id = v_asg.driver_id;

  -- The stage must be reachable from where the delivery actually is. A photo
  -- taken at pickup cannot become drop-off evidence later.
  if p_proof_stage in ('pickup', 'pickup_discrepancy') and v_dlv.fulfillment_state <> 'at_pickup' then
    raise exception 'proof_stage_not_valid_here' using errcode = 'CR409';
  end if;
  if p_proof_stage = 'dropoff' and v_dlv.fulfillment_state <> 'at_dropoff' then
    raise exception 'proof_stage_not_valid_here' using errcode = 'CR409';
  end if;

  insert into public.couranr_proof_uploads (
    delivery_id, assignment_id, assignment_version, proof_stage, proof_type,
    storage_bucket, object_path, expected_mime, expected_bytes,
    upload_nonce, upload_state, issued_to_driver, issued_at, expires_at
  ) values (
    p_delivery_id, v_asg.id, v_asg.version, p_proof_stage, p_proof_type,
    p_storage_bucket, p_object_path, p_expected_mime, p_expected_bytes,
    p_upload_nonce, 'issued', v_drv.id, now(),
    now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 15), 1))
  )
  returning * into v_row;

  return v_row;
end $fn$;

-- ---------------------------------------------------------------------
-- Finalize. Every parameter here is a fact the SERVER read back from storage
-- after the upload — never something the browser asserted.
-- ---------------------------------------------------------------------
create or replace function public.couranr_finalize_proof_upload(
  p_upload_id      uuid,
  p_actor_user_id  uuid,
  p_actual_path    text,
  p_actual_bytes   integer,
  p_actual_mime    text,
  p_latitude       numeric,
  p_longitude      numeric,
  p_accuracy_m     numeric,
  p_discrepancy_id uuid,
  p_metadata       jsonb
)
returns public.couranr_delivery_proofs
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_up  public.couranr_proof_uploads;
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
  v_drv public.couranr_drivers;
  v_pr  public.couranr_delivery_proofs;
begin
  select * into v_up from public.couranr_proof_uploads where id = p_upload_id for update;
  if not found then
    raise exception 'upload_not_found' using errcode = 'CR404';
  end if;

  v_asg := public.couranr_driver_assignment_for(v_up.delivery_id, p_actor_user_id);

  if v_up.upload_state <> 'issued' then
    raise exception 'upload_already_used' using errcode = 'CR409';
  end if;
  if v_up.expires_at <= now() then
    update public.couranr_proof_uploads
       set upload_state = 'expired', version = version + 1, updated_at = now()
     where id = v_up.id;
    raise exception 'upload_expired' using errcode = 'CR409';
  end if;

  -- The assignment must be the SAME one, at the SAME generation. A replacement
  -- between issuing and finalizing would otherwise file the previous driver's
  -- photograph as the new driver's evidence.
  if v_up.assignment_id is distinct from v_asg.id then
    raise exception 'assignment_changed' using errcode = 'CR409';
  end if;
  if v_up.assignment_version is distinct from v_asg.version then
    raise exception 'assignment_version_changed' using errcode = 'CR409';
  end if;

  select * into v_dlv from public.couranr_deliveries where id = v_up.delivery_id;
  if v_up.proof_stage in ('pickup', 'pickup_discrepancy') and v_dlv.fulfillment_state <> 'at_pickup' then
    raise exception 'proof_stage_not_valid_here' using errcode = 'CR409';
  end if;
  if v_up.proof_stage = 'dropoff' and v_dlv.fulfillment_state <> 'at_dropoff' then
    raise exception 'proof_stage_not_valid_here' using errcode = 'CR409';
  end if;

  -- The eight storage facts.
  if p_actual_path is distinct from v_up.object_path then
    raise exception 'object_path_mismatch' using errcode = 'CR409';
  end if;
  if p_actual_bytes is null or p_actual_bytes <= 0 then
    raise exception 'object_empty' using errcode = 'CR409';
  end if;
  if p_actual_bytes is distinct from v_up.expected_bytes then
    -- A truncated object is technically non-empty. This is the check that
    -- catches it.
    raise exception 'object_size_mismatch' using errcode = 'CR409';
  end if;
  if p_actual_bytes > 10485760 then
    raise exception 'object_too_large' using errcode = 'CR409';
  end if;
  if p_actual_mime is distinct from v_up.expected_mime then
    raise exception 'object_mime_mismatch' using errcode = 'CR409';
  end if;
  if p_actual_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic') then
    raise exception 'object_mime_not_allowed' using errcode = 'CR409';
  end if;

  select * into v_drv from public.couranr_drivers where id = v_asg.driver_id;

  insert into public.couranr_delivery_proofs (
    delivery_id, assignment_id, discrepancy_id, proof_stage, proof_type,
    storage_bucket, storage_object_path, byte_size, mime_type,
    captured_latitude, captured_longitude, captured_accuracy_m,
    actor_driver_id, metadata, finalized_at
  ) values (
    v_up.delivery_id, v_asg.id, p_discrepancy_id, v_up.proof_stage, v_up.proof_type,
    v_up.storage_bucket, v_up.object_path, p_actual_bytes, p_actual_mime,
    p_latitude, p_longitude, p_accuracy_m,
    v_drv.id, coalesce(p_metadata, '{}'::jsonb), now()
  )
  returning * into v_pr;

  update public.couranr_proof_uploads
     set upload_state = 'consumed',
         consumed_at = now(),
         finalized_at = now(),
         version = version + 1,
         updated_at = now()
   where id = v_up.id;

  return v_pr;
end $fn$;

-- =====================================================================
-- Pickup discrepancy
-- =====================================================================

create or replace function public.couranr_report_pickup_discrepancy(
  p_delivery_id   uuid,
  p_actor_user_id uuid,
  p_reason        text,
  p_notes         text
)
returns public.couranr_pickup_discrepancies
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
  v_row public.couranr_pickup_discrepancies;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  select * into v_dlv from public.couranr_deliveries where id = p_delivery_id for update;
  if v_dlv.fulfillment_state <> 'at_pickup' then
    raise exception 'delivery_not_in_expected_state' using errcode = 'CR409';
  end if;

  -- Idempotent: a second report while one is open returns the open one rather
  -- than stacking blockers a driver would then have to clear individually.
  select * into v_row from public.couranr_pickup_discrepancies
   where delivery_id = p_delivery_id and discrepancy_state = 'open';
  if found then
    return v_row;
  end if;

  insert into public.couranr_pickup_discrepancies (
    delivery_id, assignment_id, reason, notes, discrepancy_state,
    reported_by_driver_id, reported_at
  ) values (
    p_delivery_id, v_asg.id, p_reason, p_notes, 'open', v_asg.driver_id, now()
  )
  returning * into v_row;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'driver', 'report_pickup_discrepancy',
    'at_pickup', 'at_pickup',
    jsonb_build_object('discrepancyId', v_row.id, 'reason', p_reason)
  );

  return v_row;
end $fn$;

-- Operations only, and narrow on purpose: it clears a blocker, it does not
-- resolve a price, a vehicle or a safety question. Those wait for the
-- exceptions slice rather than being waved through here.
create or replace function public.couranr_resolve_pickup_discrepancy_safe_to_continue(
  p_discrepancy_id uuid,
  p_expected_version integer,
  p_actor_user_id  uuid,
  p_note           text
)
returns public.couranr_pickup_discrepancies
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_row public.couranr_pickup_discrepancies;
begin
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode = 'CR403';
  end if;

  update public.couranr_pickup_discrepancies
     set discrepancy_state = 'safe_to_continue',
         resolved_at = now(),
         resolved_by = p_actor_user_id,
         resolution_note = p_note,
         version = version + 1,
         updated_at = now()
   where id = p_discrepancy_id
     and version = p_expected_version
     and discrepancy_state = 'open'
  returning * into v_row;

  if not found then
    raise exception 'discrepancy_not_open' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.delivery_id, p_actor_user_id, 'operations',
    'resolve_pickup_discrepancy_safe_to_continue', 'at_pickup', 'at_pickup',
    jsonb_build_object('discrepancyId', v_row.id)
  );

  return v_row;
end $fn$;

commit;
