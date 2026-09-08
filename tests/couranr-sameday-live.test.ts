/**
 * Live Same Day wiring (batch 3 §D) — the `/send` frontend against the
 * consumer API, through the adapter seam.
 *
 * What this suite holds:
 *
 *  1. LIVE BY DEFAULT. `live` is the mode for every real environment,
 *     production included, with no env flag; `fixture` is test-only plus an
 *     explicit non-production opt-in. There is no disabled product path.
 *  2. NESTED-KEY READS. Every consumer payload is read from its named key
 *     (`guestSession`, `suggestions`, `estimate`, `request`, `payment`); a
 *     flat body is a failure, never a silent success — the exact bug class
 *     that shipped a dead proof-upload flow.
 *  3. HONEST MAPPINGS. quoteStatus `estimated` -> `live-available` with the
 *     server's numbers; `manual_review_required` -> the existing
 *     review-needed presentation; refusals carry the server's sanitized
 *     message. The UI's `mobile` field maps to the API/DB key `phone`.
 *  4. DEGRADATION. sessionStorage that THROWS degrades to memory-only; the
 *     session is still minted exactly once.
 *  5. THE GUARD: the fixture behavior is unchanged, production is live, and
 *     the fixture adapter object gained nothing live.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveAdapterMode } from "@/lib/couranr/sameday/adapterMode";
import { getSameDayAdapters } from "@/lib/couranr/sameday/adapters";
import {
  GUEST_HEADER,
  GUEST_STORAGE_KEY,
  buildEstimateBody,
  consumerContactFromSend,
  isEstimateBodyFailure,
  createLiveSameDayAdapters,
  isRouteReviewReason,
  quoteReadingFromEstimate,
  reviewNoteFor,
  timingFromEstimate,
  type MinimalStorage,
} from "@/lib/couranr/sameday/liveAdapters";
import {
  GUEST_HEADER as SERVER_GUEST_HEADER,
  findForbiddenConsumerKey,
} from "@/lib/couranr/consumer/send";
import { BASE_PRICE_CENTS } from "@/lib/couranr/pricing";

const ROOT = path.join(__dirname, "..");

/* ------------------------------------------------------------- harness --- */

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = () => new Date(Date.now() - 60 * 1000).toISOString();

type Routed = { status?: number; body: unknown };
type RouteHandler = (init: RequestInit | undefined, url: string) => Routed;

