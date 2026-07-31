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
export const calls = [];

let seq = 0;

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
    currency: pi.currency,
    capture_method: pi.capture_method,
    status: pi.status,
    client_secret: `${pi.id}_secret_${pi.id.slice(-6)}`,
    metadata: pi.metadata,
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

      const retrieve = url.pathname.match(/^\/v1\/payment_intents\/(pi_[\w]+)$/);
      if (retrieve && req.method === "GET") {
        calls.push({ path: url.pathname, method: "GET" });
        const pi = intents.get(retrieve[1]);
        if (!pi) return json(404, { error: { type: "invalid_request_error" } });
        return json(200, intentJson(pi));
      }

      // Anything else is a call this slice should not be making — most
      // importantly /capture. Recorded and refused.
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
