-- =====================================================================
-- COURANR DRIVER EXCEPTIONS, UNDELIVERABLE CLOSURE AND GOVERNED
-- CANCELLATION (launch batch 3 §C/§30/§31)
--
--   1. DRIVER EXCEPTION AT DROP-OFF (§31). couranr_pickup_discrepancies
--      gains a `stage` column (default 'pickup', CHECK pickup|dropoff) and
--      two additional reasons (recipient_unavailable,
--      address_or_access_problem). A NEW command,
--      couranr_report_dropoff_exception, lets the ASSIGNED driver record a
--      problem from picked_up / in_transit / at_dropoff. It writes the
--      discrepancy row and a delivery event and changes NOTHING else — no
--      fulfillment state, no price, no policy, no completion rule. The
--      existing couranr_report_pickup_discrepancy keeps its exact
--      signature and behaviour.
--
--   2. UNDELIVERABLE CLOSURE (§C — the stranded-driver fix). Before this
--      migration NOTHING could write `could_not_deliver`: unassignment
--      closes at en_route_to_pickup, replacement requires `assigned`, and
--      the only exit from at_pickup onward was completing the delivery —
--      so a delivery that failed at the door pinned its driver
--      `on_delivery` forever. couranr_close_delivery_undeliverable is
--      Operations-only, allowed from at_pickup / picked_up / in_transit /
--      at_dropoff, closes the active assignment (assignment_state
--      'cancelled', end_reason 'could_not_deliver' — NOT 'completed',
--      because couranr_driver_completion_receipt treats a completed
--      assignment as a delivered one), releases the driver and vehicle
--      through the existing couranr_release_assignment_resources, and is
--      an idempotent replay on a delivery already closed.
--
--   3. GOVERNED CANCELLATION (§30). couranr_cancel_delivery is
--      Operations-only and PRE-ARRIVAL only (scheduled / assigned /
--      en_route_to_pickup) — past that the answer is the undeliverable /
--      failed-pickup path, never a silent rewind. It cancels the delivery,
--      closes any active assignment, releases resources, and DELETES
--      NOTHING. Money is deliberately absent from this file: CAN-001
--      refunds and releases run through the batch 3 §B commands
--      (20260903020000), composed in TypeScript — one money path, not two.
--
-- Both Operations commands use the same Operations predicate as
-- couranr_begin_payment_release: profiles.role = 'admin'.
--
-- ADDITIVE throughout: one new column with a default, three widened CHECK
-- allow-lists (every existing value retained — live rows are a strict
-- subset), three new functions. No table, column, or row is dropped.
-- Re-runnable.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regprocedure('public.couranr_driver_assignment_for(uuid,uuid)') is null
     or to_regprocedure('public.couranr_release_assignment_resources(uuid,uuid)') is null then
    raise exception 'driver exceptions require the driver execution commands (20260802050000)';
  end if;
end
$guard$;

/* ------------------------------------------------ 1a. stage column ------ */

alter table public.couranr_pickup_discrepancies
  add column if not exists stage text not null default 'pickup';

comment on column public.couranr_pickup_discrepancies.stage is
  'Where the driver stopped: pickup (the original blocker, blocks complete_pickup while open) or dropoff (§31 exception evidence — recorded, never a completion gate).';

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_pickup_discrepancies'::regclass
       and conname  = 'couranr_pd_stage_chk'
  ) then
    alter table public.couranr_pickup_discrepancies drop constraint couranr_pd_stage_chk;
  end if;
end
$$;

alter table public.couranr_pickup_discrepancies
  add constraint couranr_pd_stage_chk
  check (stage in ('pickup', 'dropoff'));

/* ------------------------------------- 1b. widened reason allow-list ---- */

/*
 * The two drop-off realities the pickup vocabulary had no word for. Every
 * existing value is retained, so no live row can be invalidated.
 */
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_pickup_discrepancies'::regclass
       and conname  = 'couranr_pd_reason_chk'
  ) then
    alter table public.couranr_pickup_discrepancies drop constraint couranr_pd_reason_chk;
  end if;
end
$$;