/** A recording fetch double. Longest-prefix route match, JSON responses. */
function fakeFetch(routes: Record<string, RouteHandler>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const key = Object.keys(routes)
      .filter((k) => url.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    const r = key
      ? routes[key](init, url)
      : url.startsWith("/api/couranr/consumer/pickup-manifest")
        ? {
            body: {
              pickupManifest: {
                manifestVersion: 1,
                manifest: {
                  description: "a birthday cake",
                  packageCount: null,
                  orderReference: null,
                  handlingNotes: null,
                  source: "consumer_statement",
                },
              },
            },
          }
        : { status: 404, body: { error: "no route" } };
    return new Response(JSON.stringify(r.body), {
      status: r.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  const of = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix));
  return { impl, calls, of };
}

function memoryStorage(): MinimalStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

function throwingStorage(): MinimalStorage {
  return {
    getItem() {
      throw new Error("site data blocked");
    },
    setItem() {
      throw new Error("site data blocked");
    },
  };
}

const SESSION_OK: RouteHandler = () => ({
  status: 201,
  body: { guestSession: { token: "guest-token-1", expiresAt: FUTURE() } },
});

const S = "/api/couranr/consumer/session";
const PLACES = "/api/couranr/consumer/places";
const ESTIMATE = "/api/couranr/consumer/estimate";
const SUBMIT = "/api/couranr/consumer/submit";
const REQUEST = "/api/couranr/consumer/request";
const PAY = "/api/couranr/consumer/pay";
const PICKUP_MANIFEST = "/api/couranr/consumer/pickup-manifest";
const RECONCILE = "/api/couranr/consumer/reconcile-payment";
const INTERPRET = "/api/couranr/consumer/interpret";

const GOOD_QUOTE_INPUT = {
  pickup: "A",
  destination: "B",
  timingIntent: "asap" as const,
  pickupPlaceId: "place-a",
  dropoffPlaceId: "place-b",
  contact: { name: "Ada", mobile: "+15715550100", email: "" },
  shipment: { description: "a birthday cake", weightLb: 8, weightBand: null, restrictedClass: "none" },
};

const ESTIMATED = {
  requestId: "req-1",
  quoteStatus: "estimated",
  pickupManifestVersion: 0,
  totalCents: 1049,
  lineItems: [],
  reviewReasons: [],
  quoteVersionId: "qv-1",
  expiresAt: "2026-09-03T12:15:00.000Z",
};

function live(deps?: Parameters<typeof createLiveSameDayAdapters>[0]) {
  return createLiveSameDayAdapters(deps);
}

/* ------------------------------------ 1. live-by-default arming ---------- */

describe("adapter mode: live is the default, fixtures test-only", () => {
  it("production resolves live with NO env flag; getSameDayAdapters returns the live set", () => {
    for (const env of [
      { nodeEnv: "production" },
      { vercelEnv: "production" },
      { nodeEnv: "development", vercelEnv: "production" },
    ]) {
      const r = resolveAdapterMode(env);
      expect(r.mode, JSON.stringify(env)).toBe("live");
      expect(r.misconfigured).toBe(false);
    }
    const a = getSameDayAdapters({ nodeEnv: "production" });
    expect(a.mode).toBe("live");
    expect(typeof a.reconcilePayment).toBe("function");
    expect(typeof a.readRequest).toBe("function");
  });

  it("test mode is fixtures; a non-production opt-in is fixtures; dev with no opt-in is live", () => {
    expect(resolveAdapterMode({ nodeEnv: "test" }).mode).toBe("fixture");
    expect(resolveAdapterMode({ nodeEnv: "development", fixtureFlag: "1" }).mode).toBe("fixture");
    expect(resolveAdapterMode({ vercelEnv: "preview", fixtureFlag: "1" }).mode).toBe("fixture");
    expect(resolveAdapterMode({ nodeEnv: "development" }).mode).toBe("live");
  });

  it("production refuses a fixture override — live, with a recorded misconfiguration", () => {
    const r = resolveAdapterMode({ nodeEnv: "production", fixtureFlag: "1" });
    expect(r.mode).toBe("live");
    expect(r.reason).toBe("production_fixtures_refused");
    expect(r.misconfigured).toBe(true);
  });
});

/* ------------------------------------------ 2. guest session lifecycle --- */

describe("guest session: mint once, nested read, storage degradation", () => {
  it("mints once and reuses memory across calls, with the guest header", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [PLACES]: () => ({ body: { suggestions: [] } }),
    });
    const a = live({ fetchImpl: f.impl, storage: memoryStorage() });
    await a.searchAddress("main street");
    await a.searchAddress("main street again");
    expect(f.of(S).length).toBe(1);
    const placeCalls = f.of(PLACES);
    expect(placeCalls.length).toBe(2);
    for (const c of placeCalls) {
      expect((c.init?.headers as Record<string, string>)[GUEST_HEADER]).toBe("guest-token-1");
    }
  });

  it("persists the session under 'couranr-send-guest' and reuses a stored one", async () => {
    const storage = memoryStorage();
    const f1 = fakeFetch({ [S]: SESSION_OK, [PLACES]: () => ({ body: { suggestions: [] } }) });
    const a1 = live({ fetchImpl: f1.impl, storage });
    await a1.searchAddress("main");
    expect(storage.map.has(GUEST_STORAGE_KEY)).toBe(true);
    expect(JSON.parse(storage.map.get(GUEST_STORAGE_KEY)!).token).toBe("guest-token-1");

    // A SECOND adapter set (a reload) reuses the stored session: no new mint.
    const f2 = fakeFetch({ [S]: SESSION_OK, [PLACES]: () => ({ body: { suggestions: [] } }) });
    const a2 = live({ fetchImpl: f2.impl, storage });
    await a2.searchAddress("main");
    expect(f2.of(S).length).toBe(0);
    expect(
      (f2.of(PLACES)[0].init?.headers as Record<string, string>)[GUEST_HEADER]
    ).toBe("guest-token-1");
  });

  it("an EXPIRED stored session is discarded and a fresh one minted", async () => {
    const storage = memoryStorage();
    storage.map.set(GUEST_STORAGE_KEY, JSON.stringify({ token: "stale", expiresAt: PAST() }));
    const f = fakeFetch({ [S]: SESSION_OK, [PLACES]: () => ({ body: { suggestions: [] } }) });
    await live({ fetchImpl: f.impl, storage }).searchAddress("main");
    expect(f.of(S).length).toBe(1);
    expect(
      (f.of(PLACES)[0].init?.headers as Record<string, string>)[GUEST_HEADER]
    ).toBe("guest-token-1");
  });

  it("a FLAT session body (no guestSession key) is a refusal, not a session", async () => {
    const f = fakeFetch({
      [S]: () => ({ status: 201, body: { token: "flat", expiresAt: FUTURE() } }),
      [PLACES]: () => ({ body: { suggestions: [{ placeId: "p", text: "t" }] } }),
    });
    const a = live({ fetchImpl: f.impl, storage: memoryStorage() });
    expect(await a.searchAddress("main")).toEqual({ status: "error" });
    // No gated call ever left without a session.
    expect(f.of(PLACES).length).toBe(0);
    const q = await a.quote(GOOD_QUOTE_INPUT);
    expect(q.state).toBe("unavailable");
  });

  it("STORAGE THAT THROWS degrades to memory: everything works, one mint", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [PLACES]: () => ({ body: { suggestions: [{ placeId: "p1", text: "112 Main St" }] } }),
      [ESTIMATE]: () => ({ body: { estimate: ESTIMATED } }),
    });
    const a = live({ fetchImpl: f.impl, storage: throwingStorage() });
    const s = await a.searchAddress("main");
    expect(s.status === "ok" && s.suggestions.length).toBe(1);
    expect((await a.quote(GOOD_QUOTE_INPUT)).state).toBe("live-available");
    expect(f.of(S).length).toBe(1);
  });
});

/* ------------------------------------------------- 3. address search ----- */

