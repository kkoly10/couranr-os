/**
 * A local stand-in for api.stripe.com.
 *
 * The dev server's Stripe SDK is pointed here with `STRIPE_API_BASE`, so it
 * builds and sends its REAL HTTP request — same path, same form encoding, same
 * `Idempotency-Key` header — and this records it. That is what makes the
 * payment flows drivable in a container with no Stripe credentials.
 *
 * WHAT THIS PROVES: the request Couranr builds is correct, and Couranr reacts
 * correctly to each response. WHAT IT DOES NOT PROVE: that Stripe accepts it.
 * That is PAYMENT_REAL_STRIPE_VERIFICATION, a prelaunch gate.
 *
 * It is deliberately strict — it asserts `capture_method=manual` and rejects a
 * second create under the same idempotency key with a different body — so a
 * regression in our request shape fails here rather than passing quietly.
 */

import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The double persists its intents, because Stripe does.
 *
 * Without this the double forgets every PaymentIntent between runs while the
 * DATABASE keeps pointing at them, so any obligation created in an earlier run
 * could never be driven again — `ensurePaymentIntent` would take its
 * "already has an intent" branch, retrieve, and get a 404 from a double that
 * had never heard of it. That failure looked like a Couranr bug three times
 * before it was one line of state.
 */
const STORE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "artifacts",
  "stripe-double-intents.json"
);

function loadStore() {
  try {
    if (existsSync(STORE)) return new Map(Object.entries(JSON.parse(readFileSync(STORE, "utf8"))));
  } catch {
    /* a corrupt store is not worth failing a run over */
  }
  return new Map();
}

function saveStore() {
  try {
    mkdirSync(path.dirname(STORE), { recursive: true });
    writeFileSync(STORE, JSON.stringify(Object.fromEntries(intents)), { mode: 0o600 });
  } catch {
    /* best effort */
  }
}

const intents = loadStore();
const byIdempotencyKey = new Map();
/** Capture replays, keyed the way real Stripe keys them: by idempotency key. */
const captureByIdempotencyKey = new Map();
export const calls = [];

let seq = 0;

/**
 * Fault injection for capture, counted down per call.
 *
 * Set by `failNextCaptures(n)` from the suite. The response is a 500 with
 * `stripe-should-retry: false`, which is the shape that produces an
 * INDEFINITE failure in Couranr: the SDK gives up without retrying, the error
 * carries statusCode 500, and `capturePayment` deliberately leaves the
 * obligation in `capture_pending` because it does not know whether Stripe took
 * the money. That is the exact case the recoverable workflow exists for, and
 * it is unreachable without being able to make a capture fail.
 */
let failCaptures = 0;

export function failNextCaptures(n = 1) {
  failCaptures = n;
}

/**
 * A run-unique prefix for minted PaymentIntent ids.
 *
 * The double's counter restarts at 1 every run; the DATABASE does not. Reusing
 * `pi_double_000001` collided with `couranr_po_intent_uniq` — the constraint
 * that says one PaymentIntent belongs to exactly one obligation — and the
 * second run failed at attach. The constraint was right; the double was wrong.
 * Real Stripe never reissues an intent id, so neither does this.
 */
const RUN = Math.random().toString(36).slice(2, 10);

function parseForm(body) {
  const out = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}

function intentJson(pi) {
  return {
    id: pi.id,
    object: "payment_intent",
    amount: pi.amount,
    amount_capturable: pi.amount_capturable,
    amount_received: pi.amount_received ?? 0,
    currency: pi.currency,
    capture_method: pi.capture_method,
    status: pi.status,
    client_secret: `${pi.id}_secret_${pi.id.slice(-6)}`,
    metadata: pi.metadata,
    last_payment_error: pi.last_payment_error ?? null,
    cancellation_reason: pi.cancellation_reason ?? null,
  };
}