alter table public.couranr_pickup_discrepancies
  add constraint couranr_pd_reason_chk
  check (reason in (
    'package_count_mismatch',
    'weight_or_size_mismatch',
    'visible_damage',
    'unsafe_packaging',
    'wrong_item',
    'vehicle_mismatch',
    'prohibited_item_concern',
    'loading_not_available',
    'recipient_unavailable',
    'address_or_access_problem',
    'other'));

/* --------------------------------- 1c. widened event command lists ------ */

/*
 * Widening the CHECK before any command writes the value is the lesson this
 * repo has now paid for twice (see 20260802020000): an unlisted command
 * raises 23514 and rolls back the ENTIRE transaction while every static test
 * stays green.
 */
do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_delivery_events'::regclass
       and conname  = 'couranr_dlve_command_chk'
  ) then
    alter table public.couranr_delivery_events drop constraint couranr_dlve_command_chk;
  end if;
end
$$;

alter table public.couranr_delivery_events
  add constraint couranr_dlve_command_chk
  check (command in (
    'create_delivery_from_capture',
    'assign_delivery',
    'unassign_delivery_before_pickup',
    'start_route_to_pickup',
    'arrive_at_pickup',
    'report_pickup_discrepancy',
    'resolve_pickup_discrepancy_safe_to_continue',
    'complete_pickup',
    'start_route_to_dropoff',
    'arrive_at_dropoff',
    'complete_direct_handoff_delivery',
    'complete_signature_delivery',
    'complete_leave_at_door_delivery',
    'report_dropoff_exception',
    'close_delivery_undeliverable',
    'cancel_delivery'));

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_assignment_events'::regclass
       and conname  = 'couranr_ae_command_chk'
  ) then
    alter table public.couranr_assignment_events drop constraint couranr_ae_command_chk;
  end if;
end
$$;

alter table public.couranr_assignment_events
  add constraint couranr_ae_command_chk
  check (command in (
    'assign_delivery',
    'replace_delivery_assignment',
    'unassign_delivery_before_pickup',
    'complete_assignment',
    'close_delivery_undeliverable',
    'cancel_delivery'));

/* -------------------------------- 2. report a problem at drop-off ------- */

/*
 * The driver's stop button, extended past pickup (§31).
 *
 * Same actor discipline as every driver command: the caller's OWN active
 * assignment is derived first, and an unassigned driver or a driver pointing
 * at someone else's delivery gets a byte-identical CR403. Records evidence
 * and NOTHING else — the fulfillment state, the price, the policy and the
 * completion rules are all untouched, and only Operations can close the row
 * (couranr_resolve_pickup_discrepancy_safe_to_continue, unchanged).
 *
 * One open discrepancy per delivery, enforced by the existing partial unique
 * index; a second report while one is open returns the open one.
 */
create or replace function public.couranr_report_dropoff_exception(
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
  if v_dlv.fulfillment_state not in ('picked_up', 'in_transit', 'at_dropoff') then
    -- At pickup the existing pickup-discrepancy command is the right tool;
    -- before pickup there is nothing in custody to report about.
    raise exception 'delivery_not_in_expected_state' using errcode = 'CR409';
  end if;

  select * into v_row from public.couranr_pickup_discrepancies
   where delivery_id = p_delivery_id and discrepancy_state = 'open';
  if found then
    return v_row;
  end if;

  insert into public.couranr_pickup_discrepancies (
    delivery_id, assignment_id, reason, notes, discrepancy_state, stage,
    reported_by_driver_id, reported_at
  ) values (
    p_delivery_id, v_asg.id, p_reason, p_notes, 'open', 'dropoff',
    v_asg.driver_id, now()
  )
  returning * into v_row;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'driver', 'report_dropoff_exception',
    v_dlv.fulfillment_state, v_dlv.fulfillment_state,
    jsonb_build_object('discrepancyId', v_row.id, 'reason', p_reason, 'stage', 'dropoff')
  );

  return v_row;
end $fn$;

/* ------------------------------------ 3. undeliverable closure ---------- */