describe("searchAddress reads the nested `suggestions` key", () => {
  it("maps both suggestion spellings", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [PLACES]: () => ({
        body: {
          suggestions: [
            { placeId: "p1", mainText: "Main Street Bakery", secondaryText: "112 Main Street" },
            { placeId: "p2", text: "140 Main Street, Stafford, VA" },
            { mainText: "no place id — dropped" },
          ],
        },
      }),
    });
    const out = await live({ fetchImpl: f.impl, storage: null }).searchAddress("main");
    expect(out).toEqual({
      status: "ok",
      suggestions: [
        { id: "p1", label: "Main Street Bakery", detail: "112 Main Street" },
        { id: "p2", label: "140 Main Street, Stafford, VA", detail: "" },
      ],
    });
    expect(f.of(PLACES)[0].url).toContain("query=main");
  });

  it("a provider failure is distinct from a genuine empty result", async () => {
    // A flat/malformed body is a service failure -> error, not a silent empty.
    const flat = fakeFetch({
      [S]: SESSION_OK,
      [PLACES]: () => ({ body: [{ placeId: "p1", text: "x" }] }),
    });
    expect(await live({ fetchImpl: flat.impl, storage: null }).searchAddress("main")).toEqual({ status: "error" });
    // A 500 is an error.
    const down = fakeFetch({ [S]: SESSION_OK, [PLACES]: () => ({ status: 500, body: { error: "x" } }) });
    expect(await live({ fetchImpl: down.impl, storage: null }).searchAddress("main")).toEqual({ status: "error" });
    // The route's `degraded` flag (provider outage / budget stop) is an error
    // even though the list is empty and the status is 200.
    const degraded = fakeFetch({ [S]: SESSION_OK, [PLACES]: () => ({ body: { suggestions: [], degraded: true } }) });
    expect(await live({ fetchImpl: degraded.impl, storage: null }).searchAddress("main")).toEqual({ status: "error" });
    // A 429 is its own rate-limited outcome.
    const limited = fakeFetch({ [S]: SESSION_OK, [PLACES]: () => ({ status: 429, body: { error: "slow down" } }) });
    expect(await live({ fetchImpl: limited.impl, storage: null }).searchAddress("main")).toEqual({ status: "rate-limited" });
    // A genuine 200 empty list is ok, not an error.
    const empty = fakeFetch({ [S]: SESSION_OK, [PLACES]: () => ({ body: { suggestions: [] } }) });
    expect(await live({ fetchImpl: empty.impl, storage: null }).searchAddress("main")).toEqual({ status: "ok", suggestions: [] });
  });

  it("does not call the network for a sub-3-character query", async () => {
    const f = fakeFetch({ [S]: SESSION_OK, [PLACES]: () => ({ body: { suggestions: [] } }) });
    expect(await live({ fetchImpl: f.impl, storage: null }).searchAddress(" ab ")).toEqual({ status: "ok", suggestions: [] });
    expect(f.calls.length).toBe(0);
  });
});

/* -------------------------------------------------- 4. estimate body ----- */

