/**
 * Row-level assertions for the browser suite.
 *
 * Exists so claims are made against ROWS rather than page text. An onboarding
 * page that created nothing still renders, still says "Couranr", and still
 * lacks the word "error" — so a naive text grep scores it green. Every
 * persistence claim in the suite is read back through here.
 *
 * Goes through `admin.mjs`, i.e. supabase-js with the harness's own secret key,
 * in Node only. No credential is constructed, logged or exported from here.
 */

import { admin } from "./admin.mjs";

const unwrap = (label) => ({ data, error }) => {
  if (error) throw new Error(`${label}: ${error.message}`);
  return data ?? [];
};

export const accountsCreatedBy = (userId) =>
  admin
    .from("business_accounts")
    .select("id,name,slug,status,created_by")
    .eq("created_by", userId)
    .then(unwrap("accountsCreatedBy"));

export const membershipsFor = (userId) =>
  admin
    .from("business_members")
    .select("id,role,status,business_account_id")
    .eq("user_id", userId)
    .then(unwrap("membershipsFor"));

export const workspacesFor = (accountId) =>
  admin
    .from("couranr_merchant_workspaces")
    .select("id,business_category,payer_default,policies_version,contact_phone,created_by")
    .eq("business_account_id", accountId)
    .then(unwrap("workspacesFor"));

export const requestsFor = (accountId) =>
  admin
    .from("couranr_delivery_requests")
    .select("id,request_state,version,delivery_subtotal_cents,payment_due_cents,created_by")
    .eq("business_account_id", accountId)
    .order("created_at", { ascending: false })
    .then(unwrap("requestsFor"));

/** The full review-relevant shape of one request, read back from the row. */
export const requestById = (id) =>
  admin
    .from("couranr_delivery_requests")
    .select(
      "id,request_state,review_state,readiness_state,version,payer_type,quote_status," +
        "delivery_subtotal_cents,pricing_policy_version,payment_due_cents"
    )
    .eq("id", id)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`requestById: ${error.message}`);
      return data;
    });

/** The append-only audit trail for one request, oldest first. */
export const eventsFor = (id) =>
  admin
    .from("couranr_delivery_request_events")
    .select("id,command,actor_type,from_state,to_state,metadata,created_at")
    .eq("request_id", id)
    .order("created_at", { ascending: true })
    .then(unwrap("eventsFor"));

/**
 * Exact counts of the REAL production tables, so the suite can prove it touched
 * none of them. `head: true` fetches the count without transferring rows.
 */
export async function realDataCounts() {
  const one = async (table) => {
    const { count, error } = await admin.from(table).select("id", { count: "exact", head: true });
    if (error) throw new Error(`count ${table}: ${error.message}`);
    return count ?? -1;
  };
  return {
    orders: await one("orders"),
    deliveries: await one("deliveries"),
    addresses: await one("addresses"),
    rentals: await one("rentals"),
  };
}

/** The live (non-cancelled) obligation for a request, if any. */
export const obligationFor = (requestId) =>
  admin
    .from("couranr_payment_obligations")
    .select(
      "id,request_id,payer_type,amount_cents,currency,payment_state,version," +
        "provider_payment_intent_id,authorized_at,request_version,pricing_policy_version," +
        // The capture columns. Absent from this list, an assertion about them
        // reads `undefined` and fails against a row that is perfectly correct
        // — which is exactly how N17 first failed, and how O2 then failed
        // against a `failed_at` the database had stamped correctly.
        "capture_requested_at,captured_at,captured_amount_cents,failed_at,cancelled_at"
    )
    .eq("request_id", requestId)
    .neq("payment_state", "cancelled")
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`obligationFor: ${error.message}`);
      return data;
    });

/**
 * Flips a synthetic request to customer-paid.
 *
 * The merchant UI has no payer picker yet — PAY-001 says onboarding captures a
 * default and every delivery may go either way, but the per-delivery control
 * is not built. Setting the column directly on a SYNTHETIC row is the honest
 * way to reach the customer path today, and it is recorded here rather than
 * hidden inside the suite so the gap stays visible.
 */
export async function setPayerType(requestId, payerType) {
  const { error } = await admin
    .from("couranr_delivery_requests")
    .update({ payer_type: payerType })
    .eq("id", requestId);
  if (error) throw new Error(`setPayerType: ${error.message}`);
  return payerType;
}

/**
 * Issues a payment link for a request and returns the RAW token.
 *
 * Goes through the same command the app uses, so the token is generated and
 * hashed by the real code path; only the hash reaches the database.
 */
export async function issueLinkForRequest(requestId, businessAccountId) {
  const { createHash, randomBytes } = await import("node:crypto");
  const raw = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(raw, "utf8").digest("hex");

  const { data: ob, error: obErr } = await admin.rpc("couranr_create_payment_obligation", {
    p_request_id: requestId,
    p_business_account_id: businessAccountId,
    p_idempotency_key: `e2e-link:${requestId}`,
  });
  if (obErr) throw new Error(`issueLinkForRequest/obligation: ${obErr.message}`);

  const { error } = await admin.rpc("couranr_issue_payment_access_token", {
    p_request_id: requestId,
    p_obligation_id: ob?.id ?? null,
    p_token_hash: hash,
    p_ttl_days: 7,
  });
  if (error) throw new Error(`issueLinkForRequest: ${error.message}`);
  return raw;
}

