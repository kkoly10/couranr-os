import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");
const FOUNDATION = readFileSync(
  join(MIGRATIONS, "20260904152329_couranr_automatic_fulfillment_v1.sql"),
  "utf8"
).toLowerCase();
const CORRECTION = readFileSync(
  join(MIGRATIONS, "20260904154559_couranr_automatic_fulfillment_v1_corrections.sql"),
  "utf8"
).toLowerCase();
const CREDIT_GUARDS = readFileSync(
  join(MIGRATIONS, "20260904170431_couranr_credit_invariant_guard_parity.sql"),
  "utf8"
).toLowerCase();
const PAID_API_GUARD = readFileSync(
  join(MIGRATIONS, "20260904172708_couranr_paid_api_spend_guard_v1.sql"),
  "utf8"
).toLowerCase();
const ENGINE = readFileSync(join(ROOT, "lib/couranr/automation/engine.ts"), "utf8");
const CRON = readFileSync(
  join(ROOT, "app/api/couranr/internal/automation/tick/route.ts"),
  "utf8"
);
const VERCEL = readFileSync(join(ROOT, "vercel.json"), "utf8");
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("automatic fulfillment commercial identity", () => {
  it("uses credit or Stripe obligation, never fake dual settlement", () => {
    expect(CORRECTION).toContain("couranr_sp_settlement_identity_chk");
    expect(CORRECTION).toContain("couranr_dlv_settlement_identity_chk");
    expect(CORRECTION).toMatch(/promotional_credit_id is null and payment_obligation_id is not null/);
    expect(CORRECTION).toMatch(/promotional_credit_id is not null and payment_obligation_id is null/);
    expect(CORRECTION).not.toContain("payment_obligation_history_missing");
  });

  it("credited conversion stores no fake payment obligation", () => {
    const fn = CORRECTION.slice(
      CORRECTION.indexOf("create or replace function public.couranr_create_delivery_from_promotional_credit"),
      CORRECTION.indexOf("revoke all on function public.couranr_create_delivery_from_promotional_credit")
    );
    expect(fn).toMatch(/v_req\.id\s*,\s*v_req\.business_account_id\s*,\s*null\s*,\s*v_credit\.id\s*,\s*v_plan\.id/);
    expect(fn).toContain("'paymentobligationid',null");
    expect(fn).toContain("v_req.current_quote_version_id is distinct from v_quote.id");
  });

  it("card planning still requires an authorized current-quote obligation", () => {
    const fn = CORRECTION.slice(
      CORRECTION.indexOf("create or replace function public.couranr_try_auto_plan"),
      CORRECTION.indexOf("revoke all on function public.couranr_try_auto_plan")
    );
    expect(fn).toMatch(/if v_credit\.id is null then[\s\S]*v_ob\.id is null/);
    expect(fn).toMatch(/v_ob\.payment_state<>'authorized'/);
    expect(fn).toMatch(/v_ob\.quote_version_id is distinct from v_quote\.id/);
    expect(fn).toMatch(/case when v_credit\.id is null then v_ob\.id else null end/);
  });

  it("the canonical plan invariant accepts exactly one real settlement authority", () => {
    const fn = CREDIT_GUARDS.slice(
      CREDIT_GUARDS.indexOf("create or replace function private.couranr_enforce_plan_quote"),
      CREDIT_GUARDS.indexOf("create or replace function private.couranr_enforce_delivery_quote")
    );
    expect(fn).toContain("new.payment_obligation_id is not null and new.promotional_credit_id is null");
    expect(fn).toContain("new.promotional_credit_id is not null and new.payment_obligation_id is null");
    expect(fn).toContain("status='applied'");
    expect(fn).toContain("new.quote_version_id is distinct from v_c.quote_version_id");
    expect(fn).toContain("new.promotional_credit_id");
  });

  it("the canonical delivery invariant validates and freezes credit economics", () => {
    const fn = CREDIT_GUARDS.slice(
      CREDIT_GUARDS.indexOf("create or replace function private.couranr_enforce_delivery_quote")
    );
    expect(fn).toContain("new.promotional_credit_id");
    expect(fn).toContain("new.standard_quote_cents");
    expect(fn).toContain("new.amount_paid_cents");
    expect(fn).toContain("new.promotional_credit_cents");
    expect(fn).toContain("v_p.promotional_credit_id is distinct from v_c.id");
    expect(fn).toContain("new.captured_amount_cents is distinct from 0");
    expect(fn).toContain("new.standard_quote_cents is distinct from v_c.standard_quote_cents");
    expect(fn).toContain("new.amount_paid_cents is distinct from v_c.amount_paid_cents");
    expect(fn).toContain("new.promotional_credit_cents is distinct from v_c.promotional_credit_cents");
  });
});