describe("buildEstimateBody: honest statement or a local refusal", () => {
  it("maps the UI's 'mobile' to the API/DB key 'phone', and no 'mobile' key survives", () => {
    const r = buildEstimateBody(GOOD_QUOTE_INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const contact = r.body.contact as Record<string, unknown>;
      expect(contact.phone).toBe("+15715550100");
      expect("mobile" in contact).toBe(false);
      expect(JSON.stringify(r.body)).not.toContain("mobile");
    }
    expect(consumerContactFromSend({ mobile: " 555 " })).toEqual({
      name: null,
      phone: "555",
      email: null,
    });
  });

  it("carries no commercial field the server would refuse", () => {
    const r = buildEstimateBody(GOOD_QUOTE_INPUT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(findForbiddenConsumerKey(r.body)).toBeNull();
  });

  it("refuses locally without both selected place identities", () => {
    const r = buildEstimateBody({ ...GOOD_QUOTE_INPUT, dropoffPlaceId: null });
    expect(r.ok).toBe(false);
    if (isEstimateBodyFailure(r)) expect(r.note).toContain("suggestions");
  });

  it("refuses locally without an honest weight statement (SUR-001)", () => {
    const noWeight = buildEstimateBody({
      ...GOOD_QUOTE_INPUT,
      shipment: { ...GOOD_QUOTE_INPUT.shipment, weightLb: null, weightBand: null },
    });
    expect(noWeight.ok).toBe(false);
    const nan = buildEstimateBody({
      ...GOOD_QUOTE_INPUT,
      shipment: { ...GOOD_QUOTE_INPUT.shipment, weightLb: Number("abc"), weightBand: null },
    });
    expect(nan.ok).toBe(false);
    const band = buildEstimateBody({
      ...GOOD_QUOTE_INPUT,
      shipment: { ...GOOD_QUOTE_INPUT.shipment, weightLb: null, weightBand: "0_25_lb" },
    });
    expect(band.ok).toBe(true);
    if (band.ok) {
      expect((band.body.shipment as Record<string, unknown>).weightBand).toBe("0_25_lb");
      expect((band.body.shipment as Record<string, unknown>).weightLb).toBeNull();
    }
  });

  it("refuses an overlong pickup description locally before any provider call", async () => {
    const input = {
      ...GOOD_QUOTE_INPUT,
      shipment: { ...GOOD_QUOTE_INPUT.shipment, description: "x".repeat(1001) },
    };
    expect(buildEstimateBody(input).ok).toBe(false);

    const f = fakeFetch({ [S]: SESSION_OK, [ESTIMATE]: () => ({ body: { estimate: ESTIMATED } }) });
    const q = await live({ fetchImpl: f.impl, storage: null }).quote(input);
    expect(q.state).toBe("unavailable");
    expect(f.calls).toHaveLength(0);
  });

  it("refuses locally without contact — the FIRST estimate freezes the snapshot", () => {
    const r = buildEstimateBody({ ...GOOD_QUOTE_INPUT, contact: { name: "Ada" } });
    expect(r.ok).toBe(false);
  });

  it("an absent declaration is sent as 'unknown', never a default 'none'", () => {
    const r = buildEstimateBody({
      ...GOOD_QUOTE_INPUT,
      shipment: { ...GOOD_QUOTE_INPUT.shipment, restrictedClass: undefined },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.body.shipment as Record<string, unknown>).restrictedClass).toBe("unknown");
  });

  it("timing carries the sender's intent: ASAP, or the scheduled Eastern local words", () => {
    const asap = buildEstimateBody(GOOD_QUOTE_INPUT);
    expect(asap.ok).toBe(true);
    if (asap.ok) expect(asap.body.timing).toEqual({ intent: "asap", requestedPickupLocal: null });

    const scheduled = buildEstimateBody({
      ...GOOD_QUOTE_INPUT,
      timingIntent: "scheduled",
      requestedPickupLocal: "2027-03-10T10:30",
    });
    expect(scheduled.ok).toBe(true);
    if (scheduled.ok) {
      expect(scheduled.body.timing).toEqual({ intent: "scheduled", requestedPickupLocal: "2027-03-10T10:30" });
      // Only the sender's words travel: no zone suffix, no instant, no offset.
      expect(JSON.stringify(scheduled.body)).not.toMatch(/requestedDepartureAt|America\/New_York|Z"/);
    }
  });

  it("a scheduled pickup without valid local words is a LOCAL refusal — no network call", async () => {
    for (const bad of [undefined, "", "tomorrow", "2027-03-10T10:30Z", "2027-02-30T10:00"]) {
      const r = buildEstimateBody({ ...GOOD_QUOTE_INPUT, timingIntent: "scheduled", requestedPickupLocal: bad });
      expect(r.ok, `local=${String(bad)}`).toBe(false);
    }
    const f = fakeFetch({ [S]: SESSION_OK, [ESTIMATE]: () => ({ body: { estimate: ESTIMATED } }) });
    const q = await live({ fetchImpl: f.impl, storage: null }).quote({
      ...GOOD_QUOTE_INPUT,
      timingIntent: "scheduled",
      requestedPickupLocal: "",
    });
    expect(q.state).toBe("unavailable");
    expect(f.calls).toHaveLength(0);
  });
});

/* ------------------------------------------------------ 5. the quote ----- */

describe("quote maps quoteStatus, reads the nested `estimate` key", () => {
  it("'estimated' -> live-available with the server's numbers", async () => {
    const f = fakeFetch({ [S]: SESSION_OK, [ESTIMATE]: () => ({ body: { estimate: ESTIMATED } }) });
    const q = await live({ fetchImpl: f.impl, storage: null }).quote(GOOD_QUOTE_INPUT);
    expect(q).toEqual({
      state: "live-available",
      totalCents: 1049,
      quoteVersionId: "qv-1",
      requestId: "req-1",
      expiresAt: "2026-09-03T12:15:00.000Z",
    });
    // And the request that left carried the mapped body.
    const sent = JSON.parse(String(f.of(ESTIMATE)[0].init?.body));
    expect(sent.contact.phone).toBe("+15715550100");
    expect(sent.timing).toEqual({ intent: "asap", requestedPickupLocal: null });

    const manifestCalls = f.of(PICKUP_MANIFEST);
    expect(manifestCalls).toHaveLength(1);
    expect(JSON.parse(String(manifestCalls[0].init?.body))).toEqual({
      expectedManifestVersion: 0,
      description: "a birthday cake",
      packageCount: null,
      orderReference: null,
      handlingNotes: null,
    });
  });

  it("uses the estimate's current pickup-manifest version after a reload/re-estimate", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [ESTIMATE]: () => ({
        body: { estimate: { ...ESTIMATED, pickupManifestVersion: 7 } },
      }),
    });
    const q = await live({ fetchImpl: f.impl, storage: null }).quote(GOOD_QUOTE_INPUT);
    expect(q.state).toBe("live-available");
    const body = JSON.parse(String(f.of(PICKUP_MANIFEST)[0].init?.body));
    expect(body.expectedManifestVersion).toBe(7);
  });

  it("'manual_review_required' -> the existing manual-review presentation", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [ESTIMATE]: () => ({
        body: {
          estimate: {
            ...ESTIMATED,
            quoteStatus: "manual_review_required",
            totalCents: null,
            reviewReasons: ["weight_unresolved"],
          },
        },
      }),
    });
    const q = await live({ fetchImpl: f.impl, storage: null }).quote(GOOD_QUOTE_INPUT);
    expect(q.state).toBe("manual-review");
  });

  it("'invalid' and a FLAT body both refuse; a refusal carries the server's message", async () => {
    const invalid = fakeFetch({
      [S]: SESSION_OK,
      [ESTIMATE]: () => ({ body: { estimate: { ...ESTIMATED, quoteStatus: "invalid", totalCents: null } } }),
    });
    expect((await live({ fetchImpl: invalid.impl, storage: null }).quote(GOOD_QUOTE_INPUT)).state).toBe(
      "unavailable"
    );

    const flat = fakeFetch({ [S]: SESSION_OK, [ESTIMATE]: () => ({ body: ESTIMATED }) });
    expect((await live({ fetchImpl: flat.impl, storage: null }).quote(GOOD_QUOTE_INPUT)).state).toBe(
      "unavailable"
    );

    const refused = fakeFetch({
      [S]: SESSION_OK,
      [ESTIMATE]: () => ({
        status: 422,
        body: { error: "Some delivery details need attention before this can be priced.", code: "invalid_input" },
      }),
    });
    const q = await live({ fetchImpl: refused.impl, storage: null }).quote(GOOD_QUOTE_INPUT);
    expect(q.state).toBe("unavailable");
    if (q.state === "unavailable") expect(q.note).toContain("need attention");
  });

  it("a local refusal makes NO network call", async () => {
    const f = fakeFetch({ [S]: SESSION_OK, [ESTIMATE]: () => ({ body: { estimate: ESTIMATED } }) });
    const q = await live({ fetchImpl: f.impl, storage: null }).quote({
      ...GOOD_QUOTE_INPUT,
      pickupPlaceId: null,
    });
    expect(q.state).toBe("unavailable");
    expect(f.calls.length).toBe(0);
  });

  it("fails closed on an estimated status missing its numbers", () => {
    expect(quoteReadingFromEstimate({ quoteStatus: "estimated", requestId: "r" }).state).toBe(
      "unavailable"
    );
    expect(
      quoteReadingFromEstimate({ quoteStatus: "estimated", totalCents: 100 }).state
    ).toBe("unavailable");
  });
});

