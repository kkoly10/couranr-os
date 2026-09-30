// @vitest-environment node
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { STRIPE_API_VERSION } from "@/lib/stripeClient";

describe("RR-003a pinned Stripe SDK wire contract", () => {
  it("encodes card-only off-session setup, metadata and idempotency against a local HTTP double", async () => {
    const requests: { method: string; path: string; key: string | undefined; body: string }[] = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk.toString();
      requests.push({ method: request.method ?? "", path: request.url ?? "",
        key: request.headers["idempotency-key"] as string | undefined, body });
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ id: "seti_LocalDouble", object: "setup_intent", livemode: false,
        customer: "cus_LocalDouble", usage: "off_session", status: "requires_payment_method",
        client_secret: "seti_LocalDouble_secret_local", metadata: { couranrSetupAttemptId: "attempt-local" } }));
    });
    try {
      await new Promise<void>((resolve, reject) => server.listen(0, "127.0.0.1", (error?: Error) =>
        error ? reject(error) : resolve()));
      const port = (server.address() as AddressInfo).port;
      const stripe = new Stripe("sk_test_local_double", {
        apiVersion: STRIPE_API_VERSION, host: "127.0.0.1", port, protocol: "http",
      });
      await stripe.setupIntents.create({
        customer: "cus_LocalDouble", usage: "off_session", payment_method_types: ["card"],
        metadata: { couranrSetupAttemptId: "attempt-local" },
      }, { idempotencyKey: "couranr:business-setup:attempt-local" });
      await stripe.setupIntents.cancel("seti_LocalDouble");
      expect(requests).toHaveLength(2);
      expect(requests[0]).toMatchObject({ method: "POST", path: "/v1/setup_intents",
        key: "couranr:business-setup:attempt-local" });
      const encoded = new URLSearchParams(requests[0].body);
      expect(encoded.get("customer")).toBe("cus_LocalDouble");
      expect(encoded.get("usage")).toBe("off_session");
      expect(encoded.get("payment_method_types[0]")).toBe("card");
      expect(encoded.get("metadata[couranrSetupAttemptId]")).toBe("attempt-local");
      expect(requests[1]).toMatchObject({ method: "POST", path: "/v1/setup_intents/seti_LocalDouble/cancel" });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
