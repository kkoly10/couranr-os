import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Closure K — the consumer notification lifecycle.
 *
 * THE DEFECT THESE TESTS EXIST FOR. `getConsumerSendView` — a pure READ
 * projection served from `GET /api/couranr/consumer/request` — used to claim the
 * recipient tracking token, call the email provider and record the receipt, all
 * inline. So:
 *
 *   - a provider failure returned `internal` from the SENDER'S status page, for
 *     a delivery that was already confirmed and already paid for;
 *   - a sender who closed the tab after a blip ended the story: nothing retried,
 *     nothing alarmed, and the recipient was never emailed;
 *   - the recipient's invitation depended on the sender opening a page.
 *
 * Every assertion below is either "the read does none of that any more" or "the
 * lifecycle does all of it, and does it exactly once".
 *
 * NO LIVE PROVIDER CALL LEAVES THIS PROCESS. `sendRenderedEmail` takes an
 * injectable `fetchImpl`, and `notifyConsumerLifecycle` threads one through, so
 * these drive the REAL send path — body, headers, idempotency key and all —
 * against a double rather than mocking the send away. That distinction matters:
 * this repo has already shipped a dead code path whose only test asserted that
 * a mocked function had NOT been called.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ========================================================================
 * The database double. Every table the lifecycle touches, and a recorder.
 * ===================================================================== */

const h = vi.hoisted(() => ({
  request: null as any,
  delivery: null as any,
  requestEvents: [] as any[],
  deliveryEvents: [] as any[],
  tokens: [] as any[],
  /** rpc name -> {data,error}; a function is called with the args. */
  rpc: {} as Record<string, any>,
  rpcCalls: [] as Array<{ fn: string; args: any }>,
  filters: [] as Array<{ table: string; method: string; args: any[] }>,
  dbThrows: false,
}));

vi.mock("@/lib/supabaseAdmin", () => {
  const chain = (table: string) => {
    const c: any = {};
    const rows = () => {
      if (h.dbThrows) throw new Error("database is down");
      if (table === "couranr_delivery_request_events") return h.requestEvents;
      if (table === "couranr_delivery_events") return h.deliveryEvents;
      if (table === "couranr_delivery_access_tokens") return h.tokens;
      return [];
    };
    for (const m of ["select", "eq", "is", "in", "not", "gte", "order", "limit"]) {
      c[m] = (...args: any[]) => {
        h.filters.push({ table, method: m, args });
        return c;
      };
    }
    c.maybeSingle = async () => {
      if (h.dbThrows) throw new Error("database is down");
      if (table === "couranr_delivery_requests") return { data: h.request, error: null };
      if (table === "couranr_deliveries") return { data: h.delivery, error: null };
      return { data: null, error: null };
    };
    // The list reads are awaited on the builder itself.
    c.then = (resolve: any, reject: any) => {
      try {
        return Promise.resolve({ data: rows(), error: null }).then(resolve, reject);
      } catch (err) {
        return Promise.reject(err).then(resolve, reject);
      }
    };
    return c;
  };
  const rpc = async (fn: string, args: any) => {
    h.rpcCalls.push({ fn, args });
    const configured = h.rpc[fn];
    if (typeof configured === "function") return configured(args);
    return configured ?? { data: null, error: null };
  };
  return { supabaseAdmin: { from: (t: string) => chain(t), rpc } };
});

import {
  CONSUMER_NOTIFICATION_LOOKBACK_MINUTES,
  notifyConsumerLifecycle,
} from "@/lib/couranr/email/consumerLifecycle";
import {
  CONSUMER_EMAIL_NOTIFICATIONS,
  IDEMPOTENCY_KEY_MAX_LENGTH,
  PROVIDER_IDEMPOTENCY_RETENTION_HOURS,
  consumerEmailIdempotencyKey,
} from "@/lib/couranr/email/idempotency";
import { defaultEmailConfig } from "@/lib/couranr/email/theme";
import { buildSamples } from "@/lib/couranr/email/sampleData";
import * as businessTemplates from "@/lib/couranr/email/templates/business";
import * as customerTemplates from "@/lib/couranr/email/templates/customer";
import * as consumerTemplates from "@/lib/couranr/email/templates/consumer";
import { allAuthEmails } from "@/lib/couranr/email/templates/supabaseAuth";
import { collectEmails } from "@/lib/couranr/email/preview";

const REQ = "11111111-1111-4111-8111-111111111111";
const DLV = "22222222-2222-4222-8222-222222222222";

const consumerRequest = (over: Record<string, any> = {}) => ({
  id: REQ,
  requester_kind: "consumer",
  business_account_id: null,
  request_state: "confirmed",
  reference: "CR-8F42QK",
  recipient_name: "Jordan Rivera",
  recipient_email: "jordan@example.com",
  dropoff_address: { city: "Woodbridge", region: "VA" },
  consumer_contact_snapshot: { name: "Avery Chen", email: "avery@example.com" },
  protection_level: "standard",
  ...over,
});