export function startStripeDouble(port = 12111) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const url = new URL(req.url, "http://localhost");
      const json = (code, obj) => {
        res.writeHead(code, { "content-type": "application/json" });
        res.end(JSON.stringify(obj));
      };

      // --- control plane, used only by the mocked Stripe.js in the browser --
      const confirm = url.pathname.match(/^\/__control\/confirm\/(pi_[\w]+)$/);
      if (confirm) {
        const pi = intents.get(confirm[1]);
        if (!pi) return json(404, { error: "no such intent" });
        // What a real manual-capture confirmation produces: funds HELD.
        pi.status = "requires_capture";
        pi.amount_capturable = pi.amount;
        saveStore();
        return json(200, intentJson(pi));
      }

      /*
       * Control plane: put an intent into a specific status.
       *
       * Terminal capture resolution is only reachable when the PROVIDER
       * reports requires_payment_method or canceled, and nothing in the app
       * can produce those on demand. Without this the entire terminal branch
       * is undrivable — which is exactly how it shipped unreachable.
       *
       * Control-plane only: never a /v1/ path, so it can never be mistaken for
       * something the Stripe SDK called.
       */
      const setStatus = url.pathname.match(/^\/__control\/status\/(pi_[\w]+)$/);
      if (setStatus) {
        const pi = intents.get(setStatus[1]);
        if (!pi) return json(404, { error: "no such intent" });
        const next = url.searchParams.get("status") || "requires_payment_method";
        pi.status = next;
        if (next === "requires_capture") {
          pi.amount_capturable = pi.amount;
        } else if (next !== "succeeded") {
          // A lost or dead authorization holds nothing.
          pi.amount_capturable = 0;
          pi.amount_received = 0;
        }
        if (next === "requires_payment_method") pi.last_payment_error = { code: "card_declined" };
        if (next === "canceled") pi.cancellation_reason = "abandoned";
        saveStore();
        return json(200, intentJson(pi));
      }

      if (url.pathname === "/v1/payment_intents" && req.method === "POST") {
        const form = parseForm(body);
        const key = req.headers["idempotency-key"];
        calls.push({ path: url.pathname, method: "POST", form, idempotencyKey: key });

        // Manual capture is the whole slice. Refuse anything else loudly.
        if (form.capture_method !== "manual") {
          return json(400, {
            error: { type: "invalid_request_error", message: "capture_method must be manual" },
          });
        }

        // Real Stripe idempotency: same key returns the same object.
        if (key && byIdempotencyKey.has(key)) {
          return json(200, intentJson(intents.get(byIdempotencyKey.get(key))));
        }

        seq += 1;
        const id = `pi_double_${RUN}_${String(seq).padStart(4, "0")}`;
        const metadata = {};
        for (const [k, v] of Object.entries(form)) {
          const m = k.match(/^metadata\[(.+)\]$/);
          if (m) metadata[m[1]] = v;
        }
        const pi = {
          id,
          amount: Number(form.amount),
          amount_capturable: 0,
          currency: form.currency,
          capture_method: form.capture_method,
          status: "requires_payment_method",
          metadata,
        };
        intents.set(id, pi);
        if (key) byIdempotencyKey.set(key, id);
        saveStore();
        return json(200, intentJson(pi));
      }

      /*
       * Capture. Under manual capture this is the call that MOVES THE MONEY,
       * so the double is as strict as the create path: it refuses to capture
       * an intent that was never authorized, and it replays a repeated
       * idempotency key instead of capturing twice — which is precisely the
       * property Couranr's retry path depends on.
       */
      const capture = url.pathname.match(/^\/v1\/payment_intents\/(pi_[\w]+)\/capture$/);
      if (capture && req.method === "POST") {
        const key = req.headers["idempotency-key"];
        const form = parseForm(body);
        calls.push({ path: url.pathname, method: "POST", form, idempotencyKey: key });

        /*
         * REPLAY FIRST, and replay failures too.
         *
         * "Stripe's idempotency works by saving the resulting status code and
         * body of the first request made for any given idempotency key,
         * regardless of whether it succeeded or failed. Subsequent requests
         * with the same key return the same result, including 500 errors."
         * (https://docs.stripe.com/api/idempotent_requests)
         *
         * The double used to memoise only successes, which quietly made the
         * key look reusable after a failure. That is what let an
         * obligation-scoped capture key pass Group N while, against real
         * Stripe, every retry would have replayed the first attempt's failure
         * for 24 hours and the reconcile-and-retry path could never have
         * recovered anything. Modelling the replay is what makes the
         * cycle-scoped key load-bearing in the suite rather than decorative.
         */
        if (key && captureByIdempotencyKey.has(key)) {
          const memo = captureByIdempotencyKey.get(key);
          if (memo.status >= 400) {
            res.writeHead(memo.status, {
              "content-type": "application/json",
              "stripe-should-retry": "false",
            });
            return res.end(JSON.stringify(memo.body));
          }
          return json(200, intentJson(intents.get(memo.intentId)));
        }

        if (failCaptures > 0) {
          failCaptures -= 1;
          // `stripe-should-retry: false` stops the SDK's own retry, so the
          // outage is exactly one attempt and the assertion counts are honest.
          const body = {
            error: { type: "api_error", message: "simulated provider outage" },
          };
          if (key) captureByIdempotencyKey.set(key, { status: 500, body });
          res.writeHead(500, {
            "content-type": "application/json",
            "stripe-should-retry": "false",
          });
          return res.end(JSON.stringify(body));
        }

        const pi = intents.get(capture[1]);
        if (!pi) return json(404, { error: { type: "invalid_request_error" } });
        /*
         * An already-captured intent under a NEW idempotency key is a 400
         * `payment_intent_unexpected_state`, exactly as Stripe answers it.
         *
         * The double used to answer 200 here, which hid the case that made the
         * old "any 4xx means nothing was taken" branch dangerous: that branch
         * would have released a hold and told the operator nothing was taken
         * over money that had already moved. Modelling the real refusal is
         * what makes the suite able to see that class of bug at all.
         */
        const refuse = (message) => {
          const body = {
            error: {
              type: "invalid_request_error",
              code: "payment_intent_unexpected_state",
              message,
            },
          };
          if (key) captureByIdempotencyKey.set(key, { status: 400, body });
          return json(400, body);
        };
        if (pi.status === "succeeded") {
          return refuse("This PaymentIntent has already been captured.");
        }
        if (pi.status !== "requires_capture") {
          return refuse(`intent status ${pi.status} is not capturable`);
        }

        pi.status = "succeeded";
        pi.amount_received = pi.amount;
        pi.amount_capturable = 0;
        if (key) captureByIdempotencyKey.set(key, { status: 200, intentId: pi.id });
        saveStore();
        return json(200, intentJson(pi));
      }

      /*
       * POST /v1/payment_intents/{id}/cancel — ACP-032's release path.
       *
       * Modelled on the documented transitions rather than on what is
       * convenient: an intent may be cancelled from requires_payment_method,
       * requires_capture, requires_confirmation, requires_action or
       * processing, and cancelling one that has already SUCCEEDED is an error.
       * (https://docs.stripe.com/api/payment_intents/cancel)
       *
       * That last refusal is the one worth modelling. `succeeded` means the
       * money is taken, so the correct answer is a refund, not a release — and
       * a double that cheerfully cancelled it would let a bug through that
       * real Stripe would reject.
       */
      const cancel = url.pathname.match(/^\/v1\/payment_intents\/(pi_[\w]+)\/cancel$/);
      if (cancel && req.method === "POST") {
        calls.push({ path: url.pathname, method: "POST", form: parseForm(body) });
        const pi = intents.get(cancel[1]);
        if (!pi) return json(404, { error: { type: "invalid_request_error" } });

        if (pi.status === "succeeded") {
          return json(400, {
            error: {
              type: "invalid_request_error",
              code: "payment_intent_unexpected_state",
              message: `You cannot cancel this PaymentIntent because it has a status of succeeded.`,
            },
          });
        }
        if (pi.status === "canceled") {
          return json(400, {
            error: {
              type: "invalid_request_error",
              code: "payment_intent_unexpected_state",
              message: `You cannot cancel this PaymentIntent because it has a status of canceled.`,
            },
          });
        }

        /*
         * ZERO amount_capturable, and PERSIST.
         *
         * Both were wrong in the first version of this branch, and an
         * adversarial-review agent measured it: cancel returned
         * {"status":"canceled","amount_capturable":2299}. Real Stripe releases
         * the hold, so nothing remains capturable — this double was more
         * permissive than reality on the ONE field that says whether money is
         * still held. Nothing reads it on the release path today, which is why
         * the finding was correctly refuted as a live defect; it is fixed
         * anyway, because the next slice that DOES read it would pass here and
         * fail against Stripe, and that is the whole failure mode a double
         * exists to avoid.
         *
         * cancellation_reason is no longer invented. Real Stripe leaves it null
         * for a manual cancel with no reason supplied; defaulting it to
         * "requested_by_customer" asserted a fact about WHY the money moved
         * that nobody stated.
         *
         * saveStore() matches every other mutating branch (:135, :165, :204,
         * :299); omitting it left the store disagreeing with memory.
         */
        pi.status = "canceled";
        pi.amount_capturable = 0;
        const cancelForm = parseForm(body) || {};
        pi.cancellation_reason = cancelForm.cancellation_reason || null;
        intents.set(pi.id, pi);
        saveStore();
        return json(200, intentJson(pi));
      }

      const retrieve = url.pathname.match(/^\/v1\/payment_intents\/(pi_[\w]+)$/);
      if (retrieve && req.method === "GET") {
        calls.push({ path: url.pathname, method: "GET" });
        const pi = intents.get(retrieve[1]);
        if (!pi) return json(404, { error: { type: "invalid_request_error" } });
        return json(200, intentJson(pi));
      }

      // Anything else is a call Couranr should not be making — a refund, a
      // customer, a saved payment method. Recorded and refused, so a call that
      // appears here fails the run rather than passing quietly.
      calls.push({ path: url.pathname, method: req.method, unexpected: true });
      json(404, { error: { type: "invalid_request_error", message: "not implemented" } });
    });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ server, calls, intents }));
  });
}

/** Every path the SDK actually hit. Used to assert no capture was attempted. */
export function capturedPaths() {
  return calls.map((c) => `${c.method} ${c.path}`);
}