/* --------------------------------------------- 6. availability seam ------ */

describe("checkAvailability: honest passthrough with the estimate's memory", () => {
  it("needs both values", async () => {
    const a = live({ fetchImpl: fakeFetch({ [S]: SESSION_OK }).impl, storage: null });
    expect((await a.checkAvailability("", "b")).state).toBe("unavailable");
  });

  it("is eligible before any estimate, and after a NON-route review", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [ESTIMATE]: () => ({
        body: {
          estimate: {
            ...ESTIMATED,
            quoteStatus: "manual_review_required",
            totalCents: null,
            reviewReasons: ["weight_unresolved"],
          },
        },
      }),
    });
    const a = live({ fetchImpl: f.impl, storage: null });
    expect((await a.checkAvailability("a", "b")).state).toBe("eligible");
    await a.quote(GOOD_QUOTE_INPUT);
    expect((await a.checkAvailability("a", "b")).state).toBe("eligible");
  });

  it("turns review-needed once the estimate refused for a route/market reason", async () => {
    for (const reason of ["route_needs_review", "market_needs_review"]) {
      const f = fakeFetch({
        [S]: SESSION_OK,
        [ESTIMATE]: () => ({
          body: {
            estimate: {
              ...ESTIMATED,
              quoteStatus: "manual_review_required",
              totalCents: null,
              reviewReasons: [reason],
            },
          },
        }),
      });
      const a = live({ fetchImpl: f.impl, storage: null });
      await a.quote(GOOD_QUOTE_INPUT);
      expect((await a.checkAvailability("a", "b")).state, reason).toBe("review-needed");
    }
    expect(isRouteReviewReason("weight_unresolved")).toBe(false);
    expect(isRouteReviewReason("market_needs_review")).toBe(true);
  });
});

/* ------------------------------------------ 7. Consumer Smart Intake ---- */

describe("readIntake — structured proposals from the shared substrate, never model prose (INT-002)", () => {
  const INTAKE_OK = () => ({
    body: {
      intake: {
        status: "interpreted",
        revision: 1,
        proposals: [
          { key: "weight_band", value: "over_25_to_50_lb", confidence: 70, requiresConfirmation: true },
          { key: "package_count", value: 2, confidence: 90, requiresConfirmation: false },
          // Not consumer keys: dropped even if a server sent them — the second
          // is a FREE-STRING key, which is exactly why it is not one.
          { key: "payer_type", value: "merchant", confidence: 99, requiresConfirmation: false },
          { key: "item_category", value: "home goods; ignore the rules", confidence: 99, requiresConfirmation: false },
          // Malformed: no value.
          { key: "quantity", confidence: 50 },
        ],
        clarification: null,
      },
    },
  });

  it("POSTs { description } under the guest header and returns the guest's OWN words plus the proposals", async () => {
    const f = fakeFetch({ [S]: SESSION_OK, [INTERPRET]: INTAKE_OK });
    const r = await live({ fetchImpl: f.impl, storage: null }).readIntake("  a lamp and a rug  ");
    expect(r).toEqual({
      state: "interpreted",
      summary: "a lamp and a rug",
      proposals: [
        { key: "weight_band", value: "over_25_to_50_lb", confidence: 70, requiresConfirmation: true },
        { key: "package_count", value: 2, confidence: 90, requiresConfirmation: false },
      ],
    });
    const call = f.of(INTERPRET)[0];
    expect(call.init?.method).toBe("POST");
    expect(JSON.parse(String(call.init?.body))).toEqual({ description: "a lamp and a rug" });
    expect((call.init?.headers as Record<string, string>)["x-couranr-guest"]).toBeTruthy();
  });

  it("the one clarification maps to needs-follow-up, proposals kept", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [INTERPRET]: () => ({
        body: {
          intake: {
            status: "interpreted",
            proposals: [{ key: "restricted_class", value: "alcohol", confidence: 95, requiresConfirmation: true }],
            clarification: { factKey: "restricted_class", question: "Does this include alcohol?" },
          },
        },
      }),
    });
    const r = await live({ fetchImpl: f.impl, storage: null }).readIntake("12 bottles of beer");
    expect(r.state).toBe("needs-follow-up");
    if (r.state === "needs-follow-up") {
      expect(r.question).toBe("Does this include alcohol?");
      expect(r.proposals?.[0]?.key).toBe("restricted_class");
    }
  });

  it("says nothing about nothing — and makes no network call for whitespace", async () => {
    const f = fakeFetch({ [S]: SESSION_OK, [INTERPRET]: INTAKE_OK });
    expect((await live({ fetchImpl: f.impl, storage: null }).readIntake("   ")).state).toBe("unavailable");
    expect(f.calls.length).toBe(0);
  });

  it("a switched-off feature, a refusal or a dead network degrade to the words alone", async () => {
    const off = fakeFetch({
      [S]: SESSION_OK,
      [INTERPRET]: () => ({ body: { intake: { status: "unavailable", proposals: [], clarification: null } } }),
    });
    expect(await live({ fetchImpl: off.impl, storage: null }).readIntake("a cake")).toEqual({
      state: "interpreted",
      summary: "a cake",
      proposals: [],
    });
    const refused = fakeFetch({ [S]: SESSION_OK, [INTERPRET]: () => ({ status: 500, body: { error: "x" } }) });
    expect(await live({ fetchImpl: refused.impl, storage: null }).readIntake("a cake")).toEqual({
      state: "interpreted",
      summary: "a cake",
      proposals: [],
    });
    const dead = fakeFetch({ [S]: () => { throw new Error("offline"); } });
    expect(await live({ fetchImpl: dead.impl, storage: null }).readIntake("a cake")).toEqual({
      state: "interpreted",
      summary: "a cake",
      proposals: [],
    });
  });
});

