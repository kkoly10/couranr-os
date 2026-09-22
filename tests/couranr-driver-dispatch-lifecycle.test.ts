import { beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => ({
  send: vi.fn(),
  issueSender: vi.fn(),
  identity: vi.fn(),
  merchant: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: doubles.from },
}));
vi.mock("@/lib/couranr/consumer/senderAccess", () => ({
  issueSenderAccessToken: doubles.issueSender,
}));
vi.mock("@/lib/couranr/driver/publicProfile", () => ({
  identityForAssignment: doubles.identity,
}));
vi.mock("@/lib/couranr/email/recipients", () => ({
  resolveMerchantNotificationAddress: doubles.merchant,
}));
vi.mock("@/lib/couranr/email/send", () => ({
  emailSendingIsArmed: () => true,
  looksLikeAnAddress: (value: string) => value.includes("@"),
  sendRenderedEmail: doubles.send,
}));

import { notifyDriverDispatchLifecycle } from "@/lib/couranr/email/driverDispatchLifecycle";

function builder(table: string) {
  const rows: Record<string, unknown> = {
    couranr_delivery_requests: {
      id: "req-1", requester_kind: "consumer", business_account_id: null,
      source: "consumer_send", reference: "CR-42", recipient_email: "recipient@example.test",
      consumer_contact_snapshot: { email: "sender@example.test" },
    },
    couranr_deliveries: { id: "delivery-1", fulfillment_state: "assigned" },
    couranr_delivery_access_tokens: { recipient_notified_at: "2026-09-22T10:00:00Z" },
    couranr_delivery_assignments: {
      assignment_state: "active", driver_display_name_snapshot: "Avery Driver",
      driver_portrait_id: "portrait-1",
    },
  };
  const q: any = {
    select: vi.fn(() => q),
    eq: vi.fn(() => q),
    in: vi.fn(() => q),
    gte: vi.fn(() => q),
    not: vi.fn(() => q),
    order: vi.fn(() => q),
    limit: vi.fn(() => q),
    maybeSingle: vi.fn(async () => ({ data: rows[table] ?? null, error: null })),
    then(resolve: (value: unknown) => void) {
      if (table === "couranr_assignment_events") {
        resolve({ data: [{
          id: "event-1", assignment_id: "assignment-1", command: "replace_delivery_assignment",
        }], error: null });
      } else {
        resolve({ data: [], error: null });
      }
    },
  };
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  doubles.from.mockImplementation((table: string) => builder(table));
  doubles.issueSender.mockResolvedValue("sender-capability");
  doubles.identity.mockResolvedValue({
    name: "Avery Driver",
    portraitUrl: "/api/couranr/driver-portrait/10000000-0000-4000-8000-000000000001",
  });
  doubles.merchant.mockResolvedValue(null);
  doubles.send.mockResolvedValue({ id: "email-1" });
});

describe("driver dispatch lifecycle email", () => {
  it("executes sender and recipient audience resolution without leaking either capability", async () => {
    await expect(notifyDriverDispatchLifecycle({ requestId: "req-1" }))
      .resolves.toEqual({ sent: 2, skipped: 0, failed: 0 });

    expect(doubles.issueSender).toHaveBeenCalledWith("req-1", "event-1");
    expect(doubles.send).toHaveBeenCalledTimes(2);
    const calls = doubles.send.mock.calls;
    const sender = calls.find(([, options]) => options.to === "sender@example.test");
    const recipient = calls.find(([, options]) => options.to === "recipient@example.test");
    expect(sender?.[0].html).toContain("Your Couranr driver has changed");
    expect(sender?.[0].html).toContain("#sender=sender-capability");
    expect(sender?.[0].html).toContain("Avery Driver");
    expect(sender?.[0].html).toContain("driver-portrait");
    expect(recipient?.[0].html).toContain("Avery Driver");
    expect(recipient?.[0].html).not.toContain("sender-capability");
    expect(recipient?.[0].html).not.toContain("/track/");
    expect(calls.map(([email]) => email.html).join("\n")).not.toMatch(/tel:|\+1\d{10}/);
    expect(sender?.[1].idempotencyKey).toContain("sender_driver_dispatched/event-1");
    expect(recipient?.[1].idempotencyKey).toContain("recipient_driver_dispatched/event-1");
  });
});
