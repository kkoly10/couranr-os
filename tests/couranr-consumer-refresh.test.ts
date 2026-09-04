import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `refreshConsumerSendQuote` — the server half of the resume recovery (final
 * closure pass §5). The jsdom regression proves the BROWSER never re-estimates
 * from emptied form state; these tests prove what the server does with the
 * body-less request: it re-prices the session's OWN bound request from the
 * facts the row already carries, refuses rather than invents when those facts
 * are missing, and never touches a second request or a shipment column.
 *
 * Only the database client and the Google-backed router are mocked; the
 * policy scanner, the policy engine and the argument mappers are the real
 * code, so a stored description still escalates exactly as a fresh estimate
 * would.
 */

const h = vi.hoisted(() => ({
  rpc: vi.fn<any>(),
  derive: vi.fn<any>(),
  db: {
    request: null as any,
    quoteVersion: null as any,
    requestQueries: [] as Array<{ column: string; value: unknown }[]>,
  },
}));

vi.mock("@/lib/supabaseAdmin", () => {
  const chain = (table: string) => {
    const filters: { column: string; value: unknown }[] = [];
    const c: any = {};
    c.select = () => c;
    c.eq = (column: string, value: unknown) => {
      filters.push({ column, value });
      return c;
    };
    for (const m of ["is", "in", "order", "limit"]) c[m] = () => c;
    c.maybeSingle = async () => {
      if (table === "couranr_delivery_requests") {
        h.db.requestQueries.push(filters);
        return { data: h.db.request, error: null };
      }
      if (table === "couranr_quote_versions") return { data: h.db.quoteVersion, error: null };
      return { data: null, error: null };
    };
    return c;
  };
  return { supabaseAdmin: { from: (t: string) => chain(t), rpc: h.rpc } };
});

vi.mock("@/lib/couranr/routing/canonicalRoute", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return { ...real, deriveCanonicalRouteAndQuote: h.derive };
});

import { refreshConsumerSendQuote, RPC, isConsumerFailure } from "@/lib/couranr/consumer/send";
import { CanonicalAddressResolutionError } from "@/lib/couranr/routing/canonicalRoute";

const SESSION = {
  id: "5e550000-0000-4000-8000-0000000000aa",
  requestId: "0e000000-0000-4000-8000-0000000000bb",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

const PICKUP = { googlePlaceId: "ChIJ_pickup", formattedAddress: "1 Main St, Stafford, VA" };
const DROPOFF = { googlePlaceId: "ChIJ_dropoff", formattedAddress: "9 Oak Ave, Stafford, VA" };

/** A stored request awaiting the payer, with an aged-out Quote N. */
function storedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION.requestId,
    version: 4,
    request_state: "awaiting_quote_acceptance",
    quote_status: "estimated",
    current_quote_version_id: "qv-1",
    delivery_subtotal_cents: 1299,
    quote_line_items: [{ code: "base_fare", amountCents: 1299 }],
    review_reasons: [],
    consumer_contact_snapshot: { phone: "+15715550100", email: null, name: "A" },
    pickup_address: PICKUP,
    dropoff_address: DROPOFF,
    weight_lb: 12,
    weight_band: null,
    restricted_class: "none",
    signature_required: false,
    additional_stops: 0,
    normalized_request_payload: { consumerDescription: "two hardcover books", overnightRequested: false },
    ...overrides,
  };
}

/** What the router says for the SAME two places, priced now (Quote N+1). */
function routed(totalCents = 1399) {
  return {
    pickupAddress: { ...PICKUP, resolvedAt: "now" },
    dropoffAddress: { ...DROPOFF, resolvedAt: "now" },
    route: {
      serviceabilityOutcome: "automatic",
      distanceSource: "mapbox_directions_v5",
      distanceMeters: 8046,
      loadedMiles: 5,
      durationSeconds: 900,
      staticDurationSeconds: 840,
      trafficDelaySeconds: 60,
      reviewReason: null,
    },
    timing: {
      intent: "asap",
      requestedDepartureAt: null,
      requestedPickupLocal: null,
      reviewReasons: [],
    },
    quote: {
      policyVersion: "couranr-pricing-v2-2026-09-01",
      quoteStatus: "estimated",
      deliverySubtotalCents: totalCents,
      lineItems: [{ code: "base_fare", amountCents: totalCents }],
      includedLoadedMiles: 2,
      billableLoadedMiles: 3,
      trafficDelaySeconds: 60,
      reviewReasons: [],
    },
  };
}