/** A provider double that records every request and answers like Resend. */
function provider(id = "msg_live_1") {
  const calls: Array<{ url: string; headers: Record<string, string>; body: any }> = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    return {
      ok: true,
      status: 200,
      json: async () => ({ id }),
    } as any;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

/** A provider double that refuses, the way an outage or a 4xx does. */
function refusingProvider() {
  const calls: any[] = [];
  const fetchImpl = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return {
      ok: false,
      status: 500,
      json: async () => ({ message: "provider is down" }),
    } as any;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ENV_KEYS = ["VERCEL_ENV", "COURANR_EMAIL_SEND", "COURANR_EMAIL_REDIRECT_TO", "RESEND_API_KEY"];
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  process.env.VERCEL_ENV = "production";
  process.env.RESEND_API_KEY = "re_test_key";
  delete process.env.COURANR_EMAIL_SEND;
  delete process.env.COURANR_EMAIL_REDIRECT_TO;

  h.request = consumerRequest();
  h.delivery = null;
  h.requestEvents = [];
  h.deliveryEvents = [];
  h.tokens = [];
  h.rpc = {};
  h.rpcCalls = [];
  h.filters = [];
  h.dbThrows = false;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

const claimReturns = (outcome: string) => ({
  data: [{ outcome, token_id: "t1", expires_at: "2026-10-17T00:00:00.000Z" }],
  error: null,
});

const rpcCallsTo = (fn: string) => h.rpcCalls.filter((c) => c.fn === fn);

/* ========================================================================
 * A — THE READ PROJECTION SENDS NOTHING
 * ===================================================================== */

describe("the sender's status page is a pure read", () => {
  const VIEW = stripComments(read("lib/couranr/consumer/send.ts"));

  it("names no sender, no claim and no receipt anywhere in the module", () => {
    for (const forbidden of [
      "sendRenderedEmail",
      "claimConsumerRecipientTrackingDelivery",
      "markRecipientTrackingNotification",
      "failRecipientTrackingNotification",
      "custDirectDeliveryConfirmed",
    ]) {
      expect(VIEW, forbidden).not.toContain(forbidden);
    }
  });

  /*
   * The specific line that lied. `recipientNotifiedAt` was stamped with
   * `new Date()` next to an ATTEMPTED send, so the sender was told the
   * recipient had been notified in the same breath as the code that might have
   * failed to notify them. It now reports the receipt the database recorded.
   */
  it("reports the receipt the database recorded, never a local clock reading", () => {
    const fn = VIEW.slice(
      VIEW.indexOf("export async function getConsumerSendView"),
      VIEW.indexOf("/* ------------------------------------------- sender pickup credential ---")
    );
    expect(fn).toContain("recipientNotifiedAt(String(row.id))");
    expect(fn).not.toContain("new Date()");
  });

  it("re-reads the environment predicate from nowhere — email/send.ts owns it", () => {
    expect(VIEW).not.toContain("COURANR_EMAIL_SEND");
    expect(VIEW).not.toContain("VERCEL_ENV");
    const SEND = read("lib/couranr/email/send.ts");
    expect(SEND).toContain("export function emailSendingIsArmed()");
    // ONE reading of each variable in the module that owns them.
    expect([...SEND.matchAll(/process\.env\.COURANR_EMAIL_SEND/g)].length).toBe(1);
    expect([...SEND.matchAll(/process\.env\.VERCEL_ENV/g)].length).toBe(2); // armed + redirect posture
    expect(SEND).toContain("if (!emailSendingIsArmed())");
  });
});

/* ========================================================================
 * B — THE IDEMPOTENCY DOCTRINE
 * ===================================================================== */

describe("idempotency keys", () => {
  it("come from the named minter, never a template literal at a call site", () => {
    for (const file of [
      "lib/couranr/email/consumerLifecycle.ts",
      "lib/couranr/automation/engine.ts",
      "lib/couranr/consumer/send.ts",
    ]) {
      const src = read(file);
      expect(src, file).not.toMatch(/idempotencyKey:\s*`/);
      expect(src, file).not.toMatch(/idempotencyKey:\s*"/);
    }
    expect(read("lib/couranr/email/consumerLifecycle.ts")).toContain(
      "consumerEmailIdempotencyKey."
    );
  });

  it("are event-derived, so the same event always mints the same key", () => {
    const ev = "33333333-3333-4333-8333-333333333333";
    expect(consumerEmailIdempotencyKey.forEvent("recipient_delivered", ev)).toBe(
      consumerEmailIdempotencyKey.forEvent("recipient_delivered", ev)
    );
    expect(consumerEmailIdempotencyKey.forEvent("recipient_delivered", ev)).toContain(ev);
  });

  /*
   * Two notifications could one day derive from one event row. Resend answers
   * `409 invalid_idempotent_request` when a key is replayed with a DIFFERENT
   * payload, so a key carrying only the event id would make the second email a
   * refusal rather than a send.
   */
  it("are scoped to the notification as well as the event", () => {
    const ev = "33333333-3333-4333-8333-333333333333";
    expect(consumerEmailIdempotencyKey.forEvent("recipient_delivered", ev)).not.toBe(
      consumerEmailIdempotencyKey.forEvent("sender_return_notice", ev)
    );
  });

  /*
   * The invitation's scope is the ATTEMPT, not the entity. A request-scoped key
   * would make every retry after a revoked token a 24-hour no-op — the
   * recipient would never be emailed and the provider would report success.
   */
  it("scope the invitation to the claim attempt, not to the request", () => {
    const a = consumerEmailIdempotencyKey.recipientDeliveryInvitation("a".repeat(64));
    const b = consumerEmailIdempotencyKey.recipientDeliveryInvitation("b".repeat(64));
    expect(a).not.toBe(b);
  });

  it("never exceed the provider's key length", () => {
    for (const n of CONSUMER_EMAIL_NOTIFICATIONS) {
      const key = consumerEmailIdempotencyKey.forEvent(n, "3".repeat(36));
      expect(key.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
    }
    expect(
      consumerEmailIdempotencyKey.recipientDeliveryInvitation("f".repeat(64)).length
    ).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
  });

  /*
   * THE LOAD-BEARING INEQUALITY. A consumer request never leaves `confirmed` —
   * nothing in this schema moves it out — so the 5-minute tick sees it forever.
   * Re-attempting a `delivered` event is harmless only while the provider still
   * remembers the key that suppresses it. The lookback MUST close first, or the
   * 25th hour sends a second real email and every day after sends another.
   */
  it("close the event lookback window before the provider forgets the key", () => {
    expect(CONSUMER_NOTIFICATION_LOOKBACK_MINUTES).toBeGreaterThan(0);
    expect(CONSUMER_NOTIFICATION_LOOKBACK_MINUTES).toBeLessThan(
      PROVIDER_IDEMPOTENCY_RETENTION_HOURS * 60
    );
    // And with real margin, not by a minute.
    expect(CONSUMER_NOTIFICATION_LOOKBACK_MINUTES).toBeLessThanOrEqual(
      (PROVIDER_IDEMPOTENCY_RETENTION_HOURS * 60) / 2
    );
  });
});

/* ========================================================================
 * C — THE LIFECYCLE CLAIMS AND SENDS
 * ===================================================================== */

describe("the lifecycle owns the recipient invitation", () => {
  it("claims, sends once, and records the provider receipt in that order", async () => {
    h.rpc.couranr_claim_consumer_recipient_tracking_delivery = claimReturns("issued");
    h.rpc.couranr_mark_recipient_tracking_notification = { data: {}, error: null };
    const p = provider("msg_abc");

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(report.eligible).toBe(true);
    expect(p.calls.length).toBe(1);
    expect(p.calls[0].url).toBe("https://api.resend.com/emails");
    expect(p.calls[0].body.to).toBe("jordan@example.com");
    expect(p.calls[0].headers["Idempotency-Key"]).toContain(
      "couranr.consumer.recipient_delivery_invitation/"
    );

    const order = h.rpcCalls.map((c) => c.fn);
    expect(order.indexOf("couranr_claim_consumer_recipient_tracking_delivery")).toBeLessThan(
      order.indexOf("couranr_mark_recipient_tracking_notification")
    );
    expect(rpcCallsTo("couranr_mark_recipient_tracking_notification")[0].args.p_provider_id).toBe(
      "msg_abc"
    );
    expect(rpcCallsTo("couranr_fail_recipient_tracking_notification").length).toBe(0);
    expect(report.results[0]).toMatchObject({
      notification: "recipient_delivery_invitation",
      outcome: "sent",
    });
  });

  /*
   * The whole point of the move. A provider failure is recorded and retried; it
   * is NOT raised to the caller, because the caller is a payment webhook, a
   * submit route and a cron.
   */
  it("revokes the token on a provider failure and never throws", async () => {
    h.rpc.couranr_claim_consumer_recipient_tracking_delivery = claimReturns("issued");
    const p = refusingProvider();

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(report.results[0]).toMatchObject({
      notification: "recipient_delivery_invitation",
      outcome: "failed",
      reason: "provider_rejected",
    });
    const failed = rpcCallsTo("couranr_fail_recipient_tracking_notification");
    expect(failed.length).toBe(1);
    expect(failed[0].args.p_reason).toBe("recipient_email_provider_rejected");
    // The receipt must NOT be written for a message that did not go out.
    expect(rpcCallsTo("couranr_mark_recipient_tracking_notification").length).toBe(0);
  });

  /*
   * The page-refresh case that started all of this. `sent` means the receipt is
   * already in the database, so a second pass — a refresh, a duplicated
   * webhook, the next tick — must put nothing on the wire.
   */
  it("sends nothing when the claim reports the invitation already went out", async () => {
    h.rpc.couranr_claim_consumer_recipient_tracking_delivery = claimReturns("sent");
    const p = provider();

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(p.calls.length).toBe(0);
    expect(report.results[0]).toMatchObject({ outcome: "skipped", reason: "sent" });
  });

  it("sends nothing while another worker holds the claim lease", async () => {
    h.rpc.couranr_claim_consumer_recipient_tracking_delivery = claimReturns("in_progress");
    const p = provider();

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(p.calls.length).toBe(0);
    expect(report.results[0]).toMatchObject({ outcome: "skipped", reason: "in_progress" });
  });

  /*
   * THE RETRY, end to end. Pass one fails and revokes; the SQL command then
   * issues a fresh token on pass two, so the key differs and the provider
   * genuinely re-sends rather than replaying a 24-hour-old response.
   */
  it("retries on the next tick with a different key after a revoke", async () => {
    h.rpc.couranr_claim_consumer_recipient_tracking_delivery = claimReturns("issued");
    h.rpc.couranr_mark_recipient_tracking_notification = { data: {}, error: null };

    const bad = refusingProvider();
    await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: bad.fetchImpl });
    expect(rpcCallsTo("couranr_fail_recipient_tracking_notification").length).toBe(1);

    const good = provider("msg_second");
    const second = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: good.fetchImpl });

    expect(good.calls.length).toBe(1);
    expect(second.results[0]).toMatchObject({ outcome: "sent" });
    const firstHash = rpcCallsTo("couranr_claim_consumer_recipient_tracking_delivery")[0].args
      .p_token_hash;
    const secondHash = rpcCallsTo("couranr_claim_consumer_recipient_tracking_delivery")[1].args
      .p_token_hash;
    expect(firstHash).not.toBe(secondHash);
    expect(good.calls[0].headers["Idempotency-Key"]).toContain(secondHash);
  });

  /*
   * A receipt that cannot be written means nothing can prove the link is live.
   * Fail closed: revoke and re-issue rather than leave an unaudited capability
   * in a recipient's inbox.
   */
  /*
   * The last leg of the idempotency doctrine, and the one this layer cannot
   * prove on its own: a replayed send returns the ORIGINAL provider id (Resend
   * documents that a same-payload replay answers with the original response),
   * so re-recording it must be a no-op rather than a conflict. That rule lives
   * in `couranr_mark_recipient_tracking_notification`, which this slice is not
   * allowed to modify — so this is a guard on the file, asserted against the
   * applied migration, not a claim about the running database.
   */
  it("records a same-provider-id replay as a no-op, per the applied SQL", () => {
    const sql = read(
      "supabase/migrations/20260916193159_couranr_recipient_attestation_and_tracking_delivery.sql"
    );
    const fn = sql.slice(
      sql.indexOf("create function public.couranr_mark_recipient_tracking_notification"),
      sql.indexOf("create function public.couranr_fail_recipient_tracking_notification")
    );
    expect(fn).toContain("if v_token.recipient_notified_at is not null then");
    expect(fn).toContain(
      "if v_token.recipient_notification_provider_id is distinct from v_provider_id then"
    );
    expect(fn).toContain("recipient_notification_already_recorded");
    // The same id falls through the conflict and returns the row unchanged.
    expect(fn).toMatch(/is distinct from v_provider_id then[\s\S]{0,200}end if;\s*return v_token;/);
    // And the TS wrapper hands the provider's id straight through.
    expect(read("lib/couranr/email/consumerLifecycle.ts")).toContain(
      "providerId: String(result.providerId ?? \"\")"
    );
  });

  it("revokes when the receipt cannot be recorded", async () => {
    h.rpc.couranr_claim_consumer_recipient_tracking_delivery = claimReturns("issued");
    h.rpc.couranr_mark_recipient_tracking_notification = {
      data: null,
      error: { code: "CR409", message: "recipient_notification_already_recorded" },
    };
    const p = provider();

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(report.results[0]).toMatchObject({ outcome: "failed", reason: "receipt_not_recorded" });
    expect(rpcCallsTo("couranr_fail_recipient_tracking_notification")[0].args.p_reason).toBe(
      "recipient_email_receipt_not_recorded"
    );
  });
});

describe("the lifecycle refuses to start work it cannot finish", () => {
  /*
   * An unarmed environment blocks every send. Claiming first and revoking after
   * would churn a token on every 5-minute tick forever, which is exactly what
   * the old inline block did in preview.
   */
  it("claims nothing at all when this environment cannot send mail", async () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.COURANR_EMAIL_SEND;
    const p = provider();

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(report.eligible).toBe(false);
    expect(report.reason).toBe("email_sending_not_armed");
    expect(h.rpcCalls.length).toBe(0);
    expect(p.calls.length).toBe(0);
  });

  /*
   * `couranr_claim_consumer_recipient_tracking_delivery` raises CR409 for a
   * merchant request, and the tick walks merchant requests constantly — so
   * calling it for them would manufacture one failure log per request per five
   * minutes.
   */
  it("does nothing for a merchant request", async () => {
    h.request = consumerRequest({ requester_kind: "merchant", business_account_id: "biz-1" });
    const p = provider();

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(report.eligible).toBe(false);
    expect(h.rpcCalls.length).toBe(0);
    expect(p.calls.length).toBe(0);
  });

  it("is total — a dead database is a report, not a throw", async () => {
    h.dbThrows = true;
    const p = provider();

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(report.reason).toBe("unhandled_error");
    expect(p.calls.length).toBe(0);
  });

  it("sends no invitation before the request is confirmed", async () => {
    h.request = consumerRequest({ request_state: "pending_couranr_review" });
    const p = provider();

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(rpcCallsTo("couranr_claim_consumer_recipient_tracking_delivery").length).toBe(0);
    expect(
      report.results.some((r) => r.notification === "recipient_delivery_invitation")
    ).toBe(false);
  });
});

/* ========================================================================
 * D — THE REST OF THE CONSUMER LIFECYCLE
 * ===================================================================== */

describe("consumer lifecycle notifications", () => {
  beforeEach(() => {
    h.rpc.couranr_claim_consumer_recipient_tracking_delivery = claimReturns("sent");
  });

  it("emails the sender when Couranr receives the request and when it confirms it", async () => {
    h.request = consumerRequest({ request_state: "pending_couranr_review" });
    h.requestEvents = [
      { id: "ev-recv", to_state: "pending_couranr_review", created_at: new Date().toISOString() },
    ];
    const p = provider();
    let report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });
    expect(report.results.map((r) => r.notification)).toContain("sender_request_received");
    expect(p.calls[0].body.to).toBe("avery@example.com");
    expect(p.calls[0].headers["Idempotency-Key"]).toContain(
      "couranr.consumer.sender_request_received/ev-recv"
    );

    h.request = consumerRequest();
    h.requestEvents = [
      { id: "ev-conf", to_state: "confirmed", created_at: new Date().toISOString() },
    ];
    const q = provider();
    report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: q.fetchImpl });
    expect(report.results.map((r) => r.notification)).toContain("sender_request_confirmed");
    expect(q.calls[0].headers["Idempotency-Key"]).toContain(
      "couranr.consumer.sender_request_confirmed/ev-conf"
    );
  });

  it("emails the recipient out-for-delivery and delivered, and the sender on failure and return", async () => {
    h.delivery = { id: DLV, proof_method: "photo_or_pin" };
    const now = new Date().toISOString();
    h.deliveryEvents = [
      { id: "ev-1", to_state: "in_transit", created_at: now },
      { id: "ev-2", to_state: "delivered", created_at: now },
      { id: "ev-3", to_state: "could_not_deliver", created_at: now },
      { id: "ev-4", to_state: "return_required", created_at: now },
    ];
    const p = provider();

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(report.results.map((r) => r.notification)).toEqual([
      "recipient_delivery_invitation",
      "recipient_out_for_delivery",
      "recipient_delivered",
      "sender_handoff_failed",
      "sender_return_notice",
    ]);
    // The recipient hears about their own delivery; the sender hears about the
    // problems, because the sender is the one who can act on them.
    expect(p.calls.map((c) => c.body.to)).toEqual([
      "jordan@example.com",
      "jordan@example.com",
      "avery@example.com",
      "avery@example.com",
    ]);
    // Every key is distinct and every key names its event row.
    const keys = p.calls.map((c) => c.headers["Idempotency-Key"]);
    expect(new Set(keys).size).toBe(keys.length);
    for (const [i, key] of keys.entries()) expect(key).toContain(`ev-${i + 1}`);
  });

  /*
   * THE GUARD THAT STOPS A PERMANENT RESEND. A confirmed request is scanned by
   * the tick forever, so the sweep must be bounded by `created_at`. Without the
   * `gte`, the 25th hour after a delivery sends a second real email.
   */
  it("bounds every event sweep by the lookback window", async () => {
    h.delivery = { id: DLV, proof_method: "signature" };
    h.requestEvents = [];
    h.deliveryEvents = [];
    const before = Date.now();
    await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: provider().fetchImpl });

    const sweeps = h.filters.filter(
      (f) =>
        f.method === "gte" &&
        ["couranr_delivery_request_events", "couranr_delivery_events"].includes(f.table)
    );
    expect(sweeps.length).toBe(2);
    for (const s of sweeps) {
      expect(s.args[0]).toBe("created_at");
      const cutoff = new Date(String(s.args[1])).getTime();
      const window = before - cutoff;
      expect(window).toBeGreaterThanOrEqual(
        CONSUMER_NOTIFICATION_LOOKBACK_MINUTES * 60 * 1000 - 5_000
      );
      expect(window).toBeLessThanOrEqual(
        CONSUMER_NOTIFICATION_LOOKBACK_MINUTES * 60 * 1000 + 5_000
      );
    }
  });

  /*
   * The standard lane auto-accepts inside the same call that produces
   * `confirmed`, so both request events sit in the sweep at once. Sending both
   * would put two emails a second apart in the sender's inbox, the second
   * contradicting the first.
   */
  it("does not also say 'received' once the request is already confirmed", async () => {
    const now = new Date().toISOString();
    h.requestEvents = [
      { id: "ev-recv", to_state: "pending_couranr_review", created_at: now },
      { id: "ev-conf", to_state: "confirmed", created_at: now },
    ];
    const p = provider();

    const report = await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(
      report.results.find((r) => r.notification === "sender_request_received")
    ).toMatchObject({ outcome: "skipped", reason: "already_past_review" });
    expect(p.calls.length).toBe(1);
    expect(p.calls[0].headers["Idempotency-Key"]).toContain("sender_request_confirmed/ev-conf");
  });

  it("skips an audience it has no address for rather than sending nowhere", async () => {
    h.request = consumerRequest({ consumer_contact_snapshot: { name: "Avery Chen" } });
    h.delivery = { id: DLV, proof_method: "leave_at_door" };
    h.deliveryEvents = [
      { id: "ev-9", to_state: "could_not_deliver", created_at: new Date().toISOString() },
    ];
    const p = provider();

    await notifyConsumerLifecycle({ requestId: REQ, fetchImpl: p.fetchImpl });

    expect(p.calls.length).toBe(0);
  });
});

/* ========================================================================
 * E — THE LIFECYCLE IS WIRED TO THE THINGS THAT ACTUALLY RUN
 * ===================================================================== */

describe("lifecycle wiring", () => {
  const ENGINE = read("lib/couranr/automation/engine.ts");
  /* COMMENTS STRIPPED before slicing. The prose around this function names
     every symbol the assertions look for AND uses the phrase "early-return",
     so an un-stripped slice would match its own explanation — which is the
     failure mode CLAUDE.md records as a migration test that "passed" by
     matching the sentence describing the rule. */
  const advance = (() => {
    const code = stripComments(ENGINE);
    return code.slice(
      code.indexOf("export async function advanceAutomaticFulfillment"),
      code.indexOf("async function advanceAutomaticFulfillmentState(\n")
    );
  })();

  it("runs the notification pass from advanceAutomaticFulfillment", () => {
    expect(ENGINE).toContain(
      'import { notifyConsumerLifecycle } from "@/lib/couranr/email/consumerLifecycle"'
    );
    expect(advance).toContain("notifyConsumerLifecycle({ requestId");
  });

  /*
   * OUTSIDE the early-return chain on purpose. A request that is already
   * confirmed must still get its recipient email when THIS tick's auto-accept
   * or auto-plan RPC happens to fail — those failures say nothing about
   * whether the recipient was told.
   */
  it("notifies even when the state machine returned early", () => {
    expect(advance).toContain("await advanceAutomaticFulfillmentState(requestId)");
    expect(advance.indexOf("notifyConsumerLifecycle")).toBeGreaterThan(
      advance.indexOf("advanceAutomaticFulfillmentState(requestId)")
    );
    // No `return` between the state call and the notify call.
    const between = advance.slice(
      advance.indexOf("advanceAutomaticFulfillmentState(requestId)"),
      advance.indexOf("notifyConsumerLifecycle")
    );
    expect(between).not.toContain("return");
  });

  it("cannot let a mail outage fail a payment webhook", () => {
    expect(advance).toContain("try {");
    expect(advance).toContain("} catch (err) {");
  });

  /*
   * THE RETRY MECHANISM, named. There is no queue and no outbox in this
   * database; the existing 5-minute cron scanning `confirmed` requests IS the
   * sweeper, and `advanceAutomaticFulfillment` is what it calls per request.
   */
  it("is swept by the existing 5-minute cron over confirmed requests", () => {
    const tick = ENGINE.slice(ENGINE.indexOf("export async function runAutomaticFulfillmentTick"));
    expect(tick).toContain('.in("request_state", ["pending_couranr_review", "confirmed"])');
    expect(tick).toContain("advanceAutomaticFulfillment(String(row.id))");
    expect(read("vercel.json")).toContain('"*/5 * * * *"');
    expect(read("app/api/couranr/internal/automation/tick/route.ts")).toContain(
      "runAutomaticFulfillmentTick"
    );
  });

  /* No queue, no outbox, no job table was introduced to make this work. */
  it("introduced no queue table", () => {
    const lifecycle = read("lib/couranr/email/consumerLifecycle.ts");
    for (const banned of ["couranr_email_queue", "couranr_notification", "_outbox", "job_queue"]) {
      expect(lifecycle).not.toContain(banned);
    }
  });
});

/* ========================================================================
 * F — NO EMAIL EVER CARRIES THE RECIPIENT PIN
 * ===================================================================== */

/**
 * The PIN is the whole point of the handoff. An emailed code is a code in a
 * forwarded thread, in a mail search index, in a screenshot and in whatever
 * scrapes the mailbox — and unlike a token it cannot be revoked.
 *
 * The test renders EVERY template in the system with PIN-shaped fields attached
 * to its input and asserts the digits never reach the HTML. The templates do
 * not declare those fields, which is exactly why this works as a guard: the day
 * someone adds `${input.pin}` to a template, this goes red.
 */
const PIN_SENTINEL = "492013";
const PIN_FIELDS = {
  pin: PIN_SENTINEL,
  code: PIN_SENTINEL,
  handoffCode: PIN_SENTINEL,
  recipientPin: PIN_SENTINEL,
  handoffPin: PIN_SENTINEL,
  pickupCode: PIN_SENTINEL,
  verificationCode: PIN_SENTINEL,
};

describe("no Couranr email can carry a handoff code", () => {
  const cfg = defaultEmailConfig;
  const s = buildSamples(cfg);
  const withPin = (input: any) => ({ ...input, ...PIN_FIELDS });

  /** template function name -> the sample it renders from. */
  const cases: Array<[string, (c: any, i: any) => any, any]> = [
    ["bizWorkspaceCreated", businessTemplates.bizWorkspaceCreated, s.business.workspaceCreated],
    ["bizActivationApproved", businessTemplates.bizActivationApproved, s.business.activationApproved],
    ["bizQuoteReady", businessTemplates.bizQuoteReady, s.business.quoteReady],
    ["bizPaymentReceipt", businessTemplates.bizPaymentReceipt, s.business.paymentReceipt],
    ["bizReviewOutcome", businessTemplates.bizReviewOutcome, s.business.reviewConfirmed],
    ["bizDeliveredReceipt", businessTemplates.bizDeliveredReceipt, s.business.deliveredReceipt],
    ["bizActionNeeded", businessTemplates.bizActionNeeded, s.business.actionNeeded],
    ["custApproveAndPay", customerTemplates.custApproveAndPay, s.customer.approveAndPay],
    ["custOrderConfirmed", customerTemplates.custOrderConfirmed, s.customer.orderConfirmed],
    [
      "custDirectDeliveryConfirmed",
      customerTemplates.custDirectDeliveryConfirmed,
      s.customer.directDeliveryConfirmed,
    ],
    ["custOutForDelivery", customerTemplates.custOutForDelivery, s.customer.outForDelivery],
    ["custDelivered", customerTemplates.custDelivered, s.customer.delivered],
    [
      "custRecipientUnavailable",
      customerTemplates.custRecipientUnavailable,
      s.customer.recipientUnavailable,
    ],
    ["custReturnNotice", customerTemplates.custReturnNotice, s.customer.returnNotice],
    [
      "consumerSenderRequestReceived",
      consumerTemplates.consumerSenderRequestReceived,
      s.consumer.senderRequestReceived,
    ],
    [
      "consumerSenderRequestConfirmed",
      consumerTemplates.consumerSenderRequestConfirmed,
      s.consumer.senderRequestConfirmed,
    ],
    [
      "consumerRecipientOutForDelivery",
      consumerTemplates.consumerRecipientOutForDelivery,
      s.consumer.recipientOutForDelivery,
    ],
    [
      "consumerRecipientDelivered",
      consumerTemplates.consumerRecipientDelivered,
      s.consumer.recipientDelivered,
    ],
    [
      "consumerSenderHandoffFailed",
      consumerTemplates.consumerSenderHandoffFailed,
      s.consumer.senderHandoffFailed,
    ],
    [
      "consumerSenderReturnNotice",
      consumerTemplates.consumerSenderReturnNotice,
      s.consumer.senderReturnNotice,
    ],
  ];

  /*
   * A guard over "every template" is worth nothing if the list of templates is
   * hand-maintained and goes stale. This compares the list against what the
   * modules actually export, so a new template that is not covered fails here
   * rather than shipping unguarded.
   */
  it("covers every exported template function", () => {
    const exported = [businessTemplates, customerTemplates, consumerTemplates]
      .flatMap((m) => Object.entries(m))
      .filter(([, v]) => typeof v === "function")
      .map(([k]) => k)
      .sort();
    const covered = [...new Set(cases.map(([name]) => name))].sort();
    expect(covered).toEqual(exported);
  });

  it("renders every template with PIN-shaped input and leaks no digits", () => {
    for (const [name, fn, sample] of cases) {
      const rendered = fn(cfg, withPin(sample));
      expect(rendered.html, `${name} leaked the PIN`).not.toContain(PIN_SENTINEL);
      expect(rendered.subject, `${name} subject leaked the PIN`).not.toContain(PIN_SENTINEL);
      expect(rendered.preheader, `${name} preheader leaked the PIN`).not.toContain(PIN_SENTINEL);
    }
    for (const a of allAuthEmails(cfg)) {
      expect(a.html, `${a.key} leaked the PIN`).not.toContain(PIN_SENTINEL);
    }
  });

  /*
   * POSITIVE CONTROL. A "the digits are absent" assertion is a claim about the
   * assertion before it is a claim about the templates, so prove it can fail:
   * a template that DOES interpolate the sentinel must be caught.
   */
  it("would catch a template that did interpolate a code", () => {
    const leaky = (c: any, i: any) => ({
      subject: "x",
      preheader: "y",
      html: `<p>Your code is ${i.pin}</p>`,
    });
    expect(leaky(cfg, withPin(s.consumer.recipientOutForDelivery)).html).toContain(PIN_SENTINEL);
  });

  /*
   * Belt and braces on the ONE template that legitimately talks about a code:
   * it must say where the code lives, and it must not contain a digit run that
   * could be read as one.
   */
  it("tells the recipient where the code is without printing one", () => {
    const out = consumerTemplates.consumerRecipientOutForDelivery(cfg, {
      ...s.consumer.recipientOutForDelivery,
      codeOnTrackingPage: true,
    });
    expect(out.html.toLowerCase()).toContain("tracking link");
    expect(out.html).not.toMatch(/\bcode is\s*:?\s*\d/i);
    expect(out.html).not.toMatch(/\bPIN[:=]?\s*\d/);
  });

  /*
   * Couranr Same Day notifies by EMAIL. Nothing a customer reads may imply a
   * text message. Asserted on what actually renders rather than on the source,
   * because the source says "NO SMS" in a comment and a guard that trips over
   * its own justification proves nothing about the product.
   */
  it("claims no SMS anywhere in the consumer lane", () => {
    const rendered = [
      consumerTemplates.consumerSenderRequestReceived(cfg, s.consumer.senderRequestReceived),
      consumerTemplates.consumerSenderRequestConfirmed(cfg, s.consumer.senderRequestConfirmed),
      consumerTemplates.consumerRecipientOutForDelivery(cfg, s.consumer.recipientOutForDelivery),
      consumerTemplates.consumerRecipientDelivered(cfg, s.consumer.recipientDelivered),
      consumerTemplates.consumerSenderHandoffFailed(cfg, s.consumer.senderHandoffFailed),
      consumerTemplates.consumerSenderReturnNotice(cfg, s.consumer.senderReturnNotice),
      customerTemplates.custDirectDeliveryConfirmed(cfg, s.customer.directDeliveryConfirmed),
    ];
    for (const e of rendered) {
      const body = e.html.toLowerCase();
      for (const banned of [" sms", "text message", "we text", "by text", "we'll text"]) {
        expect(body, `${e.subject} mentioned ${banned}`).not.toContain(banned);
      }
    }
  });
});

/* ========================================================================
 * G — EVERY TEMPLATE IS IN THE PREVIEW GALLERY
 * ===================================================================== */

describe("the preview gallery is complete", () => {
  it("registers every consumer lifecycle template", () => {
    const subjects = collectEmails(defaultEmailConfig).map((e) => e.subject);
    const s = buildSamples(defaultEmailConfig);
    const expected = [
      consumerTemplates.consumerSenderRequestReceived(
        defaultEmailConfig,
        s.consumer.senderRequestReceived
      ),
      consumerTemplates.consumerSenderRequestConfirmed(
        defaultEmailConfig,
        s.consumer.senderRequestConfirmed
      ),
      consumerTemplates.consumerRecipientOutForDelivery(
        defaultEmailConfig,
        s.consumer.recipientOutForDelivery
      ),
      consumerTemplates.consumerRecipientDelivered(
        defaultEmailConfig,
        s.consumer.recipientDelivered
      ),
      consumerTemplates.consumerSenderHandoffFailed(
        defaultEmailConfig,
        s.consumer.senderHandoffFailed
      ),
      consumerTemplates.consumerSenderReturnNotice(
        defaultEmailConfig,
        s.consumer.senderReturnNotice
      ),
    ].map((e) => e.subject);
    for (const subject of expected) expect(subjects).toContain(subject);
  });

  it("gives every consumer template a sample", () => {
    const s = buildSamples(defaultEmailConfig);
    expect(Object.keys(s.consumer).sort()).toEqual(
      [
        "recipientDelivered",
        "recipientOutForDelivery",
        "senderHandoffFailed",
        "senderRequestConfirmed",
        "senderRequestReceived",
        "senderReturnNotice",
      ].sort()
    );
  });
});