/* ------------------------------------------- readiness, plan, delivery -- */

/** EVERY service plan for a request, newest first — cancelled ones included. */
export const servicePlansFor = (requestId) =>
  admin
    .from("couranr_service_plans")
    .select(
      "id,request_id,plan_state,request_version,payment_obligation_id," +
        "scheduled_pickup_start,scheduled_pickup_end,timezone,vehicle_id,vehicle_requirement,version"
    )
    .eq("request_id", requestId)
    .order("created_at", { ascending: false })
    .then(unwrap("servicePlansFor"));

/**
 * EVERY canonical delivery for a request. Deliberately a list, not
 * `maybeSingle()`: "exactly one delivery exists" is an assertion the suite has
 * to be able to fail, and `maybeSingle()` would throw on the very row set that
 * proves the defect.
 */
export const deliveriesFor = (requestId) =>
  admin
    .from("couranr_deliveries")
    .select(
      "id,request_id,business_account_id,payment_obligation_id,service_plan_id," +
        "captured_amount_cents,currency,fulfillment_state,scheduled_pickup_start," +
        "scheduled_pickup_end,timezone,vehicle_id,vehicle_requirement,request_version,version"
    )
    .eq("request_id", requestId)
    .order("created_at", { ascending: true })
    .then(unwrap("deliveriesFor"));

/** The append-only payment ledger for one request, oldest first. */
export const paymentEventsFor = (requestId) =>
  admin
    .from("couranr_payment_events")
    .select(
      "id,obligation_id,request_id,provider_event_id,event_type," +
        "payment_state_before,payment_state_after,outcome,detail,created_at"
    )
    .eq("request_id", requestId)
    .order("created_at", { ascending: true })
    .then(unwrap("paymentEventsFor"));

/** The append-only delivery log, oldest first. */
export const deliveryEventsFor = (deliveryId) =>
  admin
    .from("couranr_delivery_events")
    .select("id,delivery_id,command,actor_type,from_state,to_state,metadata,created_at")
    .eq("delivery_id", deliveryId)
    .order("created_at", { ascending: true })
    .then(unwrap("deliveryEventsFor"));

/**
 * The obligation regardless of state, including a cancelled one.
 *
 * `obligationFor` filters cancelled out, which is right for the app and wrong
 * for an assertion that has to be able to observe one.
 */
export const allObligationsFor = (requestId) =>
  admin
    .from("couranr_payment_obligations")
    .select(
      "id,request_id,payment_state,amount_cents,captured_amount_cents,currency," +
        "provider_payment_intent_id,capture_requested_at,captured_at,version," +
        // Same rule as `obligationFor`: a stamp this list omits reads
        // `undefined` and fails an assertion about a perfectly correct row.
        "failed_at,cancelled_at"
    )
    .eq("request_id", requestId)
    .order("created_at", { ascending: true })
    .then(unwrap("allObligationsFor"));

/** The most recent payment link for a request, and why it stopped working. */
export const tokenStateFor = (requestId) =>
  admin
    .from("couranr_payment_access_tokens")
    .select("id,revoked_at,revoked_reason,expires_at,last_used_at")
    .eq("request_id", requestId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`tokenStateFor: ${error.message}`);
      return data;
    });

/* ------------------------------------------------- managed dispatch ----- */

/**
 * The canonical driver profile for a seeded auth user, created through the
 * real command so the row is shaped exactly as production would shape it.
 */
export async function ensureDriverProfile(userId, displayName) {
  const { data, error } = await admin.rpc("couranr_create_driver_profile", {
    p_user_id: userId,
    p_actor_user_id: userId,
    p_display_name: displayName,
    p_contact_phone: "555-0177",
    p_market: "[E2E] market",
  });
  if (error) throw new Error(`ensureDriverProfile: ${error.message}`);
  return data;
}

/** Moves a driver through the NAMED commands, never by setting a column. */
export async function activateDriver(driverId, version) {
  const { data, error } = await admin.rpc("couranr_activate_driver", {
    p_driver_id: driverId,
    p_expected_version: version,
    p_actor_user_id: null,
  });
  if (error) throw new Error(`activateDriver: ${error.message}`);
  return data;
}

export async function setDriverAvailable(driverId, version) {
  const { data, error } = await admin.rpc("couranr_mark_driver_available", {
    p_driver_id: driverId,
    p_expected_version: version,
    p_actor_user_id: null,
  });
  if (error) throw new Error(`setDriverAvailable: ${error.message}`);
  return data;
}