function estimateCalls() {
  return h.rpc.mock.calls.filter((c: any[]) => c[0] === RPC.estimate);
}

beforeEach(() => {
  h.rpc.mockReset();
  h.derive.mockReset();
  h.db.request = storedRow();
  h.db.quoteVersion = { created_at: "2026-09-03T15:00:00.000Z" };
  h.db.requestQueries = [];
  h.derive.mockResolvedValue(routed());
  h.rpc.mockImplementation(async (fn: string, args: any) => {
    if (fn === RPC.estimate) {
      return {
        data: {
          id: args.p_request_id,
          version: Number(args.p_expected_version) + 1,
          request_state: "awaiting_quote_acceptance",
          quote_status: args.p_quote_status,
          current_quote_version_id: "qv-2",
          delivery_subtotal_cents: args.p_delivery_subtotal_cents,
          quote_line_items: args.p_quote_line_items,
          review_reasons: args.p_review_reasons,
        },
        error: null,
      };
    }
    return { data: null, error: { code: "XX000", message: `unexpected rpc ${fn}` } };
  });
});

describe("refreshConsumerSendQuote — re-price the SAME request from STORED facts", () => {
  it("re-prices Quote N+1 through the one estimate command with p_update_shipment=false", async () => {
    const r = await refreshConsumerSendQuote({ session: SESSION });

    expect(isConsumerFailure(r)).toBe(false);
    if (isConsumerFailure(r)) return;
    expect(r.value.requestId).toBe(SESSION.requestId);
    expect(r.value.totalCents).toBe(1399);
    expect(r.value.quoteStatus).toBe("estimated");
    expect(r.value.quoteVersionId).toBe("qv-2");
    // QVL-001 display hint: created_at + 15:00.
    expect(r.value.expiresAt).toBe("2026-09-03T15:15:00.000Z");

    // The row was read under the FULL ownership scope — id, requester kind
    // and the session-derived idempotency scope — never by id alone.
    expect(h.db.requestQueries).toHaveLength(1);
    expect(h.db.requestQueries[0]).toEqual([
      { column: "id", value: SESSION.requestId },
      { column: "requester_kind", value: "consumer" },
      { column: "idempotency_scope", value: `consumer:${SESSION.id}` },
    ]);

    // The router was handed the STORED snapshots, not anything re-typed.
    expect(h.derive).toHaveBeenCalledTimes(1);
    const shipment = h.derive.mock.calls[0][0];
    expect(shipment.pickupAddress).toBe(h.db.request.pickup_address);
    expect(shipment.dropoffAddress).toBe(h.db.request.dropoff_address);
    expect(shipment.weightLb).toBe(12);
    expect(shipment.timingIntent).toBe("asap");

    // Exactly ONE database command, on the SAME request and session, with the
    // shipment left as the stored truth. No session mint, no second request.
    expect(h.rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = h.rpc.mock.calls[0];
    expect(fn).toBe(RPC.estimate);
    expect(args.p_request_id).toBe(SESSION.requestId);
    expect(args.p_guest_session_id).toBe(SESSION.id);
    expect(args.p_expected_version).toBe(4);
    expect(args.p_update_shipment).toBe(false);
    expect(args.p_quote_status).toBe("estimated");
    expect(args.p_delivery_subtotal_cents).toBe(1399);
    expect(args.p_weight_lb).toBe(12);
    expect(args.p_restricted_class).toBe("none");
    expect(args.p_shipment_description).toBe("two hardcover books");
    expect(args.p_timing_intent).toBe("asap");
    expect(h.rpc.mock.calls.some((c: any[]) => c[0] === RPC.createSession)).toBe(false);
  });

  it("a draft is also refreshable — the same seam the first estimate uses", async () => {
    h.db.request = storedRow({ request_state: "draft", quote_status: "not_quoted", current_quote_version_id: null });
    const r = await refreshConsumerSendQuote({ session: SESSION });
    expect(isConsumerFailure(r)).toBe(false);
    expect(estimateCalls()).toHaveLength(1);
  });

  it("refuses once the request is past the payer's seam — no router call, no command", async () => {
    for (const state of ["pending_couranr_review", "confirmed", "quote_revision_required", "cancelled"]) {
      h.rpc.mockClear();
      h.derive.mockClear();
      h.db.request = storedRow({ request_state: state });
      const r = await refreshConsumerSendQuote({ session: SESSION });
      expect(isConsumerFailure(r), state).toBe(true);
      if (isConsumerFailure(r)) expect(r.code, state).toBe("wrong_state");
      expect(h.derive, state).not.toHaveBeenCalled();
      expect(h.rpc, state).not.toHaveBeenCalled();
    }
  });

  it("refuses — never invents — when a stored address has no place identity", async () => {
    h.db.request = storedRow({ pickup_address: { formattedAddress: "typed by hand, no place id" } });
    const r = await refreshConsumerSendQuote({ session: SESSION });
    expect(isConsumerFailure(r)).toBe(true);
    if (isConsumerFailure(r)) {
      expect(r.code).toBe("conflict");
      expect(r.message).toMatch(/cannot be re-priced automatically/);
    }
    expect(h.derive).not.toHaveBeenCalled();
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("a router that cannot re-verify the stored places is a conflict with zero writes", async () => {
    h.derive.mockRejectedValue(
      new CanonicalAddressResolutionError("dropoffAddress", "google_places_invalid_response")
    );
    const r = await refreshConsumerSendQuote({ session: SESSION });
    expect(isConsumerFailure(r)).toBe(true);
    if (isConsumerFailure(r)) expect(r.code).toBe("conflict");
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("a session bound to no request is not_found before any read or write", async () => {
    const r = await refreshConsumerSendQuote({ session: { ...SESSION, requestId: null } });
    expect(isConsumerFailure(r)).toBe(true);
    if (isConsumerFailure(r)) expect(r.code).toBe("not_found");
    expect(h.db.requestQueries).toHaveLength(0);
    expect(h.rpc).not.toHaveBeenCalled();
  });

  it("the STORED description runs the same restricted-signal parity as a fresh estimate", async () => {
    // Declared `none`, but the words the guest stored say otherwise. The
    // deterministic scanner escalates; the refreshed quote is review, not a
    // payable number — exactly what a fresh estimate would say.
    h.db.request = storedRow({
      normalized_request_payload: { consumerDescription: "12 bottles of beer", overnightRequested: false },
    });
    const r = await refreshConsumerSendQuote({ session: SESSION });
    expect(isConsumerFailure(r)).toBe(false);
    if (isConsumerFailure(r)) return;
    expect(r.value.quoteStatus).toBe("manual_review_required");
    expect(r.value.totalCents).toBeNull();

    const [, args] = h.rpc.mock.calls[0];
    expect(args.p_quote_status).toBe("manual_review_required");
    expect(args.p_delivery_subtotal_cents).toBeNull();
    expect(args.p_review_reasons).toContain("shipment_policy_review");
    expect(args.p_update_shipment).toBe(false);
  });

  it("a database refusal from the command is surfaced, not swallowed", async () => {
    h.rpc.mockResolvedValue({
      data: null,
      error: { code: "CR409", message: "version_or_state_conflict" },
    });
    const r = await refreshConsumerSendQuote({ session: SESSION });
    expect(isConsumerFailure(r)).toBe(true);
    // CR409 is the command's version/state refusal; the public code for it
    // is version_conflict, the same word every other consumer command uses.
    if (isConsumerFailure(r)) expect(r.code).toBe("version_conflict");
  });
});