/*
 * The ONE governed exit for a delivery that cannot be completed once the
 * driver has reached the merchant. Operations decides; the driver never
 * closes their own delivery. Allowed from at_pickup, picked_up, in_transit
 * and at_dropoff — never from delivered or cancelled (settled is settled),
 * and never from the pre-arrival states, where unassignment and cancellation
 * are the honest verbs.
 *
 * THE CUSTODY GATE (correction pass, review item 4). Closing releases the
 * driver and vehicle, so closure demands evidence proportional to custody:
 *
 *   at_pickup — nothing is in custody, but a failed pickup is a DRIVER-
 *   witnessed fact: an OPEN pickup-stage discrepancy must exist. An operator
 *   click is not evidence on its own.
 *
 *   picked_up / in_transit / at_dropoff — the driver has (or may still have)
 *   the goods. Closure requires BOTH an OPEN dropoff-stage exception AND a
 *   non-empty p_custody_resolution: the trusted Operations account of how
 *   the goods were physically resolved, persisted in the immutable delivery
 *   event. Without custody resolution the exception stays open and the
 *   resources stay truthfully assigned — that is the correct state, not a
 *   bug to work around.
 *
 * The discrepancy row itself is left OPEN — it is evidence, and 'open' vs
 * 'safe_to_continue' is the only vocabulary it has; the custody resolution
 * lives in the delivery event. The one-open-row-per-delivery index means a
 * pickup-stage row must be resolved safe_to_continue before a dropoff
 * exception can be reported — the forward flow already guarantees that,
 * because complete_pickup refuses while any discrepancy is open.
 *
 * Money is NOT here. A failed pickup's $15 retention and a Couranr-caused
 * $0 both run through couranr_begin_payment_refund (20260903020000), which
 * derives every amount server-side. This command records what happened to
 * the GOODS. No return is priced and no second delivery is created — a
 * required physical return is a separate future Pricing V2 route.
 */
drop function if exists public.couranr_close_delivery_undeliverable(uuid, integer, uuid, text, text);
drop function if exists public.couranr_close_delivery_undeliverable(uuid, integer, uuid, text, text, text);
create or replace function public.couranr_close_delivery_undeliverable(
  p_delivery_id        uuid,
  p_expected_version   integer,
  p_actor_user_id      uuid,
  p_reason             text,
  p_stage_note         text default null,
  p_custody_resolution text default null,
  /* Final closure pass §2: the CLOSED cancellation-reason enum for saga
     resume — see couranr_cancel_delivery. */
  p_governed_reason    text default null
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_role text;
  v_dlv  public.couranr_deliveries;
  v_asg  public.couranr_delivery_assignments;
  v_from text;
begin
  -- Same Operations predicate as couranr_begin_payment_release, so there is
  -- one SQL definition of "Operations" rather than two.
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'CR400';
  end if;

  select * into v_dlv from public.couranr_deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;

  -- Idempotent replay: an operator who retries after a timeout is handed the
  -- closed row, and no second event is written.
  if v_dlv.fulfillment_state = 'could_not_deliver' then
    return v_dlv;
  end if;

  if v_dlv.fulfillment_state not in ('at_pickup', 'picked_up', 'in_transit', 'at_dropoff') then
    raise exception 'delivery_not_closable_from_state' using errcode = 'CR409';
  end if;
  v_from := v_dlv.fulfillment_state;

  if v_from = 'at_pickup' then
    -- Failed pickup: only with the driver's own recorded evidence.
    if not exists (
      select 1 from public.couranr_pickup_discrepancies
       where delivery_id = p_delivery_id
         and discrepancy_state = 'open'
         and stage = 'pickup'
    ) then
      raise exception 'pickup_discrepancy_evidence_required' using errcode = 'CR409';
    end if;
  else
    -- The driver has or may still have physical custody. Both halves, always.
    if not exists (
      select 1 from public.couranr_pickup_discrepancies
       where delivery_id = p_delivery_id
         and discrepancy_state = 'open'
         and stage = 'dropoff'
    ) then
      raise exception 'dropoff_exception_evidence_required' using errcode = 'CR409';
    end if;
    if p_custody_resolution is null or length(btrim(p_custody_resolution)) = 0 then
      raise exception 'custody_resolution_required' using errcode = 'CR400';
    end if;
  end if;

  update public.couranr_deliveries
     set fulfillment_state = 'could_not_deliver',
         version = version + 1,
         updated_at = now()
   where id = p_delivery_id
     and version = p_expected_version
     and fulfillment_state = v_from
  returning * into v_dlv;
  if not found then
    raise exception 'version_conflict' using errcode = 'CR409';
  end if;

  select * into v_asg from public.couranr_delivery_assignments
   where delivery_id = p_delivery_id and assignment_state = 'active' for update;
  if found then
    /*
     * 'cancelled', DELIBERATELY not 'completed'.
     * couranr_driver_completion_receipt reads assignment_state = 'completed'
     * as "recently delivered" and would hand the driver a completion receipt
     * for a delivery that could not be delivered. end_reason carries the
     * truth either way.
     */
    update public.couranr_delivery_assignments
       set assignment_state = 'cancelled',
           ended_at = now(),
           end_reason = 'could_not_deliver',
           version = version + 1,
           updated_at = now()
     where id = v_asg.id;

    perform public.couranr_release_assignment_resources(v_asg.driver_id, v_asg.vehicle_id);

    insert into public.couranr_assignment_events (
      assignment_id, delivery_id, actor_user_id, actor_type, command,
      from_state, to_state, metadata
    ) values (
      v_asg.id, p_delivery_id, p_actor_user_id, 'operations',
      'close_delivery_undeliverable', 'active', 'cancelled',
      jsonb_build_object('reason', btrim(p_reason))
    );
  end if;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'operations', 'close_delivery_undeliverable',
    v_from, 'could_not_deliver',
    jsonb_build_object('reason', btrim(p_reason), 'stageNote', p_stage_note,
                       'assignmentId', v_asg.id,
                       'governedReason', p_governed_reason,
                       -- Immutable custody evidence: how the goods were
                       -- physically resolved before resources were released.
                       'custodyResolution',
                       case when p_custody_resolution is null then null
                            else btrim(p_custody_resolution) end)
  );

  return v_dlv;