/* ------------------------------------------------ 8. submit and after ---- */

describe("submitRequest reads the nested `request` key", () => {
  it("maps a submitted request to received + the estimate's requestId", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [ESTIMATE]: () => ({ body: { estimate: ESTIMATED } }),
      [SUBMIT]: () => ({ body: { request: { state: "pending_couranr_review" } } }),
    });
    const a = live({ fetchImpl: f.impl, storage: null });
    await a.quote(GOOD_QUOTE_INPUT);
    expect(await a.submitRequest()).toEqual({ state: "received", requestId: "req-1" });
  });

  it("a flat body or a refusal is unavailable, with the server's message", async () => {
    const flat = fakeFetch({ [S]: SESSION_OK, [SUBMIT]: () => ({ body: { state: "x" } }) });
    expect((await live({ fetchImpl: flat.impl, storage: null }).submitRequest()).state).toBe(
      "unavailable"
    );
    const refused = fakeFetch({
      [S]: SESSION_OK,
      [SUBMIT]: () => ({
        status: 422,
        body: { error: "Add a phone number or email so Couranr can reach you about this delivery." },
      }),
    });
    const r = await live({ fetchImpl: refused.impl, storage: null }).submitRequest();
    expect(r.state).toBe("unavailable");
    if (r.state === "unavailable") expect(r.note).toContain("phone number or email");
  });
});

describe("authorizePayment: server intent or an honest not-payable", () => {
  it("a minted intent becomes authorization-required with the SERVER's amount", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [PAY]: () => ({ body: { payment: { clientSecret: "pi_x_secret_y", amountCents: 1049 } } }),
    });
    expect(await live({ fetchImpl: f.impl, storage: null }).authorizePayment()).toEqual({
      state: "authorization-required",
      clientSecret: "pi_x_secret_y",
      amountCents: 1049,
    });
  });

  it("a pending-review refusal maps to not-payable with the server's words", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [PAY]: () => ({
        status: 409,
        body: { error: "Couranr is reviewing this delivery. Payment opens once Couranr confirms it." },
      }),
    });
    const r = await live({ fetchImpl: f.impl, storage: null }).authorizePayment();
    expect(r.state).toBe("not-payable");
    if (r.state === "not-payable") expect(r.note).toContain("reviewing");
  });

  it("a flat body cannot become a payable state", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [PAY]: () => ({ body: { clientSecret: "pi_flat", amountCents: 1 } }),
    });
    expect((await live({ fetchImpl: f.impl, storage: null }).authorizePayment()).state).toBe(
      "not-available"
    );
  });
});

describe("reconcilePayment trusts only the server's payment key", () => {
  it("reads the nested `payment` key, both field spellings", async () => {
    const a = live({
      fetchImpl: fakeFetch({
        [S]: SESSION_OK,
        [RECONCILE]: () => ({ body: { payment: { outcome: "authorized", paymentState: "authorized" } } }),
      }).impl,
      storage: null,
    });
    expect(await a.reconcilePayment!()).toEqual({ outcome: "authorized", paymentState: "authorized" });

    const b = live({
      fetchImpl: fakeFetch({
        [S]: SESSION_OK,
        [RECONCILE]: () => ({ body: { payment: { state: "authorized" } } }),
      }).impl,
      storage: null,
    });
    expect((await b.reconcilePayment!()).paymentState).toBe("authorized");
  });

  it("a failure or a flat body can NEVER read as authorized", async () => {
    const down = live({
      fetchImpl: fakeFetch({ [S]: SESSION_OK, [RECONCILE]: () => ({ status: 500, body: { error: "x" } }) }).impl,
      storage: null,
    });
    expect((await down.reconcilePayment!()).paymentState).toBeNull();
    const flat = live({
      fetchImpl: fakeFetch({
        [S]: SESSION_OK,
        [RECONCILE]: () => ({ body: { outcome: "authorized", paymentState: "authorized" } }),
      }).impl,
      storage: null,
    });
    expect((await flat.reconcilePayment!()).paymentState).toBeNull();
  });
});