export async function suspendDriver(driverId, version) {
  const { data, error } = await admin.rpc("couranr_suspend_driver", {
    p_driver_id: driverId,
    p_expected_version: version,
    p_actor_user_id: null,
  });
  if (error) throw new Error(`suspendDriver: ${error.message}`);
  return data;
}

export async function createDispatchVehicle(spec) {
  const { data, error } = await admin.rpc("couranr_create_dispatch_vehicle", {
    p_actor_user_id: null,
    p_name: spec.name,
    p_vehicle_class: spec.vehicleClass,
    p_payload_capacity_lb: spec.payloadCapacityLb,
    p_assigned_driver_id: spec.assignedDriverId ?? null,
    p_cargo_length_in: null,
    p_cargo_width_in: null,
    p_cargo_height_in: null,
    p_enclosed: true,
    p_has_ramp: false,
    p_has_dolly: false,
    p_has_tie_downs: false,
    p_weather_protection: true,
  });
  if (error) throw new Error(`createDispatchVehicle: ${error.message}`);
  return data;
}

export async function markVehicleUnavailable(vehicleId, version) {
  const { data, error } = await admin.rpc("couranr_mark_vehicle_unavailable", {
    p_vehicle_id: vehicleId,
    p_expected_version: version,
    p_actor_user_id: null,
  });
  if (error) throw new Error(`markVehicleUnavailable: ${error.message}`);
  return data;
}

export const driverById = (id) =>
  admin
    .from("couranr_drivers")
    .select("id,user_id,display_name,driver_state,availability_state,active,version")
    .eq("id", id)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`driverById: ${error.message}`);
      return data;
    });

export const vehicleById = (id) =>
  admin
    .from("couranr_dispatch_vehicles")
    .select("id,name,vehicle_class,payload_capacity_lb,active,availability_state,version")
    .eq("id", id)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`vehicleById: ${error.message}`);
      return data;
    });

/** EVERY assignment for a delivery, oldest first — replaced ones included. */
export const assignmentsFor = (deliveryId) =>
  admin
    .from("couranr_delivery_assignments")
    .select(
      "id,delivery_id,driver_id,vehicle_id,assignment_state,assigned_by,assigned_at," +
        "ended_at,end_reason,version,created_at"
    )
    .eq("delivery_id", deliveryId)
    .order("created_at", { ascending: true })
    .then(unwrap("assignmentsFor"));

export const assignmentEventsFor = (deliveryId) =>
  admin
    .from("couranr_assignment_events")
    .select("id,assignment_id,delivery_id,command,actor_type,from_state,to_state,metadata,created_at")
    .eq("delivery_id", deliveryId)
    .order("created_at", { ascending: true })
    .then(unwrap("assignmentEventsFor"));

/** The canonical delivery row, by its own id. */
export const deliveryById = (id) =>
  admin
    .from("couranr_deliveries")
    .select("id,request_id,fulfillment_state,vehicle_id,vehicle_requirement,version")
    .eq("id", id)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`deliveryById: ${error.message}`);
      return data;
    });

/** Counts the legacy auto-rental fleet, so Group P can prove it never moved. */
export async function legacyVehicleCount() {
  const { count, error } = await admin
    .from("vehicles")
    .select("id", { count: "exact", head: true });
  if (error) throw new Error(`legacyVehicleCount: ${error.message}`);
  return count ?? -1;
}

/** Every active assignment in the project, regardless of delivery. */
export const allActiveAssignments = () =>
  admin
    .from("couranr_delivery_assignments")
    .select("id,delivery_id,driver_id,vehicle_id,assignment_state,version")
    .eq("assignment_state", "active")
    .then(({ data, error }) => {
      if (error) throw new Error(`allActiveAssignments: ${error.message}`);
      return data ?? [];
    });

/**
 * Moves an assignment onto another driver through the REAL command.
 *
 * Used by group P's setup to release a driver a crashed earlier run left
 * `on_delivery`. Deliberately the product's own transition rather than an
 * UPDATE: a harness that resets state by writing columns directly stops
 * proving anything about the transitions it is meant to exercise, and
 * `couranr_drivers` has no DELETE grant to widen instead.
 */
export async function replaceAssignmentAsOps(input) {
  const { data, error } = await admin.rpc("couranr_replace_delivery_assignment", {
    p_delivery_id: input.deliveryId,
    p_expected_assignment_version: input.expectedAssignmentVersion,
    p_actor_user_id: input.actorUserId,
    p_driver_id: input.driverId,
    p_vehicle_id: input.vehicleId,
    p_reason: input.reason ?? "e2e harness reset",
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) throw new Error(`replaceAssignmentAsOps: ${error.message}`);
  return data;
}

/** The driver profile belonging to an auth user, or null. */
export const driverByUserId = (userId) =>
  admin
    .from("couranr_drivers")
    .select("id,user_id,display_name,driver_state,availability_state,active,version")
    .eq("user_id", userId)
    .maybeSingle()
    .then(({ data, error }) => {
      if (error) throw new Error(`driverByUserId: ${error.message}`);
      return data;
    });