end $fn$;

/* ------------------------------------------ 4. cancel a delivery -------- */

/*
 * Pre-arrival only. From the moment the driver reaches the merchant the
 * goods and the merchant's time are involved and the governed exits are the
 * undeliverable / failed-pickup path above — cancellation past arrival would
 * be a silent rewind of custody.
 *
 * NOTHING is deleted: the delivery row, its assignment history, its events
 * and its payment records all remain. CAN-001's fee consequences run through
 * the §B refund/release commands, composed in TypeScript.
 */
drop function if exists public.couranr_cancel_delivery(uuid, integer, uuid, text);
create or replace function public.couranr_cancel_delivery(
  p_delivery_id      uuid,
  p_expected_version integer,
  p_actor_user_id    uuid,
  p_reason           text,
  /* Final closure pass §2: the CLOSED cancellation-reason enum, persisted so
     a terminal retry can resume the SAME governed money settlement without
     ever accepting a new browser reason. Free-text p_reason stays the
     human-readable account. */
  p_governed_reason  text default null
)
returns public.couranr_deliveries
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_role text;
  v_dlv  public.couranr_deliveries;
  v_asg  public.couranr_delivery_assignments;
  v_from text;
begin
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'CR400';
  end if;

  select * into v_dlv from public.couranr_deliveries where id = p_delivery_id for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;

  -- Idempotent replay.
  if v_dlv.fulfillment_state = 'cancelled' then
    return v_dlv;
  end if;

  if v_dlv.fulfillment_state not in ('scheduled', 'assigned', 'en_route_to_pickup') then
    raise exception 'too_late_to_cancel' using errcode = 'CR409';
  end if;
  v_from := v_dlv.fulfillment_state;

  update public.couranr_deliveries
     set fulfillment_state = 'cancelled',
         version = version + 1,
         updated_at = now()
   where id = p_delivery_id
     and version = p_expected_version
     and fulfillment_state = v_from
  returning * into v_dlv;
  if not found then
    raise exception 'version_conflict' using errcode = 'CR409';
  end if;

  select * into v_asg from public.couranr_delivery_assignments
   where delivery_id = p_delivery_id and assignment_state = 'active' for update;
  if found then
    update public.couranr_delivery_assignments
       set assignment_state = 'cancelled',
           ended_at = now(),
           end_reason = 'cancelled',
           version = version + 1,
           updated_at = now()
     where id = v_asg.id;

    perform public.couranr_release_assignment_resources(v_asg.driver_id, v_asg.vehicle_id);

    insert into public.couranr_assignment_events (
      assignment_id, delivery_id, actor_user_id, actor_type, command,
      from_state, to_state, metadata
    ) values (
      v_asg.id, p_delivery_id, p_actor_user_id, 'operations',
      'cancel_delivery', 'active', 'cancelled',
      jsonb_build_object('reason', btrim(p_reason))
    );
  end if;

  insert into public.couranr_delivery_events (
    delivery_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    p_delivery_id, p_actor_user_id, 'operations', 'cancel_delivery',
    v_from, 'cancelled',
    jsonb_build_object('reason', btrim(p_reason), 'assignmentId', v_asg.id,
                       'governedReason', p_governed_reason)
  );

  return v_dlv;