describe("readRequest: the tracking token is the server's to grant", () => {
  it("returns the nested view with its token", async () => {
    const a = live({
      fetchImpl: fakeFetch({
        [S]: SESSION_OK,
        [REQUEST]: () => ({
          body: {
            request: {
              state: "confirmed",
              quoteStatus: "estimated",
              totalCents: 1049,
              paymentState: "authorized",
              trackingToken: "trk_abc",
            },
          },
        }),
      }).impl,
      storage: null,
    });
    expect(await a.readRequest!()).toEqual({
      state: "confirmed",
      quoteStatus: "estimated",
      totalCents: 1049,
      paymentState: "authorized",
      trackingToken: "trk_abc",
    });
  });

  it("a view without a token has NO trackingToken key; failures are null", async () => {
    const a = live({
      fetchImpl: fakeFetch({
        [S]: SESSION_OK,
        [REQUEST]: () => ({
          body: {
            request: { state: "pending_couranr_review", quoteStatus: "estimated", totalCents: 1049, paymentState: null },
          },
        }),
      }).impl,
      storage: null,
    });
    const view = await a.readRequest!();
    expect(view && "trackingToken" in view).toBe(false);
    const down = live({
      fetchImpl: fakeFetch({ [S]: SESSION_OK, [REQUEST]: () => ({ status: 500, body: { error: "x" } }) }).impl,
      storage: null,
    });
    expect(await down.readRequest!()).toBeNull();
  });
});

/* -------------------------------------------- 9. seam parity guards ------ */

describe("the seam agrees with the server actor's contract", () => {
  it("uses the same guest header the consumer lib exports", () => {
    expect(GUEST_HEADER).toBe(SERVER_GUEST_HEADER);
    expect(GUEST_HEADER).toBe("x-couranr-guest");
  });

  it("uses the contracted storage key", () => {
    expect(GUEST_STORAGE_KEY).toBe("couranr-send-guest");
  });
});

/* ------------------------------- 10. fixture stays untouched ------------- */

describe("GUARD: the fixture path is unchanged, and production is live", () => {
  const PROD = { nodeEnv: "production" as const };

  it("production resolves the live set (no disabled product path)", () => {
    const a = getSameDayAdapters(PROD);
    expect(a.mode).toBe("live");
    expect(typeof a.reconcilePayment).toBe("function");
    expect(typeof a.readRequest).toBe("function");
  });

  it("the fixture path still answers exactly what it shipped answering", async () => {
    const a = getSameDayAdapters({ nodeEnv: "test" });
    expect(a.mode).toBe("fixture");
    const q = await a.quote({ pickup: "a", destination: "b", timingIntent: "asap" });
    expect(q.state).toBe("fixture-available");
    expect(q.state === "fixture-available" && q.totalCents).toBe(BASE_PRICE_CENTS);
    expect((await a.submitRequest()).state).toBe("received-preview");
    expect((await a.authorizePayment()).state).toBe("authorized-fixture");
    const s = await a.searchAddress("main");
    expect(s.status === "ok" && s.suggestions.length).toBeGreaterThan(0);
  });

  it("the fixture set gained no live-only method, and its block talks to no server", () => {
    const a = getSameDayAdapters({ nodeEnv: "test" as const });
    expect(a.reconcilePayment).toBeUndefined();
    expect(a.readRequest).toBeUndefined();
    const src = readFileSync(path.join(ROOT, "lib/couranr/sameday/adapters.ts"), "utf8");
    // The disabled product path is removed, not left dormant.
    expect(src).not.toContain("const DISABLED");
    const fixture = src.slice(src.indexOf("const FIXTURE"), src.indexOf("export function getSameDayAdapters"));
    expect(fixture, "FIXTURE constructs a live state").not.toContain("live-available");
    expect(fixture, "FIXTURE constructs a live state").not.toContain("authorization-required");
    expect(fixture, "FIXTURE talks to a server").not.toContain("fetch(");
  });
});

/* -------------------------------- 11. the SendFlow structured inputs ----- */

describe("SendFlow's structured inputs stay in parity with the governed vocabularies", () => {
  const sendFlow = readFileSync(
    path.join(ROOT, "components/couranr/sameday/SendFlow.tsx"),
    "utf8"
  );
  const merchantFlow = readFileSync(
    path.join(ROOT, "components/couranr/requests/NewDeliveryFlow.tsx"),
    "utf8"
  );

  const optionsBlock = (src: string, file: string): string => {
    const m = src.match(/const RESTRICTED_CLASS_OPTIONS[^=]*=\s*\[([\s\S]*?)\n\];/);
    expect(m, `${file} has no RESTRICTED_CLASS_OPTIONS block`).not.toBeNull();
    return m![1]
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join("\n");
  };

  it("the restricted-items options are the merchant flow's, byte for byte", () => {
    expect(optionsBlock(sendFlow, "SendFlow")).toBe(optionsBlock(merchantFlow, "NewDeliveryFlow"));
  });

  it("weight bands render through WEIGHT_BAND_LABELS, never a restated boundary", () => {
    expect(sendFlow).toContain('WEIGHT_BAND_LABELS["0_25_lb"]');
    expect(sendFlow).toContain("WEIGHT_BAND_LABELS.over_25_to_50_lb");
    expect(sendFlow).toContain("WEIGHT_BAND_LABELS.over_50_lb");
    // The boundary strings themselves never appear as literals.
    expect(sendFlow).not.toContain("25 lb or less");
    expect(sendFlow).not.toContain("More than 25 lb");
  });

  it("the payment phase reuses the ONE Payment Element", () => {
    expect(sendFlow).toContain(
      'from "@/components/couranr/payments/CouranrPaymentElement"'
    );
    expect(sendFlow).not.toMatch(/confirmPayment|loadStripe|PaymentIntent/);
  });
});

/* ------------------- consumer timing parity (TMZ-001) --------------------- */