describe("automatic scheduling and capacity", () => {
  it("does not silently move an explicit scheduled request when capacity is full", () => {
    const fn = CORRECTION.slice(
      CORRECTION.indexOf("create or replace function public.couranr_try_auto_plan"),
      CORRECTION.indexOf("revoke all on function public.couranr_try_auto_plan")
    );
    expect(fn).toContain("v_scheduled := v_req.timing_intent='scheduled'");
    expect(fn).toMatch(/if v_scheduled then[\s\S]*'capacity_unavailable'[\s\S]*return jsonb_build_object\('outcome','exception'/);
    expect(fn).toContain("v_candidate := v_candidate + interval '15 minutes'");
  });

  it("serializes capacity allocation", () => {
    expect(FOUNDATION).toContain("pg_advisory_xact_lock(hashtext('couranr-capacity:'||v_market))");
    expect(FOUNDATION).toContain("couranr_capacity_reservations");
    expect(FOUNDATION).toContain("couranr_cr_market_window_idx");
  });

  it("turns non-standard facts into review instead of guessing", () => {
    const reasons = [
      "quote_not_automatic",
      "quote_requires_review",
      "timing_requires_review",
      "shipment_safety_not_confirmed",
      "multiple_stops_not_automatic",
      "route_not_automatic",
      "traffic_not_automatic",
      "overnight_not_automatic",
      "weight_not_automatic",
    ];
    for (const reason of reasons) expect(FOUNDATION).toContain("'" + reason + "'");
  });
});

describe("late-bound dispatch", () => {
  it("reserves one request driver and vehicle before commit", () => {
    expect(FOUNDATION).toContain("couranr_drsv_one_active_request");
    expect(FOUNDATION).toContain("couranr_drsv_one_active_driver");
    expect(FOUNDATION).toContain("couranr_drsv_one_active_vehicle");
    expect(FOUNDATION).toContain("interval '5 minutes'");
  });

  it("records automatic assignment as system-owned", () => {
    const fn = FOUNDATION.slice(
      FOUNDATION.indexOf("create or replace function public.couranr_commit_automatic_assignment"),
      FOUNDATION.indexOf("revoke all on function public.couranr_reserve_automatic_dispatch_candidate")
    );
    expect(fn).toContain("'automatic',v_res.id");
    expect(fn).toContain("null,'system','assign_delivery'");
    expect(fn).not.toContain("p_actor_user_id");
  });

  it("blocks manual assignment from racing an active automatic reservation", () => {
    expect(FOUNDATION).toContain("private.couranr_assignment_reservation_guard");
    expect(FOUNDATION).toContain("delivery_reserved_for_automatic_dispatch");
    expect(FOUNDATION).toContain("automatic_dispatch_reservation_invalid");
  });

  it("revalidates route without repricing", () => {
    const dispatch = ENGINE.slice(
      ENGINE.indexOf("async function dispatchOne"),
      ENGINE.indexOf("export async function runAutomaticFulfillmentTick")
    );
    expect(dispatch).toContain("computeCanonicalGoogleRoute");
    expect(dispatch).toContain("couranr_record_auto_revalidation");
    expect(dispatch).toContain("approvedQuoteUntouched: true");
    expect(dispatch).not.toContain("quoteDelivery(");
    expect(dispatch).not.toContain("requote");
  });

  it("short-circuits completed or assigned deliveries before reserving again", () => {
    const dispatch = ENGINE.slice(
      ENGINE.indexOf("async function dispatchOne"),
      ENGINE.indexOf("export async function runAutomaticFulfillmentTick")
    );
    expect(dispatch).toContain("loadExistingDelivery");
    expect(dispatch).toContain('existingDelivery.fulfillment_state !== "scheduled"');
    expect(dispatch).toContain('releaseReservation(reservationId, "delivery_already_assigned")');
  });
});

describe("money safety", () => {
  it("reuses the existing capture workflow", () => {
    expect(ENGINE).toContain("capturePaymentForAutomation");
    const fulfillment = source("lib/couranr/fulfillment/commands.ts");
    const wrapper = fulfillment.slice(
      fulfillment.indexOf("export async function capturePaymentForAutomation"),
      fulfillment.indexOf("/** Step 4.")
    );
    expect(wrapper).toContain("return capturePayment({");
    expect(wrapper).toContain("automation: true");
  });

  it("system capture supplies no fake Operations actor id", () => {
    const fulfillment = source("lib/couranr/fulfillment/commands.ts");
    const capture = fulfillment.slice(
      fulfillment.indexOf("export async function capturePayment(params"),
      fulfillment.indexOf("export async function capturePaymentForAutomation")
    );
    expect(capture).toContain('params.actor && params.actor.kind === "operations" ? params.actor.userId : null');
  });

  it("capture uncertainty becomes an exception", () => {
    expect(ENGINE).toContain("payment_capture_requires_reconciliation");
    expect(ENGINE).toContain("providerOutcomeUnknown");
    expect(ENGINE).toContain("releaseReservation");
  });
});

describe("Operations is exception-first", () => {
  it("filters real work in SQL before pagination", () => {
    expect(CORRECTION).toContain("couranr_operations_queue_candidates");
    expect(CORRECTION).toContain("couranr_automation_exceptions");
    expect(CORRECTION).toContain("p.plan_source='automatic'");
    expect(CORRECTION).toMatch(/limit greatest\(1,least\(coalesce\(p_limit,200\),200\)\)/);
  });

  it("manual takeover resolves the exception it replaces", () => {
    expect(CORRECTION).toContain("private.couranr_resolve_manual_plan_exception");
    expect(CORRECTION).toContain("private.couranr_resolve_manual_dispatch_exception");
    expect(CORRECTION).toContain("exception_state='resolved'");
  });

  it("queue and workbench consume plan source and explicit exception truth", () => {
    const queue = source("app/api/couranr/operations/queue/route.ts");
    const workbench = source("components/couranr/operations/OperationsDeliveryWorkbench.tsx");
    expect(queue).toContain("servicePlanSource");
    expect(queue).toContain("automationExceptionOpen");
    expect(workbench).toContain('work.lifecycleStage === "automatic_scheduled"');
    expect(workbench).toContain('work.lifecycleStage === "automation_exception"');
    expect(workbench).toContain("<AutomaticFulfillmentPanel");
  });
});

describe("execution wiring", () => {
  it("advances from every canonical lifecycle seam that can unblock automation", () => {
    const hooks = [
      "app/api/couranr/delivery-requests/[id]/submit/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/submit/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/accept-as-quoted/route.ts",
      "app/api/couranr/delivery-requests/[id]/readiness/route.ts",
      "app/api/couranr/delivery-requests/[id]/reconcile-payment/route.ts",
      "app/api/couranr/consumer/submit/route.ts",
      "app/api/couranr/consumer/reconcile-payment/route.ts",
      "app/api/couranr/consumer/readiness/route.ts",
      "app/api/couranr/pay/[token]/reconcile/route.ts",
      "app/api/couranr/stripe/webhook/route.ts",
    ];
    for (const path of hooks) expect(source(path), path).toContain("advanceAutomaticFulfillment");
  });

  it("has a secret-authenticated periodic catch-up worker", () => {
    expect(CRON).toContain("process.env.CRON_SECRET");
    expect(CRON).toContain('req.headers.get("authorization")');
    expect(CRON).toContain("runAutomaticFulfillmentTick");
    expect(CRON).toContain("automation_not_configured");
    expect(CRON).toContain("{ status: 503 }");
    expect(CRON).toContain("{ status: 401 }");
    expect(VERCEL).toContain('"*/5 * * * *"');
  });

  it("consumer readiness writes the shared canonical readiness state", () => {
    const migration = source(
      "supabase/migrations/20260904155724_couranr_consumer_readiness_parity.sql"
    ).toLowerCase();
    const route = source("app/api/couranr/consumer/readiness/route.ts");
    const adapter = source("lib/couranr/sameday/liveAdapters.ts");
    const flow = source("components/couranr/sameday/SendFlow.tsx");
    expect(migration).toContain("couranr_set_consumer_pickup_readiness");
    expect(migration).toContain("readiness_state=p_readiness");
    expect(migration).toContain("'customer',v_command");
    expect(route).toContain("setConsumerPickupReadiness");
    expect(route).toContain("advanceAutomaticFulfillment");
    expect(adapter).toContain("setPickupReadiness");
    expect(flow).toContain('mode === "live" && readiness === null');
    expect(flow).not.toContain('readiness === null ? "ready"');
  });
});

describe("paid provider cost safety", () => {
  it("puts hard prelaunch daily caps in server-owned policy", () => {
    expect(PAID_API_GUARD).toContain("'google_routes_compute_routes',50,true");
    expect(PAID_API_GUARD).toContain("'google_places_autocomplete',200,true");
    expect(PAID_API_GUARD).toContain("'google_places_details',100,true");
    expect(PAID_API_GUARD).toContain("couranr_claim_external_api_call");
    expect(PAID_API_GUARD).toContain("request_count < v_policy.daily_limit");
  });

  it("blocks real paid provider calls outside production unless explicitly opted in", () => {
    const guard = source("lib/couranr/providers/paidApiGuard.ts");
    expect(guard).toContain('process.env.VERCEL_ENV === "production"');
    expect(guard).toContain('process.env.COURANR_ALLOW_PAID_PROVIDER_CALLS === "true"');
    expect(guard).toContain("paid_provider_calls_disabled_outside_production");
    expect(guard).toContain("if (fetchImpl !== fetch) return { allowed: true }");
  });

  it("routes and both Places paths claim budget before real provider fetches", () => {
    const routes = source("lib/couranr/routing/googleRoutes.ts");
    const details = source("lib/couranr/routing/googlePlaces.ts");
    const merchant = source("app/api/couranr/merchant/places/route.ts");
    const consumer = source("lib/couranr/consumer/send.ts");
    expect(routes.indexOf("claimPaidApiCall")).toBeLessThan(routes.indexOf("fetchImpl(COMPUTE_ROUTES_URL"));
    expect(details.indexOf("claimPaidApiCall")).toBeLessThan(details.indexOf("fetchImpl("));
    expect(merchant.indexOf('claimPaidApiCall("google_places_autocomplete")')).toBeLessThan(
      merchant.indexOf("fetch(PLACES_AUTOCOMPLETE_URL")
    );
    const claimPos = consumer.lastIndexOf('claimPaidApiCall("google_places_autocomplete"');
    const fetchPos = consumer.indexOf("fetchImpl(PLACES_AUTOCOMPLETE_URL", claimPos);
    expect(claimPos).toBeGreaterThan(-1);
    expect(fetchPos).toBeGreaterThan(claimPos);
  });

  it("a five-minute cron does not imply a five-minute Google retry", () => {
    expect(ENGINE).toContain("next_route_recheck_at");
    expect(ENGINE).toContain("route_recheck_not_due");
    expect(ENGINE).toContain("scheduleRouteRecheck");
    expect(ENGINE).toContain('"route_outside_auto_lane_at_dispatch", 15');
    expect(ENGINE).toContain("costGuarded ? 360 : 15");
    expect(PAID_API_GUARD).toContain("next_route_recheck_at");
    expect(PAID_API_GUARD).toContain("route_recheck_count");
  });
});

describe("positive controls", () => {
  it("rejects the unsafe dual-settlement shape", () => {
    expect(CORRECTION).not.toContain(
      "(promotional_credit_id is not null and payment_obligation_id is not null)"
    );
  });

  it("detects repricing if it is ever added to the worker", () => {
    expect(ENGINE).not.toContain("quoteDelivery(");
  });

  it("detects automatic Operations impersonation", () => {
    const fn = FOUNDATION.slice(
      FOUNDATION.indexOf("create or replace function public.couranr_commit_automatic_assignment")
    );
    expect(fn).not.toContain("'operations','assign_delivery'");
  });
});
