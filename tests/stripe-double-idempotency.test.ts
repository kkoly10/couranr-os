import { afterAll, beforeAll, describe, expect, it } from "vitest";
// @ts-expect-error — the harness double is plain ESM, deliberately untyped.
import { startStripeDouble, failNextCaptures } from "../e2e/stripeDouble.mjs";

/**
 * Contract test for the Stripe double's capture idempotency.
 *
 * The double is what every payment assertion in the browser suite is measured
 * against, so a divergence from Stripe does not fail — it makes a broken thing
 * look correct. That is not hypothetical here: the double memoised only
 * SUCCESSFUL captures, which quietly made an idempotency key look reusable
 * after a failure, and that is the only reason an obligation-scoped capture key
 * passed Group N. Against real Stripe every retry would have replayed the first
 * attempt's failure for 24 hours and the reconcile-and-retry path could never
 * have recovered anything.
 *
 * Stripe's contract, quoted rather than remembered: it saves "the resulting
 * status code and body of the first request made for any given idempotency
 * key, regardless of whether it succeeded or failed. Subsequent requests with
 * the same key return the same result, including 500 errors."
 * (https://docs.stripe.com/api/idempotent_requests)
 *
 * So these assertions exist to make the CYCLE-SCOPED capture key load-bearing:
 * revert it to an obligation-only key and the recovery path stops working,
 * here and in Group N, instead of passing on a forgiving double.
 */

const PORT = 12787;
const BASE = `http://127.0.0.1:${PORT}`;
let server: any;

async function createManualIntent(amount = 3064): Promise<string> {
  const res = await fetch(`${BASE}/v1/payment_intents`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      amount: String(amount),
      currency: "usd",
      capture_method: "manual",
    }).toString(),
  });
  const body: any = await res.json();
  // Confirmation under manual capture HOLDS the funds; it does not take them.
  await fetch(`${BASE}/__control/confirm/${body.id}`);
  return body.id;
}

function capture(intentId: string, key: string) {
  return fetch(`${BASE}/v1/payment_intents/${intentId}/capture`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "idempotency-key": key,
    },
    body: "",
  });
}

beforeAll(async () => {
  ({ server } = await startStripeDouble(PORT));
});

afterAll(() => {
  server?.close();
});

describe("stripe double — capture idempotency", () => {
  it("replays a FAILED capture to the same key, as Stripe does", async () => {
    const intent = await createManualIntent();
    const key = `test:capture:${intent}:v1`;

    failNextCaptures(1);
    const first = await capture(intent, key);
    expect(first.status).toBe(500);

    // The fault injector was consumed, so a forgiving double would now succeed.
    // Stripe would not: the key already holds a result.
    const replay = await capture(intent, key);
    expect(replay.status).toBe(500);

    // And the money genuinely did not move.
    const check = await fetch(`${BASE}/v1/payment_intents/${intent}`);
    const body: any = await check.json();
    expect(body.status).toBe("requires_capture");
    expect(body.amount_received).toBe(0);
  });

  /*
   * The property the whole recovery path rests on. A new capture CYCLE means a
   * new key, so the retry reaches Stripe instead of being answered from the
   * failed attempt's memo.
   */
  it("a new cycle key captures even after the previous cycle failed", async () => {
    const intent = await createManualIntent(2599);
    failNextCaptures(1);
    expect((await capture(intent, `test:capture:${intent}:v1`)).status).toBe(500);

    const retry = await capture(intent, `test:capture:${intent}:v3`);
    expect(retry.status).toBe(200);
    const body: any = await retry.json();
    expect(body.status).toBe("succeeded");
    expect(body.amount_received).toBe(2599);
  });

  it("replays a SUCCESSFUL capture to the same key rather than capturing twice", async () => {
    const intent = await createManualIntent(1500);
    const key = `test:capture:${intent}:v2`;

    const first: any = await (await capture(intent, key)).json();
    const second: any = await (await capture(intent, key)).json();
    expect(first.id).toBe(second.id);
    expect(second.status).toBe("succeeded");
    expect(second.amount_received).toBe(1500);
  });

  /*
   * The response that made "any 4xx means nothing was taken" dangerous. The
   * double answered 200 here until this was fixed, which hid the branch that
   * would have released a hold over money that had already moved.
   */
  it("refuses to capture an already-captured intent under a new key", async () => {
    const intent = await createManualIntent(999);
    expect((await capture(intent, `test:capture:${intent}:v1`)).status).toBe(200);

    const again = await capture(intent, `test:capture:${intent}:v9`);
    expect(again.status).toBe(400);
    const body: any = await again.json();
    expect(body.error.code).toBe("payment_intent_unexpected_state");
  });

  it("never captures an intent that was never authorized", async () => {
    const res = await fetch(`${BASE}/v1/payment_intents`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        amount: "1000",
        currency: "usd",
        capture_method: "manual",
      }).toString(),
    });
    const created: any = await res.json();
    // No confirmation, so the intent is still requires_payment_method.
    const attempt = await capture(created.id, `test:capture:${created.id}:v1`);
    expect(attempt.status).toBe(400);
  });
});
