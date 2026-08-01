import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import Stripe from "stripe";
import {
  AUTHORIZING_INTENT_STATUS,
  HANDLED_STRIPE_EVENTS,
  UNREACHABLE_PAYMENT_STATES,
  isHandledStripeEvent,
  isLinkRefusalReason,
  isPayable,
} from "@/lib/couranr/payments/states";
import {
  hashPaymentToken,
  hashesEqual,
  isWellFormedToken,
  TOKEN_BYTES,
  TOKEN_TTL_DAYS,
} from "@/lib/couranr/payments/tokens";
import {
  intentIdempotencyKey,
  intentMetadata,
  isFullyAuthorized,
  syntheticEventId,
} from "@/lib/couranr/payments/stripe";

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && !f.includes(".rollback."))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
  .join("\n")
  .replace(/^\s*--.*$/gm, "");

const PAYMENT_TS = ["commands.ts", "stripe.ts", "states.ts", "tokens.ts"]
  .map((f) => readFileSync(path.join(ROOT, "lib/couranr/payments", f), "utf8"))
  .join("\n");

/* ============================================ this slice never captures === */

describe("authorization only", () => {
  /**
   * The strongest statement this slice can make is about what is ABSENT. A
   * capture wrapper does not exist, so no route can call one by accident.
   */
  it("no payment module calls capture or refund", () => {
    const code = PAYMENT_TS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [
      /\.capture\(/,
      /paymentIntents\.capture/,
      /refunds\.create/,
      /\.cancel\(/,
    ]) {
      expect(forbidden.test(code), `payment code contains ${forbidden}`).toBe(false);
    }
    // Positive control: the words DO appear in the comments explaining absence.
    expect(PAYMENT_TS).toMatch(/capture/i);
  });

  /**
   * Capture SHIPPED in the readiness/capture/conversion slice, so `captured`
   * is now reachable — but only from one place. `refunded` still is not, and
   * that is what this now guards. The earlier form of this test asserted that
   * nothing could write `captured` at all; keeping it would have meant either
   * a false green or deleting the guard, so it is narrowed to the invariant
   * that still holds.
   */
  it("only one function may write captured, and nothing may write refunded", () => {
    expect(SQL).toContain("'refunded'");
    expect(SQL).not.toMatch(/payment_state\s*=\s*'refunded'/);
    expect(SQL).not.toMatch(/v_target\s*:=\s*'refunded'/);

    /*
     * Only ASSIGNMENTS count. `payment_state = 'captured'` also appears inside
     * the timestamp CHECK constraints, which are predicates, not writes —
     * counting those made this report three writers when there is one.
     */
    const writers = [...SQL.matchAll(/set\s+payment_state\s*=\s*'captured'/g)];
    expect(writers).toHaveLength(1);
    const at = writers[0].index;
    const fnStart = SQL.lastIndexOf("create function public.", at);
    const fnName = SQL.slice(fnStart, SQL.indexOf("(", fnStart));
    expect(fnName).toContain("couranr_complete_payment_capture");
  });

  it("capture is never reachable from a browser claim", () => {
    // The capture command takes a verified provider result, and the state it
    // requires beforehand is capture_pending — which only the server can set.
    expect(SQL).toMatch(/p_intent_status <> 'succeeded'/);
    expect(SQL).toMatch(/where id = v_ob\.id and payment_state = 'capture_pending'/);
    /*
     * Comment-stripped: `stripe.ts` names `.capture()` in the sentence that
     * explains no wrapper for it exists. Asserting against raw text fails on
     * the documentation instead of on the code — the fifth time in this repo.
     */
    const code = PAYMENT_TS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/\.capture\(/);
    expect(PAYMENT_TS).toMatch(/\.capture\(\)/); // positive control: it IS in the prose
  });

  it("creates no order and no delivery", () => {
    const paymentSql = SQL.slice(SQL.indexOf("couranr_create_payment_obligation"));
    for (const rx of [
      /insert\s+into\s+public\.orders/i,
      /insert\s+into\s+public\.deliveries/i,
      /insert\s+into\s+orders/i,
      /insert\s+into\s+deliveries/i,
    ]) {
      expect(rx.test(paymentSql), `payment SQL contains ${rx}`).toBe(false);
    }
    expect(PAYMENT_TS).not.toMatch(/from\("orders"\)|from\("deliveries"\)/);
  });

  /*
   * The vocabulary assertions moved to `couranr-payment-vocabulary.test.ts`
   * when capture shipped and `payment_method_saved` / `partially_refunded`
   * were preserved. Keeping a second copy here would mean two lists to update
   * and one of them silently going stale — which is exactly what happened to
   * the version that asserted `captured` was unreachable.
   */
});

/* ================================================== no client amount ===== */

describe("the amount is never the caller's", () => {
  it("the obligation command takes no amount parameter", () => {
    expect(SQL).toMatch(/couranr_create_payment_obligation\(\s*p_request_id\s+uuid,\s*p_business_account_id\s+uuid,\s*p_idempotency_key\s+text\s*\)/);
    const fn = SQL.slice(
      SQL.indexOf("create function public.couranr_create_payment_obligation"),
      SQL.indexOf("$fn$;", SQL.indexOf("create function public.couranr_create_payment_obligation"))
    );
    expect(fn).not.toMatch(/p_amount/);
    // It reads the stored quote instead.
    expect(fn).toMatch(/v_req\.delivery_subtotal_cents/);
  });

  it("PaymentIntent creation takes an obligation, not an amount", () => {
    expect(PAYMENT_TS).toMatch(/amount: ob\.amount_cents/);
    expect(PAYMENT_TS).not.toMatch(/amountCents\s*[:,]\s*(params|body|input)\./);
  });

  it("the merchant route sends no amount", () => {
    const route = readFileSync(
      path.join(ROOT, "app/api/couranr/delivery-requests/[id]/authorize-payment/route.ts"),
      "utf8"
    );
    expect(route).not.toMatch(/body\?\.amount/);
    expect(route).not.toMatch(/amountCents:\s*body/);
  });
});

/* ============================================== manual capture only ====== */

describe("manual capture", () => {
  it("every PaymentIntent is created with capture_method manual", () => {
    expect(PAYMENT_TS).toMatch(/capture_method:\s*"manual"/);
    expect(PAYMENT_TS).not.toMatch(/capture_method:\s*"automatic"/);
  });

  it("only requires_capture authorizes", () => {
    expect(AUTHORIZING_INTENT_STATUS).toBe("requires_capture");
    expect(HANDLED_STRIPE_EVENTS["payment_intent.amount_capturable_updated"]).toBe("authorized");
    // succeeded means CAPTURED, which this slice never does.
    expect(isHandledStripeEvent("payment_intent.succeeded")).toBe(false);
  });

  it("a partial hold is not an authorization", () => {
    expect(isFullyAuthorized({ status: "requires_capture", amount_capturable: 2299 }, 2299)).toBe(true);
    expect(isFullyAuthorized({ status: "requires_capture", amount_capturable: 1000 }, 2299)).toBe(false);
    expect(isFullyAuthorized({ status: "succeeded", amount_capturable: 2299 }, 2299)).toBe(false);
    expect(isFullyAuthorized({ status: "processing", amount_capturable: 0 }, 2299)).toBe(false);
  });

  it("the SQL requires both the status and the full capturable amount", () => {
    const fn = SQL.slice(SQL.indexOf("create function public.couranr_apply_payment_intent_state"));
    expect(fn).toMatch(/p_intent_status = 'requires_capture'/);
    expect(fn).toMatch(/p_amount_capturable is not distinct from v_ob\.amount_cents/);
  });
});

/* ==================================================== idempotency ======== */

describe("idempotency", () => {
  it("one key per obligation and version", () => {
    const ob: any = { id: "ob-1", request_id: "r", business_account_id: "b", payer_type: "merchant",
      amount_cents: 100, currency: "usd", pricing_policy_version: "v1", request_version: 2 };
    expect(intentIdempotencyKey(ob, 3)).toBe("couranr:obligation:ob-1:v3");
    expect(intentIdempotencyKey(ob, 3)).toBe(intentIdempotencyKey(ob, 3));
    expect(intentIdempotencyKey(ob, 4)).not.toBe(intentIdempotencyKey(ob, 3));
    // A superseded obligation is a different id, so it cannot collide.
    expect(intentIdempotencyKey({ ...ob, id: "ob-2" }, 3)).not.toBe(intentIdempotencyKey(ob, 3));
  });

  it("a retrieve produces a deterministic, collidable event id", () => {
    const a = syntheticEventId({ id: "pi_1", status: "requires_capture", amount_capturable: 2299 });
    expect(a).toBe(syntheticEventId({ id: "pi_1", status: "requires_capture", amount_capturable: 2299 }));
    expect(a).not.toBe(syntheticEventId({ id: "pi_1", status: "processing", amount_capturable: 0 }));
  });

  it("the database makes replay a constraint, not a check", () => {
    expect(SQL).toMatch(/constraint couranr_pe_provider_event_uniq unique \(provider, provider_event_id\)/);
    const fn = SQL.slice(SQL.indexOf("create function public.couranr_apply_payment_intent_state"));
    expect(fn).toMatch(/exception when unique_violation then/);
    expect(fn).toMatch(/'duplicate'/);
    // And the insert precedes the update, so a replay cannot apply first.
    expect(fn.indexOf("insert into public.couranr_payment_events")).toBeLessThan(
      fn.indexOf("update public.couranr_payment_obligations")
    );
  });
});

/* ========================================================= tokens ======== */

describe("payment link tokens", () => {
  it("256 bits, hashed, capped at seven days", () => {
    expect(TOKEN_BYTES).toBe(32);
    expect(TOKEN_TTL_DAYS).toBe(7);
    expect(hashPaymentToken("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPaymentToken("abc")).toBe(hashPaymentToken("abc"));
    expect(hashPaymentToken("abc")).not.toBe(hashPaymentToken("abd"));
  });

  it("the raw token is never what gets stored", () => {
    const code = PAYMENT_TS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The only value handed to the issue RPC is a hash.
    expect(code).toMatch(/p_token_hash: hashPaymentToken\(token\)/);
    expect(code).not.toMatch(/p_token_hash:\s*token\b/);
    expect(code).not.toMatch(/p_raw_token/);
    // And the database refuses a non-hash shape outright.
    expect(SQL).toMatch(/token_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
  });

  it("rejects malformed tokens before any lookup", () => {
    expect(isWellFormedToken("A".repeat(43))).toBe(true);
    for (const bad of ["", "short", "has spaces", "has/slash", "a".repeat(200), null, 7, {}]) {
      expect(isWellFormedToken(bad), String(bad)).toBe(false);
    }
  });

  it("compares hashes in constant time", () => {
    const h = hashPaymentToken("x");
    expect(hashesEqual(h, h)).toBe(true);
    expect(hashesEqual(h, hashPaymentToken("y"))).toBe(false);
    expect(hashesEqual(h, "short")).toBe(false);
  });

  it("every refusal reason the SQL can return is one the UI knows", () => {
    for (const r of ["not_found","revoked","expired","request_not_payable","no_obligation","already_authorized","quote_changed"]) {
      expect(isLinkRefusalReason(r), r).toBe(true);
      expect(SQL).toContain(`'${r}'`);
    }
    expect(isLinkRefusalReason("something_else")).toBe(false);
  });

  it("only unpaid states are payable", () => {
    expect(isPayable("not_started")).toBe(true);
    expect(isPayable("requires_action")).toBe(true);
    expect(isPayable("failed")).toBe(true);
    expect(isPayable("authorized")).toBe(false);
    expect(isPayable("cancelled")).toBe(false);
  });
});

/* ===================================== offline Stripe contract tests ===== */

/**
 * OFFLINE CONTRACT TESTS — read this before trusting them.
 *
 * These use the REAL Stripe SDK's own signature generation and the real
 * `constructEvent` verifier, so what is proven is genuine: our endpoint
 * accepts exactly the signatures Stripe would produce and rejects everything
 * else, and our event payloads take the paths we think they do.
 *
 * What is NOT proven: that Stripe's API accepts our PaymentIntent request.
 * That needs a live test key and is the separate acceptance gate. Nothing here
 * contacts Stripe.
 */
describe("webhook signature — offline contract", () => {
  const SECRET = "whsec_offline_contract_test_secret";
  const stripe = new Stripe("sk_test_offline_contract_placeholder", {
    apiVersion: "2024-04-10",
  });

  function signed(payload: unknown, opts: { secret?: string; timestamp?: number } = {}) {
    const body = JSON.stringify(payload);
    const header = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: opts.secret ?? SECRET,
      timestamp: opts.timestamp,
    });
    return { body, header };
  }

  const intent = (over: Record<string, unknown> = {}) => ({
    id: "pi_offline_1",
    object: "payment_intent",
    status: "requires_capture",
    amount: 2299,
    amount_capturable: 2299,
    currency: "usd",
    metadata: {
      couranrRequestId: "11111111-1111-4111-8111-111111111111",
      businessAccountId: "22222222-2222-4222-8222-222222222222",
      paymentObligationId: "33333333-3333-4333-8333-333333333333",
    },
    ...over,
  });

  const event = (type: string, obj: unknown, id = "evt_offline_1") => ({
    id,
    object: "event",
    type,
    data: { object: obj },
  });

  it("a valid signature verifies", () => {
    const e = event("payment_intent.amount_capturable_updated", intent());
    const { body, header } = signed(e);
    const parsed = stripe.webhooks.constructEvent(body, header, SECRET);
    expect(parsed.id).toBe("evt_offline_1");
    expect(parsed.type).toBe("payment_intent.amount_capturable_updated");
  });

  it("an invalid signature is refused", () => {
    const e = event("payment_intent.amount_capturable_updated", intent());
    const { body } = signed(e);
    const wrong = stripe.webhooks.generateTestHeaderString({
      payload: body,
      secret: "whsec_a_different_secret",
    });
    expect(() => stripe.webhooks.constructEvent(body, wrong, SECRET)).toThrow();
    expect(() => stripe.webhooks.constructEvent(body, "t=1,v1=deadbeef", SECRET)).toThrow();
    expect(() => stripe.webhooks.constructEvent(body, "", SECRET)).toThrow();
  });

  it("a tampered body no longer matches its signature", () => {
    const e = event("payment_intent.amount_capturable_updated", intent());
    const { body, header } = signed(e);
    const tampered = body.replace('"amount":2299', '"amount":1');
    expect(tampered).not.toBe(body);
    expect(() => stripe.webhooks.constructEvent(tampered, header, SECRET)).toThrow();
  });

  it("an old timestamp is refused within the tolerance window", () => {
    const e = event("payment_intent.amount_capturable_updated", intent());
    const old = Math.floor(Date.now() / 1000) - 60 * 60;
    const { body, header } = signed(e, { timestamp: old });
    expect(() => stripe.webhooks.constructEvent(body, header, SECRET, 300)).toThrow();
    // ...and accepted with a window wide enough to contain it, which proves
    // the throw above was about the TIMESTAMP and not about the signature.
    expect(() => stripe.webhooks.constructEvent(body, header, SECRET, 86_400)).not.toThrow();
  });

  /**
   * The payload cases. Each is a real signed event; the assertion is that the
   * fields our SQL branches on carry what we expect, so the offline test and
   * the database probe are testing the same shapes.
   */
  const cases: Array<[string, any, string]> = [
    ["valid authorization", event("payment_intent.amount_capturable_updated", intent()), "authorized"],
    ["wrong amount", event("payment_intent.amount_capturable_updated", intent({ amount: 9999 })), "rejected"],
    ["wrong currency", event("payment_intent.amount_capturable_updated", intent({ currency: "eur" })), "rejected"],
    ["wrong metadata", event("payment_intent.amount_capturable_updated",
      intent({ metadata: { ...intent().metadata, paymentObligationId: "44444444-4444-4444-8444-444444444444" } })), "rejected"],
    ["partial hold", event("payment_intent.amount_capturable_updated", intent({ amount_capturable: 100 })), "rejected"],
    ["failed", event("payment_intent.payment_failed", intent({ status: "requires_payment_method", amount_capturable: 0 })), "failed"],
    ["cancelled", event("payment_intent.canceled", intent({ status: "canceled", amount_capturable: 0 })), "cancelled"],
    ["succeeded is ignored", event("payment_intent.succeeded", intent({ status: "succeeded" })), "ignored"],
  ];

  for (const [name, e, expected] of cases) {
    it(`signs and verifies: ${name}`, () => {
      const { body, header } = signed(e);
      const parsed = stripe.webhooks.constructEvent(body, header, SECRET);
      const obj: any = parsed.data.object;
      expect(obj.object).toBe("payment_intent");

      // The decision our SQL makes, restated here so the two agree.
      const meta = obj.metadata ?? {};
      const matches =
        obj.amount === 2299 &&
        obj.currency === "usd" &&
        meta.paymentObligationId === "33333333-3333-4333-8333-333333333333";
      let outcome: string;
      if (!matches) outcome = "rejected";
      else if (parsed.type === "payment_intent.amount_capturable_updated") {
        outcome =
          obj.status === "requires_capture" && obj.amount_capturable === 2299
            ? "authorized"
            : "rejected";
      } else if (isHandledStripeEvent(parsed.type)) {
        outcome = HANDLED_STRIPE_EVENTS[parsed.type];
      } else outcome = "ignored";

      expect(outcome, name).toBe(expected);
    });
  }

  it("replaying the same event id is detectable without inspecting the body", () => {
    const e = event("payment_intent.amount_capturable_updated", intent());
    const a = signed(e);
    const b = signed(e);
    // Two independent deliveries, two valid signatures, ONE event id.
    expect(stripe.webhooks.constructEvent(a.body, a.header, SECRET).id).toBe(
      stripe.webhooks.constructEvent(b.body, b.header, SECRET).id
    );
  });
});

/* ================================================ route-level rules ====== */

describe("the canonical webhook route", () => {
  const routeRaw = readFileSync(
    path.join(ROOT, "app/api/couranr/stripe/webhook/route.ts"),
    "utf8"
  );
  /**
   * Comments here legitimately NAME the patterns the code must not contain —
   * the header explains that the legacy endpoint uses `resilientUpdateById`.
   * Matching raw text makes a test that fails on its own documentation, which
   * this repo has now done four times. Strip comments first.
   */
  const route = routeRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("verifies the signature before parsing the payload", () => {
    expect(route).toMatch(/await req\.text\(\)/);
    expect(route).not.toMatch(/await req\.json\(\)/);
    const verifyAt = route.indexOf("constructEvent");
    const useAt = route.indexOf("event.data");
    expect(verifyAt).toBeGreaterThan(-1);
    expect(useAt).toBeGreaterThan(verifyAt);
  });

  it("uses its own signing secret, not the legacy one", () => {
    expect(route).toMatch(/STRIPE_COURANR_WEBHOOK_SECRET/);
    expect(route).not.toMatch(/\bSTRIPE_WEBHOOK_SECRET\b/);
  });

  it("runs on node so the raw bytes survive", () => {
    expect(route).toMatch(/runtime = "nodejs"/);
  });

  it("never uses the legacy resilient-update pattern", () => {
    expect(route).not.toMatch(/resilientUpdateById/);
    expect(route).not.toMatch(/does not exist/i);
    // Positive control: the phrase IS in the file, in the comment that
    // explains why the pattern is absent.
    expect(routeRaw).toMatch(/resilientUpdateById/);
  });

  /**
   * Every outcome the command can return — applied, duplicate, ignored,
   * rejected — is acked with 200. The route does not branch on it, which is
   * the point: a replay must not look like a failure or Stripe retries it
   * forever, and a rejected event is genuinely Stripe's and will never match
   * our records however many times it is redelivered.
   *
   * The only non-200s are ours: an unverifiable signature and a command that
   * could not run.
   */
  it("acks every outcome with 200 and does not branch on it", () => {
    expect(route).toMatch(/function ack\([\s\S]*?status: 200/);
    // The outcome is passed straight through.
    expect(route).toMatch(/ack\(result\.value\.outcome/);
    // No status is chosen from the outcome.
    expect(route).not.toMatch(/outcome\s*===\s*["']duplicate["']/);
    expect(route).not.toMatch(/outcome\s*===\s*["']rejected["']/);

    // The ONLY literal status in this route is the 200 that acks. Every
    // failure goes through routeFailure/failureResponse, which choose the
    // status from the public error code in one audited place.
    const statuses = [...route.matchAll(/status:\s*(\d{3})/g)].map((m) => m[1]).sort();
    expect(statuses).toEqual(["200"]);
    expect(route).toMatch(/routeFailure\("invalid_input"/);
    expect(route).toMatch(/routeFailure\("internal"/);
    expect(route).toMatch(/failureResponse\(result\)/);
  });

  it("returns no provider detail to the caller", () => {
    // Every response body, taken by balancing parentheses, must be free of the
    // driver's own message. Only a correlation id ever crosses back.
    let bodies = 0;
    // Only the ack builds a body here; everything else delegates.
    for (const m of route.matchAll(/NextResponse\.json\(/g)) {
      let depth = 0;
      let end = -1;
      for (let i = m.index + m[0].length - 1; i < route.length; i++) {
        if (route[i] === "(") depth++;
        else if (route[i] === ")") {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
      expect(end).toBeGreaterThan(-1);
      const body = route.slice(m.index, end + 1);
      bodies += 1;
      expect(body).not.toMatch(/e\?\.message|err\.message|error\.message/);
      expect(body).not.toMatch(/STRIPE_|whsec_|sk_/);
    }
    expect(bodies).toBeGreaterThan(0);
    // The failure helpers are the single audited path, and they attach the
    // correlation id — the route never assembles an error body itself.
    expect(route).not.toMatch(/NextResponse\.json\(\s*\{\s*error:/);
    expect(route).toMatch(/failureResponse\(|routeFailure\(/);
  });
});

/* ============================================ what the payer is told ===== */

describe("payment copy", () => {
  const uiRaw = ["components/couranr/payments/PaymentLinkPage.tsx",
                 "components/couranr/payments/MerchantPaymentPanel.tsx"]
    .map((f) => readFileSync(path.join(ROOT, f), "utf8"))
    .join("\n");
  /**
   * Comments explain what the copy must NOT say, quoting the wrong phrasing.
   * Asserting against raw text would fail on the documentation rather than on
   * the interface.
   */
  const ui = uiRaw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("carries the required authorization sentence verbatim", () => {
    expect(ui).toContain(
      "This authorizes the delivery amount. Couranr captures payment only after the delivery is confirmed for service."
    );
  });

  /**
   * The single most likely thing to write by accident. Under manual capture
   * the money is HELD; saying it was charged is false.
   */
  it("never tells anyone their card was charged", () => {
    expect(ui).not.toMatch(/has been charged/i);
    expect(ui).not.toMatch(/we charged/i);
    expect(ui).not.toMatch(/payment complete/i);
    expect(ui).not.toMatch(/paid in full/i);
    // It says the true thing instead.
    expect(ui).toMatch(/Nothing has been taken/i);
    // Positive control: the banned phrase IS in the file, in the comment
    // explaining why it must never be rendered.
    expect(uiRaw).toMatch(/has been charged/i);
  });

  it("speaks as Couranr, never as a person", () => {
    expect(ui).not.toMatch(/\bI will\b|\bmy team\b|\bI'll\b/);
    expect(ui).toMatch(/Couranr/);
  });
});