describe("consumer timing: ASAP or scheduled, Eastern, server-evaluated — business parity", () => {
  const sendFlow = readFileSync("components/couranr/sameday/SendFlow.tsx", "utf8");

  it("renders BOTH governed intents and a datetime input for a scheduled pickup, in every mode", () => {
    expect(sendFlow).toMatch(/\["asap", SEND_COPY\.timing_asap\]/);
    expect(sendFlow).toMatch(/\["scheduled", SEND_COPY\.timing_schedule\]/);
    expect(sendFlow).toMatch(/type="datetime-local"/);
    // 'today' is not a DB intent: ASAP before the cutoff IS today (HRS-001).
    expect(sendFlow).not.toMatch(/timing_today/);
    // The old live-only ASAP gate is gone.
    expect(sendFlow).not.toMatch(/mode === "live"\s*\?\s*\(\[\["asap"/);
  });

  it("the cutoff hint reads HRS-001's governed value, never a restated literal", () => {
    expect(sendFlow).toMatch(/SAME_DAY_CUTOFF_COPY/);
    expect(sendFlow).not.toMatch(/4:00 PM/);
  });

  it("the wire carries the sender's intent and local words only — no zone, no instant", () => {
    const adapters = readFileSync("lib/couranr/sameday/liveAdapters.ts", "utf8");
    expect(adapters).toMatch(/intent:\s*timingIntent/);
    expect(adapters).toMatch(/requestedPickupLocal:\s*timingIntent === "scheduled" \? requestedPickupLocal : null/);
    expect(adapters).not.toMatch(/requestedDepartureAt:/);
  });
});

describe("timing-aware quote readings", () => {
  it("echoes the server's scheduled timing on a priced quote", () => {
    const q = quoteReadingFromEstimate({
      ...ESTIMATED,
      timing: { intent: "scheduled", requestedPickupLocal: "2027-03-10T10:30" },
    });
    expect(q.state).toBe("live-available");
    if (q.state === "live-available") {
      expect(q.timing).toEqual({ intent: "scheduled", requestedPickupLocal: "2027-03-10T10:30" });
    }
  });

  it("names the TIMING reason for a review — overnight vs a time Couranr must confirm", () => {
    expect(reviewNoteFor(["overnight_requires_couranr_confirmation"])).toMatch(/outside standard hours/);
    expect(reviewNoteFor(["timing_needs_review"])).toMatch(/confirm this pickup time/);
    expect(reviewNoteFor(["weight_unresolved"])).toMatch(/review this delivery/);
    const q = quoteReadingFromEstimate({
      ...ESTIMATED,
      quoteStatus: "manual_review_required",
      totalCents: null,
      reviewReasons: ["overnight_requires_couranr_confirmation"],
    });
    expect(q.state === "manual-review" && q.note).toMatch(/outside standard hours/);
  });

  it("a malformed timing echo is dropped, never invented", () => {
    expect(timingFromEstimate({ intent: "whenever" })).toBeNull();
    expect(timingFromEstimate(null)).toBeNull();
    expect(timingFromEstimate({ intent: "asap", requestedPickupLocal: 5 })).toEqual({
      intent: "asap",
      requestedPickupLocal: null,
    });
  });
});

/* --------------------- CAP-001 consumer order (review item 2) ------------ */

describe("CAP-001 payment order surfaces (review item 2)", () => {
  it("a quote_expired refusal maps to its OWN state — the remedy is re-estimate", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [PAY]: () => ({
        status: 410,
        body: { error: "The quote expired.", code: "quote_expired" },
      }),
    });
    const r = await live({ fetchImpl: f.impl, storage: null }).authorizePayment();
    expect(r.state).toBe("quote-expired");
  });

  it("other refusals still map to not-payable, never quote-expired", async () => {
    const f = fakeFetch({
      [S]: SESSION_OK,
      [PAY]: () => ({
        status: 409,
        body: { error: "Couranr is reviewing this delivery.", code: "wrong_state" },
      }),
    });
    expect((await live({ fetchImpl: f.impl, storage: null }).authorizePayment()).state).toBe(
      "not-payable"
    );
  });

  const sendFlow = readFileSync("components/couranr/sameday/SendFlow.tsx", "utf8");

  it("the resume path is live-only, feature-checked and gated on a STORED session", () => {
    // A reload resumes from the canonical request/payment state; a first
    // visit must not mint a guest session just by loading the page.
    expect(sendFlow).toMatch(/mode !== "live" \|\| !adapters\.readRequest/);
    expect(sendFlow).toMatch(/sessionStorage\.getItem\(GUEST_STORAGE_KEY\)/);
    expect(sendFlow).toMatch(/if \(!stored\) return;/);
  });

  it("the resume mapping covers all four canonical postures", () => {
    for (const state of [
      "awaiting_quote_acceptance",
      "quote_revision_required",
      "pending_couranr_review",
      "confirmed",
    ]) {
      expect(sendFlow).toContain(`"${state}"`);
    }
    expect(sendFlow).toMatch(/Couranr updated the price/);
  });

  it("submit recovers from quote expiry by re-estimating, not by dead-ending", () => {
    expect(sendFlow).toMatch(/auth\.state === "quote-expired"/);
    expect(sendFlow).toMatch(/The price was refreshed/);
  });

  it("the received screen states the authorized-not-charged truth only when the server says so", () => {
    expect(sendFlow).toMatch(/authorizedPending/);
    expect(sendFlow).toMatch(/paymentState === "authorized" && view\?\.state === "pending_couranr_review"/);
    expect(sendFlow).toMatch(/only be charged after Couranr/);
  });
});