end $fn$;

/* --------------------------------------------- EXECUTE boundary --------- */

/*
 * pg_default_acl grants EXECUTE on every new public function to anon,
 * authenticated AND service_role, so the REVOKE is what creates the boundary
 * — a bare GRANT would be a silent no-op.
 */
/* ------------------- 5. terminate the REQUEST truthfully ---------------- */

/*
 * Final closure pass §4: a user-visible cancellation must not leave a
 * confirmed or pending delivery REQUEST active — the delivery closes, the
 * money settles, and the request itself must say so. 'cancelled' has been in
 * the canonical request vocabulary since 20260731045417 with, deliberately,
 * no writer; this is that writer: Operations-only, reached through the
 * cancellation recovery composition, never a bare "set state" (the caller
 * has already run the governed fulfillment closure and money commands).
 * Terminal states replay idempotently; delivered work is never rewound.
 */
alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command = any (array[
    'create_delivery_request_draft','calculate_delivery_request_estimate',
    'create_quote_version','submit_delivery_request','begin_delivery_request_review',
    'accept_delivery_request_as_quoted','requote_delivery_request',
    'decline_delivery_request','record_payer_quote_approval',
    'begin_delivery_preparation','mark_delivery_ready','mark_delivery_not_ready',
    'mark_delivery_unavailable','cancel_delivery_request'
  ]));

create or replace function public.couranr_cancel_delivery_request(
  p_request_id    uuid,
  p_actor_user_id uuid,
  p_reason        text
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_role text;
  v_req  public.couranr_delivery_requests;
  v_from text;
begin
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required' using errcode = 'CR400';
  end if;

  select * into v_req from public.couranr_delivery_requests
   where id = p_request_id for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  if v_req.request_state = 'cancelled' then
    return v_req;  -- idempotent replay, no second event
  end if;
  if v_req.request_state in ('declined', 'closed') then
    raise exception 'request_already_terminal' using errcode = 'CR409';
  end if;
  v_from := v_req.request_state;

  update public.couranr_delivery_requests
     set request_state = 'cancelled',
         version = version + 1,
         updated_at = now()
   where id = p_request_id and request_state = v_from
  returning * into v_req;
  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_request_events(
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_req.id, p_actor_user_id, 'operations', 'cancel_delivery_request',
    v_from, 'cancelled',
    jsonb_build_object('reason', btrim(p_reason))
  );
  return v_req;
end
$fn$;

revoke all on function public.couranr_cancel_delivery_request(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_cancel_delivery_request(uuid, uuid, text)
  to service_role;

revoke all on function public.couranr_report_dropoff_exception(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_report_dropoff_exception(uuid, uuid, text, text)
  to service_role;

revoke all on function public.couranr_close_delivery_undeliverable(uuid, integer, uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_close_delivery_undeliverable(uuid, integer, uuid, text, text, text, text)
  to service_role;

revoke all on function public.couranr_cancel_delivery(uuid, integer, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_cancel_delivery(uuid, integer, uuid, text, text)
  to service_role;

commit;
