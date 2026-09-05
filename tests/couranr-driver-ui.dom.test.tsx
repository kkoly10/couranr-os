import * as React from "react";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "@/components/couranr/requests/client";
import type {
  AssignedDeliveryView,
  DeliveryAddressView,
  DriverAssignmentResponse,
  DriverCompletionReceipt,
  ProofMetadataView,
} from "@/components/couranr/dispatch/client";
import type { LocationState } from "@/components/couranr/dispatch/useLocationCapture";
import { PROOF_METHOD_LABELS, type ProofMethod } from "@/lib/couranr/driver/states";
// Pure and dependency-free — the allow-list itself, not a copy of it.
import { PROJECTION_ALLOWED_KEYS } from "@/lib/couranr/dispatch/projection";

/**
 * The driver, merchant and Operations surfaces, as a PERSON meets them.
 *
 * Typecheck cannot reach this layer: a component can be imported and never
 * rendered, a failure can render as an emptiness, and a form can be enabled
 * with nothing behind it — all while `tsc` stays green. Three defects this
 * repo has already paid for are re-proved here directly:
 *
 *   - a failed lookup rendered as an empty one ("you have no business");
 *   - a missing location becoming 0/0, a real point in the Gulf of Guinea;
 *   - an empty numeric field becoming 0, recorded as the driver's own count.
 *
 * Every leak checker below carries a POSITIVE CONTROL. A "no leak" assertion
 * passes trivially against a component that rendered nothing at all, and a
 * checker that cannot fire proves nothing — this repo has shipped both.
 */

/* --------------------------------------------------------------- doubles -- */

const fetchMyAssignment = vi.fn();
const startRouteToPickup = vi.fn();
const arriveAtPickup = vi.fn();
const startRouteToDropoff = vi.fn();
const arriveAtDropoff = vi.fn();
const completePickup = vi.fn();
const completeDirectHandoff = vi.fn();
const completeSignature = vi.fn();
const completeLeaveAtDoor = vi.fn();
const reportDiscrepancy = vi.fn();
const verifyPickupCode = vi.fn();
const verifyRecipientCode = vi.fn();
const fetchMerchantProof = vi.fn();
const fetchMyProof = vi.fn();
const fetchOperationsProofUrl = vi.fn();
const issueMerchantPickupCode = vi.fn();
const issueMerchantRecipientCode = vi.fn();
const issueOperationsPickupCode = vi.fn();
const issueOperationsRecipientCode = vi.fn();
const requestProofUpload = vi.fn();
const finalizeProofUpload = vi.fn();

/**
 * The browser client is doubled wholesale, so nothing here reaches `fetch` or
 * a Supabase session. The real module is spread in first: an export this file
 * forgot to name would otherwise be `undefined` at its call site and fail as
 * "not a function" rather than as the assertion it was meant to make.
 *
 * `./client` from inside `components/couranr/dispatch` resolves to this same
 * module, so both import spellings get the same doubles.
 */
vi.mock("@/components/couranr/dispatch/client", async (importOriginal) => {
  const actual = await (importOriginal() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    fetchMyAssignment: (...a: unknown[]) => fetchMyAssignment(...a),
    startRouteToPickup: (...a: unknown[]) => startRouteToPickup(...a),
    arriveAtPickup: (...a: unknown[]) => arriveAtPickup(...a),
    startRouteToDropoff: (...a: unknown[]) => startRouteToDropoff(...a),
    arriveAtDropoff: (...a: unknown[]) => arriveAtDropoff(...a),
    completePickup: (...a: unknown[]) => completePickup(...a),
    completeDirectHandoff: (...a: unknown[]) => completeDirectHandoff(...a),
    completeSignature: (...a: unknown[]) => completeSignature(...a),
    completeLeaveAtDoor: (...a: unknown[]) => completeLeaveAtDoor(...a),
    reportDiscrepancy: (...a: unknown[]) => reportDiscrepancy(...a),
    verifyPickupCode: (...a: unknown[]) => verifyPickupCode(...a),
    verifyRecipientCode: (...a: unknown[]) => verifyRecipientCode(...a),
    fetchMerchantProof: (...a: unknown[]) => fetchMerchantProof(...a),
    fetchMyProof: (...a: unknown[]) => fetchMyProof(...a),
    fetchOperationsProofUrl: (...a: unknown[]) => fetchOperationsProofUrl(...a),
    issueMerchantPickupCode: (...a: unknown[]) => issueMerchantPickupCode(...a),
    issueMerchantRecipientCode: (...a: unknown[]) => issueMerchantRecipientCode(...a),
    issueOperationsPickupCode: (...a: unknown[]) => issueOperationsPickupCode(...a),
    issueOperationsRecipientCode: (...a: unknown[]) => issueOperationsRecipientCode(...a),
    requestProofUpload: (...a: unknown[]) => requestProofUpload(...a),
    finalizeProofUpload: (...a: unknown[]) => finalizeProofUpload(...a),
  };
});

// next/link wants an App Router context it will not get here; reduced to an
// anchor so link names and hrefs stay assertable.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/driver",
}));

const { DriverAssignmentCard } = await import(
  "@/components/couranr/dispatch/DriverAssignmentCard"
);
const { AssignedDeliveryDetail } = await import(
  "@/components/couranr/dispatch/AssignedDeliveryDetail"
);
const { DropoffProof } = await import("@/components/couranr/dispatch/DropoffProof");
const { PickupFlow, parsePackageCount, readDeliveryVersion } = await import(
  "@/components/couranr/dispatch/PickupFlow"
);
const { PickupDiscrepancy } = await import("@/components/couranr/dispatch/PickupDiscrepancy");
const { MerchantProofPanel } = await import("@/components/couranr/dispatch/MerchantProofPanel");
const { HandoffCodePanel } = await import("@/components/couranr/dispatch/HandoffCodePanel");

/* -------------------------------------------------------------- fixtures -- */

/**
 * Sentinels, not plausible values. Each string could only have come from the
 * ACTIVE projection, so a leak checker that finds one on a completion receipt
 * has found a real disclosure rather than a coincidence.
 */
const PICKUP_LINE1 = "412 Sentinel Pickup Way";
const DROPOFF_LINE1 = "9 Sentinel Dropoff Court";
const RECIPIENT_NAME = "Sentinel Recipient";
const RECIPIENT_PHONE = "+15550001111";
const MERCHANT_PHONE = "+15550002222";

/**
 * `version` is nullable on the projection — the server may not be able to
 * determine one, and `readDeliveryVersion` blocks the action rather than
 * guessing. Every fixture here carries a real one, so a test that asserts a
 * command RAN is asserting it ran with the version the projection supplied,
 * not with a fallback.
 *
 * A FIXTURE MORE GENEROUS THAN THE SERVER PROVES NOTHING. This type used to
 * INTERSECT a `version` onto the view because the projection did not emit one —
 * so every test here ran against a delivery the server could never actually
 * produce, and the whole execution flow shipped dead: DRV-002 rendered a
 * disabled "Start route to pickup" under "Couranr could not confirm this
 * delivery's current version". The intersection is gone; the field is declared
 * on the view itself, and `the fixture cannot outrun the server` below keeps
 * the two from drifting apart again.
 */
type AssignedFixture = AssignedDeliveryView;

function address(over: Partial<DeliveryAddressView> = {}): DeliveryAddressView {
  return {
    line1: "",
    line2: "",
    city: "",
    region: "VA",
    postalCode: "22554",
    instructions: "",
    ...over,
  };
}

function assignedView(over: Partial<AssignedFixture> = {}): AssignedFixture {
  return {
    deliveryId: "del-fixture-1",
    version: 4,
    fulfillmentState: "en_route_to_pickup",
    serviceLevel: "standard",
    scheduledPickupStart: "2026-08-03T14:00:00.000Z",
    scheduledPickupEnd: "2026-08-03T16:00:00.000Z",
    timezone: "America/New_York",
    pickup: address({ line1: PICKUP_LINE1, city: "Stafford" }),
    dropoff: address({ line1: DROPOFF_LINE1, city: "Fredericksburg" }),
    merchant: { name: "Bright Cleaners", phone: MERCHANT_PHONE },
    recipient: { name: RECIPIENT_NAME, phone: RECIPIENT_PHONE },
    shipment: {
      description: "Three boxed garments",
      packageCount: 3,
      orderReference: "ORD-381",
      handlingNotes: "Keep dry",
      declaredWeightLb: 20,
      additionalStops: 0,
    },
    proof: { method: "photo_or_pin", signatureRequired: false },
    vehicleRequirement: { vehicleClass: "cargo_van", maxPayloadLb: 100 },
    assignment: {
      assignmentId: "asg-fixture-1",
      assignedAt: "2026-08-03T13:30:00.000Z",
      vehicle: { id: "veh-fixture-1", name: "Van 2", vehicleClass: "cargo_van" },
    },
    ...over,
  };
}

function completionReceipt(over: Partial<DriverCompletionReceipt> = {}): DriverCompletionReceipt {
  return {
    deliveryId: "del-fixture-1",
    assignmentId: "asg-fixture-1",
    deliveredAt: "2026-08-03T17:05:00.000Z",
    proofMethod: "photo_or_pin",
    pickupProofComplete: true,
    deliveryProofComplete: true,
    ...over,
  };
}

const ok = <T,>(value: T): ApiResult<T> => ({ ok: true, value });

const fail = (status = 500, extra: Record<string, unknown> = {}) =>
  ({
    ok: false,
    status,
    error: "Couranr could not complete that just now.",
    ...extra,
  }) as ApiResult<never>;

/**
 * Annotated, not inferred. Inference narrows `status` to the literal it is
 * given, and the denied fixture below then fails to typecheck — in the one
 * test that proves a missing location blocks a mutation.
 */
function locationState(over: Partial<LocationState> = {}): LocationState {
  return {
    status: "not_requested",
    fix: null,
    message: "Couranr needs your location for this step.",
    usable: false,
    request: vi.fn(),
    ...over,
  };
}

const USABLE_FIX = { latitude: 38.4221, longitude: -77.4083, accuracyM: 8 };
const DENIED_MESSAGE = "Location is blocked for this site.";

const usableLocation = (): LocationState =>
  locationState({
    status: "ready",
    fix: USABLE_FIX,
    message: "Location captured.",
    usable: true,
  });

/** jsdom implements no Geolocation API, so the real hook is fed one on demand. */
function stubGeolocation(mode: "granted" | "denied") {
  const getCurrentPosition = vi.fn((onOk: any, onErr: any) => {
    if (mode === "denied") onErr({ code: 1 });
    else
      onOk({
        coords: {
          latitude: USABLE_FIX.latitude,
          longitude: USABLE_FIX.longitude,
          accuracy: USABLE_FIX.accuracyM,
        },
      });
  });
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
  return getCurrentPosition;
}

const bodyText = () => document.body.textContent ?? "";

const ALL_DOUBLES = [
  fetchMyAssignment,
  startRouteToPickup,
  arriveAtPickup,
  startRouteToDropoff,
  arriveAtDropoff,
  completePickup,
  completeDirectHandoff,
  completeSignature,
  completeLeaveAtDoor,
  reportDiscrepancy,
  verifyPickupCode,
  verifyRecipientCode,
  fetchMerchantProof,
  fetchMyProof,
  fetchOperationsProofUrl,
  issueMerchantPickupCode,
  issueMerchantRecipientCode,
  issueOperationsPickupCode,
  issueOperationsRecipientCode,
  requestProofUpload,
  finalizeProofUpload,
];

beforeEach(() => {
  for (const m of ALL_DOUBLES) m.mockReset();
  // PickupFlow reads what the server already holds on mount. `mockReset` leaves
  // a bare `undefined`, which would make every pickup test die on `.then` — so
  // the DEFAULT is an empty, successful read: nothing recorded yet. Tests that
  // care override it.
  fetchMyProof.mockResolvedValue(ok({ proof: [] }));
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
});

/* =========================================================================
 * 0 — the fixture is not more generous than the server
 * ====================================================================== */

describe("the fixture cannot outrun the server", () => {
  it("supplies exactly the keys the projection allows, no more and no fewer", () => {
    const fixtureKeys = Object.keys(assignedView()).sort();
    const allowed = [...PROJECTION_ALLOWED_KEYS].sort();

    // Extra keys would let a test drive a screen against data no driver can
    // ever receive — which is how the whole execution flow shipped dead behind
    // a missing `version` while 956 unit tests stayed green.
    expect(fixtureKeys.filter((k) => !allowed.includes(k)), "fixture invented a field").toEqual([]);
    // Missing keys would leave a rendered field permanently untested.
    expect(allowed.filter((k) => !fixtureKeys.includes(k)), "fixture omits a real field").toEqual(
      []
    );
  });

  it("carries a version, because every driver command sends one", () => {
    expect(assignedView().version).toBe(4);
    expect(PROJECTION_ALLOWED_KEYS).toContain("version");
  });
});

/* =========================================================================
 * 1 — active, recently_completed and none each render distinctly
 * ====================================================================== */

describe("DRV-001: three outcomes, three screens", () => {
  it("renders active as live work with the one legal next action", async () => {
    fetchMyAssignment.mockResolvedValue(
      ok({ status: "active", assigned: assignedView() } as DriverAssignmentResponse)
    );
    render(<DriverAssignmentCard />);
    await screen.findByTestId("drv001-assignment");

    expect(screen.getByText("On the way to pickup")).toBeTruthy();
    // `en_route_to_pickup` admits exactly one command, and this is it.
    expect(screen.getByRole("link", { name: "I have arrived at pickup" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /open assigned delivery/i })).toBeTruthy();
    expect(screen.queryByText("No delivery assigned to you")).toBeNull();
    expect(screen.queryByText("Delivery completed")).toBeNull();
  });

  it("renders recently_completed as a receipt, with nothing to press", async () => {
    fetchMyAssignment.mockResolvedValue(
      ok({
        status: "recently_completed",
        receipt: completionReceipt(),
      } as DriverAssignmentResponse)
    );
    render(<DriverAssignmentCard />);
    await screen.findByTestId("drv001-assignment");

    expect(screen.getByText("Delivery completed")).toBeTruthy();
    expect(screen.getByText("Delivered")).toBeTruthy();
    expect(screen.getByText("Pickup proof complete")).toBeTruthy();
    // A finished delivery offers no command and no way back into it.
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByText("No delivery assigned to you")).toBeNull();
  });

  it("renders none as a calm, actionless empty state", async () => {
    fetchMyAssignment.mockResolvedValue(
      ok({ status: "none", assigned: null } as DriverAssignmentResponse)
    );
    render(<DriverAssignmentCard />);
    await screen.findByTestId("drv001-assignment");

    expect(screen.getByText("No delivery assigned to you")).toBeTruthy();
    expect(screen.getByText(/nothing to accept or claim/i)).toBeTruthy();
    // An empty schedule is not an error: nothing is announced assertively and
    // nothing invites a retry.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("produces four mutually distinct renderings, counting the failure", async () => {
    const seen: string[] = [];
    for (const response of [
      ok({ status: "active", assigned: assignedView() } as DriverAssignmentResponse),
      ok({
        status: "recently_completed",
        receipt: completionReceipt(),
      } as DriverAssignmentResponse),
      ok({ status: "none", assigned: null } as DriverAssignmentResponse),
      fail(500),
    ]) {
      fetchMyAssignment.mockResolvedValue(response);
      const { unmount } = render(<DriverAssignmentCard />);
      await screen.findByTestId("drv001-assignment");
      seen.push(bodyText());
      unmount();
    }

    const [active, completed, none, failed] = seen;
    expect(new Set(seen).size, "two outcomes rendered identically").toBe(4);

    // Distinctness by whitespace would be worthless, so each carries a marker
    // the other three must not.
    expect(active).toContain("On the way to pickup");
    expect(completed).toContain("Delivery completed");
    expect(none).toContain("No delivery assigned to you");
    expect(failed).toContain("could not be loaded");

    for (const marker of ["On the way to pickup", "Delivery completed"]) {
      expect(none, `the empty state borrowed "${marker}"`).not.toContain(marker);
      expect(failed, `the failure borrowed "${marker}"`).not.toContain(marker);
    }
  });
});

/* =========================================================================
 * 2 — a FAILED request must never render like status:"none"
 * ====================================================================== */

describe("a failed assignment lookup is not an empty one", () => {
  const FAILURES: Array<[number, string]> = [
    [0, "offline"],
    [401, "unauthenticated"],
    [403, "forbidden"],
    [404, "not found"],
    [500, "server error"],
    [503, "unavailable"],
  ];

  it("DRV-001 shows an alarming, retryable error with the support reference", async () => {
    fetchMyAssignment.mockResolvedValue(fail(500, { correlationId: "cr_abcdefghjkmn" }));
    render(<DriverAssignmentCard />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    // The point of the fourth treatment: the driver is told NOT to read this
    // as an empty day and go home.
    expect(screen.getByText(/do not assume Couranr has no work for you/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    expect(bodyText()).toContain("cr_abcdefghjkmn");

    expect(screen.queryByText("No delivery assigned to you")).toBeNull();
    expect(screen.queryByText(/nothing to accept or claim/i)).toBeNull();
  });

  it("DRV-002 shows an error, never the empty state, on every failure status", async () => {
    for (const [status, label] of FAILURES) {
      fetchMyAssignment.mockResolvedValue(fail(status));
      const { unmount } = render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);

      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      expect(screen.getByText(/could not load your delivery/i), label).toBeTruthy();
      expect(
        screen.queryByText("No delivery assigned to you"),
        `${label} rendered as "no assignment"`
      ).toBeNull();
      unmount();
    }
  });

  it("the failed treatment and the empty treatment differ in words AND in role", async () => {
    fetchMyAssignment.mockResolvedValue(fail(500));
    const failed = render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const failedText = bodyText();
    failed.unmount();

    fetchMyAssignment.mockResolvedValue(
      ok({ status: "none", assigned: null } as DriverAssignmentResponse)
    );
    render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);
    await screen.findByText("No delivery assigned to you");

    expect(failedText).not.toBe(bodyText());
    expect(failedText).toMatch(/not the same as having no work assigned/i);
    expect(bodyText()).not.toMatch(/not the same as having no work assigned/i);
    // Different visual treatment, machine-checkable: alert vs status.
    expect(document.querySelector('[role="alert"]')).toBeNull();
    expect(document.querySelector('[role="status"]')).not.toBeNull();
  });
});

/* =========================================================================
 * 3 — the status union is handled exhaustively (no fallthrough)
 * ====================================================================== */

describe("the DriverAssignmentResponse union is closed", () => {
  /**
   * The compile-time half. Adding a member to the union makes this switch
   * non-exhaustive and `npx tsc --noEmit` fails on the `never` assignment —
   * before any renderer gets the chance to fall through to an empty state.
   */
  function describeStatus(response: DriverAssignmentResponse): string {
    switch (response.status) {
      case "active":
        return "active";
      case "recently_completed":
        return "recently_completed";
      case "none":
        return "none";
      default: {
        const unexpected: never = response;
        return unexpected;
      }
    }
  }

  it("declares exactly three statuses", () => {
    // A missing key here is a type error, so this list cannot drift.
    const all: Record<DriverAssignmentResponse["status"], true> = {
      active: true,
      recently_completed: true,
      none: true,
    };
    expect(Object.keys(all).sort()).toEqual(["active", "none", "recently_completed"]);
    expect(describeStatus({ status: "none", assigned: null })).toBe("none");
    expect(describeStatus({ status: "active", assigned: assignedView() })).toBe("active");
    expect(describeStatus({ status: "recently_completed", receipt: completionReceipt() })).toBe(
      "recently_completed"
    );
  });

  it("DRV-001 treats an unknown status as unreadable, not as no work", async () => {
    fetchMyAssignment.mockResolvedValue(
      ok({ status: "reassigned_elsewhere" } as unknown as DriverAssignmentResponse)
    );
    render(<DriverAssignmentCard />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/could not be read/i)).toBeTruthy();
    expect(screen.queryByText("No delivery assigned to you")).toBeNull();
  });

  it("DRV-002 treats an unknown status as unreadable, not as no work", async () => {
    fetchMyAssignment.mockResolvedValue(
      ok({ status: "reassigned_elsewhere" } as unknown as DriverAssignmentResponse)
    );
    render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/does not understand/i)).toBeTruthy();
    expect(screen.queryByText("No delivery assigned to you")).toBeNull();
  });
});

/* =========================================================================
 * 4 — direct handoff never renders "photo or PIN"
 * 5 — the correct form renders for each immutable proof method
 * 6 — leave-at-door cannot appear when the stored method is something else
 * ====================================================================== */

/** The one control that proves a given form, and only that form, is on screen. */
const FORM_MARKERS: Record<ProofMethod, RegExp> = {
  photo_or_pin: /six-digit recipient code/i,
  signature: /signature pad/i,
  leave_at_door: /photo of where you left it/i,
};

const METHODS: ProofMethod[] = ["photo_or_pin", "signature", "leave_at_door"];

function renderDropoff(method: string, location: LocationState = usableLocation()) {
  const assigned = assignedView({
    fulfillmentState: "at_dropoff",
    proof: { method, signatureRequired: method === "signature" },
  });
  const onCompleted = vi.fn();
  const utils = render(
    <DropoffProof assigned={assigned} location={location} onCompleted={onCompleted} />
  );
  return { ...utils, onCompleted, assigned };
}

describe("DRV-006: the stored proof method selects exactly one form", () => {
  it.each(METHODS)("renders only the %s form", (method) => {
    renderDropoff(method);

    expect(screen.getByLabelText(FORM_MARKERS[method])).toBeTruthy();
    for (const other of METHODS.filter((m) => m !== method)) {
      expect(
        screen.queryByLabelText(FORM_MARKERS[other]),
        `${method} also rendered the ${other} form`
      ).toBeNull();
    }
  });

  it("names the method with the driver-facing label, never the stored enum", () => {
    for (const method of METHODS) {
      const { unmount } = renderDropoff(method);
      expect(bodyText(), method).toContain(PROOF_METHOD_LABELS[method]);
      expect(bodyText(), `${method} echoed a raw database enum`).not.toMatch(
        /photo_or_pin|leave_at_door|at_dropoff/
      );
      unmount();
    }
  });

  it('never renders "photo or PIN" on the direct-handoff path', () => {
    renderDropoff("photo_or_pin");

    // The stored value keeps its historical name because it sits on live rows.
    // A driver is never shown it, and a photograph is never offered as an
    // alternative to the recipient's own code.
    expect(bodyText()).not.toMatch(/photo\s*(or|\/|&)\s*pin/i);
    expect(bodyText()).not.toMatch(/or a photo|photo instead/i);
    expect(screen.getByText("Recipient PIN handoff")).toBeTruthy();
    expect(screen.getByRole("button", { name: /complete handoff/i })).toBeTruthy();
  });

  it('never renders "photo or PIN" on the surfaces that only DESCRIBE the method', async () => {
    fetchMyAssignment.mockResolvedValue(
      ok({
        status: "recently_completed",
        receipt: completionReceipt({ proofMethod: "photo_or_pin" }),
      } as DriverAssignmentResponse)
    );
    const card = render(<DriverAssignmentCard />);
    await screen.findByTestId("drv001-assignment");
    expect(bodyText()).not.toMatch(/photo\s*(or|\/|&)\s*pin/i);
    expect(bodyText()).toContain("Recipient PIN handoff");
    card.unmount();

    fetchMyAssignment.mockResolvedValue(
      ok({ status: "active", assigned: assignedView() } as DriverAssignmentResponse)
    );
    render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);
    await screen.findByText("Your delivery");
    expect(bodyText()).not.toMatch(/photo\s*(or|\/|&)\s*pin/i);
    expect(screen.getByText("Recipient PIN handoff")).toBeTruthy();
  });

  it("offers no way to choose or change the proof method", () => {
    for (const method of METHODS) {
      const { unmount } = renderDropoff(method);
      // A selector of any kind is a driver picking their own evidence standard
      // at the door — always the weaker one, on the shipment that was sold the
      // stronger one.
      expect(screen.queryAllByRole("combobox"), method).toHaveLength(0);
      expect(screen.queryAllByRole("radio"), method).toHaveLength(0);
      expect(screen.queryAllByRole("option"), method).toHaveLength(0);
      expect(screen.queryByRole("button", { name: /change|switch|instead/i }), method).toBeNull();
      unmount();
    }
  });

  it("cannot reach leave-at-door when the stored method is something else", async () => {
    const user = userEvent.setup();
    for (const method of ["photo_or_pin", "signature"]) {
      const { unmount } = renderDropoff(method);

      expect(bodyText(), method).not.toMatch(/leave at door/i);
      expect(screen.queryByLabelText(/this spot is safe/i), method).toBeNull();
      expect(screen.queryByLabelText(/weather here will not damage/i), method).toBeNull();
      expect(screen.queryByLabelText(/photo of where you left it/i), method).toBeNull();

      // Press everything that is pressable. None of it may reach the
      // leave-at-door command.
      for (const button of screen.queryAllByRole("button")) {
        if (!(button as HTMLButtonElement).disabled) await user.click(button);
      }
      expect(completeLeaveAtDoor, method).not.toHaveBeenCalled();
      unmount();
      completeLeaveAtDoor.mockReset();
    }
  });

  it("offers nothing at all before the delivery reaches the drop-off", () => {
    const assigned = assignedView({
      fulfillmentState: "in_transit",
      proof: { method: "leave_at_door", signatureRequired: false },
    });
    render(<DropoffProof assigned={assigned} location={usableLocation()} onCompleted={vi.fn()} />);

    expect(screen.getByText(/opens the drop-off proof once you have arrived/i)).toBeTruthy();
    expect(screen.queryByLabelText(/photo of where you left it/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /complete delivery/i })).toBeNull();
  });

  it("fails closed on a proof method this build does not recognise", () => {
    renderDropoff("retina_scan");

    expect(screen.getByText(/does not recognise this delivery/i)).toBeTruthy();
    for (const marker of Object.values(FORM_MARKERS)) {
      expect(screen.queryByLabelText(marker)).toBeNull();
    }
  });
});

/* =========================================================================
 * 7 — a mutation is blocked when location is not usable
 * ====================================================================== */

describe("no mutation without a usable location fix", () => {
  it("blocks the leave-at-door completion, and its photo, and says why", async () => {
    const user = userEvent.setup();
    renderDropoff("leave_at_door", locationState({ status: "denied", message: DENIED_MESSAGE }));

    const complete = screen.getByRole("button", { name: /^complete delivery$/i });
    expect((complete as HTMLButtonElement).disabled).toBe(true);

    /*
     * The location must be named in the BLOCKER list, not merely somewhere on
     * the page. A leave-at-door form has other outstanding requirements, so a
     * bare "the button is disabled" assertion stays green even if the location
     * guard is deleted outright.
     */
    const blockerList = screen
      .getByText("Still needed before you can finish this delivery")
      .closest(".cr-alert");
    expect(blockerList?.textContent ?? "").toContain(DENIED_MESSAGE);

    await user.click(complete);
    expect(completeLeaveAtDoor).not.toHaveBeenCalled();

    // A photo is itself a claim about where it was taken, so the input is shut
    // rather than the bytes being stored with no fix behind them.
    expect((screen.getByLabelText(/photo of where you left it/i) as HTMLInputElement).disabled).toBe(
      true
    );
    expect(requestProofUpload).not.toHaveBeenCalled();
  });

  it("blocks the recipient handoff even with an accepted code and a name", async () => {
    const user = userEvent.setup();
    verifyRecipientCode.mockResolvedValue(ok({ outcome: "accepted" }));
    renderDropoff("photo_or_pin", locationState());

    await user.type(screen.getByLabelText(/six-digit recipient code/i), "472915");
    await user.click(screen.getByRole("button", { name: /check code/i }));
    await screen.findByText("Code accepted");
    await user.type(screen.getByLabelText(/first name of the person taking/i), "Dana");

    const complete = screen.getByRole("button", { name: /complete handoff/i });
    expect((complete as HTMLButtonElement).disabled).toBe(true);
    await user.click(complete);
    expect(completeDirectHandoff).not.toHaveBeenCalled();
  });

  /**
   * Positive control for the two above. Without it, a component that never
   * completes anything would satisfy every "was not called" assertion.
   */
  it("completes once a fix exists, and sends THAT fix — never 0/0", async () => {
    const user = userEvent.setup();
    verifyRecipientCode.mockResolvedValue(ok({ outcome: "accepted" }));
    completeDirectHandoff.mockResolvedValue(
      ok({
        delivery: { deliveryId: "del-fixture-1", fulfillmentState: "delivered", version: 5 },
        receipt: completionReceipt(),
      })
    );
    const { onCompleted } = renderDropoff("photo_or_pin", usableLocation());

    await user.type(screen.getByLabelText(/six-digit recipient code/i), "472915");
    await user.click(screen.getByRole("button", { name: /check code/i }));
    await screen.findByText("Code accepted");
    await user.type(screen.getByLabelText(/first name of the person taking/i), "Dana");

    const complete = screen.getByRole("button", { name: /complete handoff/i });
    await waitFor(() => expect((complete as HTMLButtonElement).disabled).toBe(false));
    await user.click(complete);

    await waitFor(() => expect(completeDirectHandoff).toHaveBeenCalledTimes(1));
    const [deliveryId, body] = completeDirectHandoff.mock.calls[0];
    expect(deliveryId).toBe("del-fixture-1");
    expect(body.latitude).toBe(USABLE_FIX.latitude);
    expect(body.longitude).toBe(USABLE_FIX.longitude);
    expect(body.accuracyM).toBe(USABLE_FIX.accuracyM);
    expect(body.expectedVersion).toBe(4);
    expect(body.recipientFirstName).toBe("Dana");
    expect(onCompleted).toHaveBeenCalled();
  });

  it("blocks DRV-002's arrival until the browser actually yields a position", async () => {
    const user = userEvent.setup();
    fetchMyAssignment.mockResolvedValue(
      ok({
        status: "active",
        assigned: assignedView({ fulfillmentState: "in_transit" }),
      } as DriverAssignmentResponse)
    );
    arriveAtDropoff.mockResolvedValue(
      ok({ delivery: { deliveryId: "del-fixture-1", fulfillmentState: "at_dropoff", version: 5 } })
    );

    render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);
    const arrive = await screen.findByRole("button", { name: /i have arrived at drop-off/i });

    // No Geolocation API at all — the state this container starts in.
    expect((arrive as HTMLButtonElement).disabled).toBe(true);
    await user.click(arrive);
    expect(arriveAtDropoff).not.toHaveBeenCalled();

    // A refusal is still not a fix.
    stubGeolocation("denied");
    await user.click(screen.getByRole("button", { name: /share location/i }));
    await waitFor(() => expect(bodyText()).toContain(DENIED_MESSAGE));
    expect(
      (screen.getByRole("button", { name: /i have arrived at drop-off/i }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    expect(arriveAtDropoff).not.toHaveBeenCalled();

    // Granted: now, and only now, the command runs — with real coordinates.
    stubGeolocation("granted");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(bodyText()).toContain("Location captured."));
    const enabled = screen.getByRole("button", { name: /i have arrived at drop-off/i });
    await waitFor(() => expect((enabled as HTMLButtonElement).disabled).toBe(false));
    await user.click(enabled);

    await waitFor(() => expect(arriveAtDropoff).toHaveBeenCalledTimes(1));
    const [, version, fix] = arriveAtDropoff.mock.calls[0];
    expect(version).toBe(4);
    expect(fix.latitude).toBe(USABLE_FIX.latitude);
    expect(fix.longitude).toBe(USABLE_FIX.longitude);
    // The named failure mode: `Number(null)` is 0, and 0/0 is a real point the
    // database's null check would happily accept.
    expect(fix.latitude).not.toBe(0);
    expect(fix.longitude).not.toBe(0);
  });

  it("blocks the pickup completion and both of its photos", async () => {
    const user = userEvent.setup();
    render(
      <PickupFlow
        assigned={assignedView({ fulfillmentState: "at_pickup" })}
        location={locationState()}
        onCompleted={vi.fn()}
      />
    );

    const complete = screen.getByRole("button", { name: /^complete pickup$/i });
    expect((complete as HTMLButtonElement).disabled).toBe(true);
    await user.click(complete);
    expect(completePickup).not.toHaveBeenCalled();

    for (const label of [/photo of the shipment/i, /photo of its condition/i]) {
      expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true);
    }
    expect(requestProofUpload).not.toHaveBeenCalled();
  });

  /**
   * The other half of "never send a guess". A version the server did not
   * supply is not a version, and a fallback of 1 would let a driver overwrite a
   * delivery somebody else had already moved — the exact thing the
   * compare-and-set exists to prevent.
   */
  it("blocks every command when the server supplied no version", async () => {
    const user = userEvent.setup();
    fetchMyAssignment.mockResolvedValue(
      ok({
        status: "active",
        assigned: assignedView({ fulfillmentState: "assigned", version: null }),
      } as DriverAssignmentResponse)
    );

    render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);
    const start = await screen.findByRole("button", { name: /start route to pickup/i });

    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(bodyText()).toContain("Couranr could not confirm this delivery's current version.");
    await user.click(start);
    expect(startRouteToPickup).not.toHaveBeenCalled();
  });

  /** Positive control: the same screen with a version DOES run the command. */
  it("runs that command once the server supplies a version", async () => {
    const user = userEvent.setup();
    fetchMyAssignment.mockResolvedValue(
      ok({
        status: "active",
        assigned: assignedView({ fulfillmentState: "assigned" }),
      } as DriverAssignmentResponse)
    );
    startRouteToPickup.mockResolvedValue(
      ok({
        delivery: { deliveryId: "del-fixture-1", fulfillmentState: "en_route_to_pickup", version: 5 },
      })
    );

    render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);
    const start = await screen.findByRole("button", { name: /start route to pickup/i });

    expect((start as HTMLButtonElement).disabled).toBe(false);
    await user.click(start);
    await waitFor(() => expect(startRouteToPickup).toHaveBeenCalledTimes(1));
    expect(startRouteToPickup.mock.calls[0]).toEqual(["del-fixture-1", 4]);
  });
});

/* =========================================================================
 * 8 — an ABSENT package count does not become 0, and 0 stays representable
 * ====================================================================== */

describe("an empty package count is absent, not zero", () => {
  it("parses absence and zero as different answers", () => {
    expect(parsePackageCount("")).toBeNull();
    expect(parsePackageCount("   ")).toBeNull();
    expect(parsePackageCount("abc")).toBeNull();
    expect(parsePackageCount("-1")).toBeNull();
    expect(parsePackageCount("2.5")).toBeNull();
    // The coercion this replaces, spelled out so the difference IS the test.
    expect(Number("")).toBe(0);

    expect(parsePackageCount("0")).toBe(0);
    expect(parsePackageCount("3")).toBe(3);
    expect(parsePackageCount(" 12 ")).toBe(12);
  });

  it("blocks the pickup on an empty field and unblocks on an explicit 0", async () => {
    const user = userEvent.setup();
    render(
      <PickupFlow
        assigned={assignedView({ fulfillmentState: "at_pickup" })}
        location={usableLocation()}
        onCompleted={vi.fn()}
      />
    );

    const blocker = "Enter how many packages you are collecting.";
    expect(screen.getByText(blocker)).toBeTruthy();

    const field = screen.getByLabelText(/packages you are collecting/i) as HTMLInputElement;
    await user.type(field, "0");
    // Zero is a real observation — a discrepancy the merchant needs to see,
    // not a validation error.
    await waitFor(() => expect(screen.queryByText(blocker)).toBeNull());
    expect(field.value).toBe("0");

    await user.clear(field);
    await waitFor(() => expect(screen.getByText(blocker)).toBeTruthy());
    expect(completePickup).not.toHaveBeenCalled();
  });

  it("renders an absent declared count as 'Not recorded' and a declared 0 as 0", async () => {
    fetchMyAssignment.mockResolvedValue(
      ok({
        status: "active",
        assigned: assignedView({
          shipment: {
            description: null,
            packageCount: null,
            orderReference: null,
            handlingNotes: null,
            declaredWeightLb: null,
            additionalStops: null,
          },
        }),
      } as DriverAssignmentResponse)
    );
    const absent = render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);
    await screen.findByText("Your delivery");
    expect(screen.getByText("Packages").parentElement?.textContent).toBe("PackagesNot recorded");
    absent.unmount();

    fetchMyAssignment.mockResolvedValue(
      ok({
        status: "active",
        assigned: assignedView({
          shipment: {
            description: "Historical pickup",
            packageCount: 0,
            orderReference: null,
            handlingNotes: null,
            declaredWeightLb: 0,
            additionalStops: 0,
          },
        }),
      } as DriverAssignmentResponse)
    );
    render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);
    await screen.findByText("Your delivery");
    expect(screen.getByText("Packages").parentElement?.textContent).toBe("Packages0");
  });
});

/* =========================================================================
 * 9 — the shown-once PIN is not written to localStorage or sessionStorage
 * ====================================================================== */

const ISSUED_CODE = "472915";

/** Every place a browser could keep a credential past this render. */
function storageLeaks(secret: string): string[] {
  const found: string[] = [];
  for (const [name, store] of [
    ["localStorage", window.localStorage],
    ["sessionStorage", window.sessionStorage],
  ] as const) {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i) ?? "";
      const value = store.getItem(key) ?? "";
      if (key.includes(secret) || value.includes(secret)) found.push(`${name}:${key}`);
    }
  }
  if (window.location.href.includes(secret)) found.push("url");
  if (document.cookie.includes(secret)) found.push("cookie");
  return found;
}

describe("a handoff code is shown once and kept nowhere", () => {
  async function issue() {
    issueMerchantPickupCode.mockResolvedValue(
      ok({
        handoffCode: {
          code: ISSUED_CODE,
          kind: "merchant_pickup",
          generation: 3,
          expiresAt: "2026-08-03T18:00:00.000Z",
          warning: "Couranr cannot show this code again.",
        },
      })
    );
    const user = userEvent.setup();
    render(
      <HandoffCodePanel deliveryId="del-fixture-1" kind="merchant_pickup" surface="merchant" />
    );
    await user.click(screen.getByRole("button", { name: /issue pickup code/i }));
    // Proof the code really was issued and displayed. Asserting "no storage
    // holds it" against a panel that never produced one proves nothing.
    await screen.findByText(ISSUED_CODE);
    return user;
  }

  it("puts the code on screen and in no persistent store", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    await issue();

    expect(bodyText()).toContain(ISSUED_CODE);
    expect(storageLeaks(ISSUED_CODE)).toEqual([]);
    for (const call of setItem.mock.calls) {
      expect(String(call[0] ?? "")).not.toContain(ISSUED_CODE);
      expect(String(call[1] ?? "")).not.toContain(ISSUED_CODE);
    }
    setItem.mockRestore();
  });

  /** Positive control: the storage checker must be able to fire. */
  it("the storage checker detects a code that IS written", async () => {
    await issue();
    expect(storageLeaks(ISSUED_CODE)).toEqual([]);

    window.sessionStorage.setItem("couranr.pickupCode", ISSUED_CODE);
    expect(storageLeaks(ISSUED_CODE)).toContain("sessionStorage:couranr.pickupCode");
    window.sessionStorage.clear();

    window.localStorage.setItem(`code-${ISSUED_CODE}`, "x");
    expect(storageLeaks(ISSUED_CODE)).toContain(`localStorage:code-${ISSUED_CODE}`);
    window.localStorage.clear();

    expect(storageLeaks(ISSUED_CODE)).toEqual([]);
  });

  it("shows no generation, attempt count, digest or lock metadata", async () => {
    await issue();
    for (const forbidden of [
      /generation/i,
      /attempt/i,
      /digest/i,
      /hmac/i,
      /\bhash\b/i,
      /locked/i,
    ]) {
      expect(bodyText(), `leaked ${forbidden.source}`).not.toMatch(forbidden);
    }
  });

  it("drops the code from the page when the holder says they have it", async () => {
    const user = await issue();
    await user.click(screen.getByRole("button", { name: /i have written it down/i }));
    await waitFor(() => expect(bodyText()).not.toContain(ISSUED_CODE));
    expect(storageLeaks(ISSUED_CODE)).toEqual([]);
  });
});

/* =========================================================================
 * 10 — merchant proof metadata renders no media action, no url, no path
 * ====================================================================== */

/** Anything that would reach the bytes, or reveal where they live. */
function mediaAffordances(root: HTMLElement): string[] {
  const found: string[] = [];
  root
    .querySelectorAll("a[href], img, video, iframe, [src], [data-url], [data-path]")
    .forEach((el) => found.push(`element:${el.tagName.toLowerCase()}`));
  for (const button of Array.from(root.querySelectorAll("button"))) {
    if (/view|open|download|see the photo|show photo/i.test(button.textContent ?? "")) {
      found.push(`button:${(button.textContent ?? "").trim()}`);
    }
  }
  // The MARKUP, not just the text: an object path hidden in an attribute, a
  // title or a data-* is still a disclosure of where a private object lives.
  const markup = root.innerHTML ?? "";
  for (const pattern of [
    /https?:\/\//i,
    /storage\/v1\/object/i,
    /\.(jpe?g|png|webp|heic)\b/i,
    /\btoken=/i,
    /couranr-proof/i,
  ]) {
    if (pattern.test(markup)) found.push(`markup:${pattern.source}`);
  }
  return found;
}

const MERCHANT_PROOF: ProofMetadataView[] = [
  {
    proofId: "prf-1",
    proofStage: "pickup",
    proofType: "shipment_photo",
    finalizedAt: "2026-08-03T14:12:00.000Z",
    hasMedia: true,
  },
  {
    proofId: "prf-2",
    proofStage: "dropoff",
    proofType: "recipient_pin",
    finalizedAt: "2026-08-03T17:05:00.000Z",
    hasMedia: false,
  },
];

/**
 * A failed read and an empty one are told apart by the EMPTY STATE'S OWN
 * TITLE, never by the phrase "no proof". The error copy deliberately ends
 * "This does not mean no proof was captured", so a substring match on that
 * reassurance reports the component broken at the moment it is doing the right
 * thing.
 */
const EMPTY_PROOF_TITLE = /no proof recorded yet/i;

describe("MER-007: the sender sees that proof exists, never the proof itself", () => {
  it("renders metadata with no way to reach the media", async () => {
    fetchMerchantProof.mockResolvedValue(ok({ proof: MERCHANT_PROOF }));
    const { container } = render(<MerchantProofPanel deliveryId="del-fixture-1" />);

    await screen.findByText("Photo of the shipment");
    expect(screen.getByText("Image attached")).toBeTruthy();
    expect(screen.getByText("Recipient PIN handoff")).toBeTruthy();

    expect(mediaAffordances(container)).toEqual([]);
    // And no sibling read that would return one.
    expect(fetchOperationsProofUrl).not.toHaveBeenCalled();
  });

  /** Positive control: the affordance checker must be able to fire. */
  it("the media checker detects a leak when there is one", () => {
    const { container } = render(
      <div>
        <a href="https://example.supabase.co/storage/v1/object/sign/couranr-proof/a.jpg?token=x">
          Open photo
        </a>
        <button type="button">Download photo</button>
        {/* A raw <img> on purpose: next/image rewrites the src, and the src is
            exactly what this checker has to be able to see. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img alt="proof" src="couranr-proof/deliveries/del-1/pickup.jpg" />
      </div>
    );
    const found = mediaAffordances(container);
    expect(found).toContain("element:a");
    expect(found).toContain("element:img");
    expect(found.some((f) => f.startsWith("button:"))).toBe(true);
    expect(found.some((f) => f.includes("storage"))).toBe(true);
    expect(found.some((f) => f.includes("token"))).toBe(true);
  });

  it("a successful read of nothing renders the empty state (control)", async () => {
    fetchMerchantProof.mockResolvedValue(ok({ proof: [] }));
    render(<MerchantProofPanel deliveryId="del-fixture-1" />);

    await waitFor(() => expect(bodyText()).toMatch(EMPTY_PROOF_TITLE));
    // States the read succeeded, so "nothing here" cannot be read as "unknown".
    expect(bodyText()).toMatch(/read this successfully/i);
    expect(screen.queryByRole("button", { name: /try again/i })).toBeNull();
  });

  it("a failed proof read is an error with a retry, not the empty state", async () => {
    fetchMerchantProof.mockResolvedValue(fail(503, { correlationId: "cr_zzz" }));
    render(<MerchantProofPanel deliveryId="del-fixture-1" />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/does not mean no proof was captured/i)).toBeTruthy();
    expect(bodyText(), "a failed read rendered as the empty state").not.toMatch(EMPTY_PROOF_TITLE);
    // The merchant can tell "ask again" from "call the driver" only if the
    // first one is offered.
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
  });
});

/* =========================================================================
 * 11 — the completion receipt renders none of: address, recipient contact,
 *      payment, object path, signed url
 * ====================================================================== */

const PROJECTION_SENTINELS = [
  PICKUP_LINE1,
  DROPOFF_LINE1,
  RECIPIENT_NAME,
  RECIPIENT_PHONE,
  MERCHANT_PHONE,
];

const DISCLOSURE_PATTERNS: Array<{ name: string; re: RegExp; sample: string }> = [
  {
    name: "signed url",
    re: /https?:\/\//i,
    sample: "https://example.supabase.co/storage/v1/object/sign/a?token=b",
  },
  {
    name: "object path",
    re: /(storage\/v1\/object|couranr-proof)/i,
    sample: "couranr-proof/deliveries/del-1/pickup.jpg",
  },
  { name: "money", re: /(\$\s?\d|\bcents\b|total_cents|amount due)/i, sample: "Total $22.99" },
  { name: "media file", re: /\.(jpe?g|png|webp|heic)\b/i, sample: "shipment.jpg" },
  { name: "telephone link", re: /tel:/i, sample: '<a href="tel:+15550001111">' },
];

function disclosures(markup: string): string[] {
  const found = PROJECTION_SENTINELS.filter((s) => markup.includes(s));
  for (const p of DISCLOSURE_PATTERNS) if (p.re.test(markup)) found.push(p.name);
  return found;
}

describe("what survives completion, and what does not", () => {
  it("each disclosure pattern matches its own sample", () => {
    for (const p of DISCLOSURE_PATTERNS) {
      expect(p.re.test(p.sample), `${p.name} does not match its own sample`).toBe(true);
    }
  });

  /**
   * The positive control, and it runs before the receipts. The ACTIVE screen
   * legitimately shows the address, the recipient and a `tel:` link — so if the
   * checker cannot see them here, its silence on a receipt means nothing.
   */
  it("the disclosure checker sees the details on the ACTIVE screen", async () => {
    fetchMyAssignment.mockResolvedValue(
      ok({ status: "active", assigned: assignedView() } as DriverAssignmentResponse)
    );
    render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);
    await screen.findByText("Your delivery");

    const found = disclosures(document.body.innerHTML);
    for (const sentinel of PROJECTION_SENTINELS) {
      expect(found, `checker missed ${sentinel}`).toContain(sentinel);
    }
    expect(found).toContain("telephone link");
  });

  it("DRV-002's receipt discloses none of them", async () => {
    fetchMyAssignment.mockResolvedValue(
      ok({
        status: "recently_completed",
        receipt: completionReceipt(),
      } as DriverAssignmentResponse)
    );
    render(<AssignedDeliveryDetail deliveryId="del-fixture-1" />);
    await screen.findByText("Delivery completed");

    expect(disclosures(document.body.innerHTML)).toEqual([]);
    expect(screen.getByText("Recipient PIN handoff")).toBeTruthy();
  });

  it("DRV-001's receipt discloses none of them", async () => {
    fetchMyAssignment.mockResolvedValue(
      ok({
        status: "recently_completed",
        receipt: completionReceipt(),
      } as DriverAssignmentResponse)
    );
    render(<DriverAssignmentCard />);
    await screen.findByTestId("drv001-assignment");

    expect(disclosures(document.body.innerHTML)).toEqual([]);
  });

  it("the receipt shown the instant a delivery completes discloses none of them", async () => {
    const user = userEvent.setup();
    verifyRecipientCode.mockResolvedValue(ok({ outcome: "accepted" }));
    completeDirectHandoff.mockResolvedValue(
      ok({
        delivery: { deliveryId: "del-fixture-1", fulfillmentState: "delivered", version: 5 },
        receipt: completionReceipt(),
      })
    );
    renderDropoff("photo_or_pin", usableLocation());

    await user.type(screen.getByLabelText(/six-digit recipient code/i), "472915");
    await user.click(screen.getByRole("button", { name: /check code/i }));
    await screen.findByText("Code accepted");
    await user.type(screen.getByLabelText(/first name of the person taking/i), "Dana");
    await user.click(screen.getByRole("button", { name: /complete handoff/i }));

    await screen.findByText("Delivery completed");
    expect(disclosures(document.body.innerHTML)).toEqual([]);
    // The code field was on this very screen a moment ago.
    expect(screen.queryByLabelText(/six-digit recipient code/i)).toBeNull();
    expect(fetchOperationsProofUrl).not.toHaveBeenCalled();
  });
});

/* =========================================================================
 * 12 — no rendered form requests a face or identity-document photo
 * ====================================================================== */

const IDENTITY_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "selfie", re: /selfie/i },
  { name: "face photo", re: /(face\s*photo|photo\s+of\s+(your|their|the recipient'?s)\s*face)/i },
  { name: "driver licence", re: /driver'?s?\s*licen[cs]e|driving\s*licen[cs]e/i },
  { name: "id document", re: /\bid\s*(document|card|photo|check)\b|identity\s*document/i },
  { name: "passport", re: /passport/i },
  { name: "government id", re: /government[-\s]issued/i },
  { name: "proof of identity", re: /proof\s+of\s+identity/i },
];

const identityRequests = (text: string): string[] =>
  IDENTITY_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.name);

describe("no driver form asks for a face or an identity document", () => {
  /** Positive control: the identity checker must be able to fire. */
  it("flags a form that DOES ask", () => {
    const found = identityRequests(
      [
        "Take a selfie holding the package.",
        "Upload a photo of the recipient's driver's licence.",
        "Government-issued ID check required.",
        "Attach your passport as proof of identity.",
      ].join(" ")
    );
    expect(found).toContain("selfie");
    expect(found).toContain("driver licence");
    expect(found).toContain("government id");
    expect(found).toContain("passport");
    expect(found).toContain("proof of identity");
  });

  it("the pickup form, at its largest, asks for none of them", () => {
    render(
      <PickupFlow
        assigned={assignedView({
          fulfillmentState: "at_pickup",
          // The large-shipment branch adds a fourth photo and three more
          // fields; render the maximal form so nothing escapes the check.
          shipment: {
            description: "Twelve boxed fixtures",
            packageCount: 12,
            orderReference: "LOAD-12",
            handlingNotes: "Keep upright",
            declaredWeightLb: 400,
            additionalStops: 0,
          },
          vehicleRequirement: { vehicleClass: "box_truck", maxPayloadLb: 2000 },
        })}
        location={usableLocation()}
        onCompleted={vi.fn()}
      />
    );
    expect(screen.getByText(/large or unusual shipment/i)).toBeTruthy();
    expect(identityRequests(bodyText())).toEqual([]);
  });

  it("the discrepancy form asks for none of them", () => {
    render(<PickupDiscrepancy deliveryId="del-fixture-1" open onReported={vi.fn()} />);
    expect(screen.getByText("Report a problem with this pickup")).toBeTruthy();
    expect(identityRequests(bodyText())).toEqual([]);
  });

  it.each(METHODS)("the %s drop-off form asks for none of them", (method) => {
    renderDropoff(method);
    expect(identityRequests(bodyText())).toEqual([]);
    // Only a FIRST name is ever collected, on every path that names a person.
    expect(bodyText()).not.toMatch(/last name|surname|full legal name|date of birth/i);
  });

  it("collects a first name and says that is all it records", () => {
    renderDropoff("signature");
    expect(screen.getByLabelText(/signer's first name/i)).toBeTruthy();
    expect(screen.getAllByText(/First name is enough/i).length).toBeGreaterThan(0);
  });
});

/* =========================================================================
 * 13 — no component imports a server-only module
 * ====================================================================== */

const ROOT = path.resolve(__dirname, "..");
const EXTS = [".ts", ".tsx"];

/**
 * The five modules that must never be reachable from a bundle: the service-role
 * client and every driver transition, the HMAC secret and its accessor, the
 * signed-URL minting, and the path builder that carries the bucket name.
 */
const SERVER_ONLY = [
  "lib/couranr/driver/commands",
  "lib/couranr/driver/proof",
  "lib/couranr/driver/codes",
  "lib/couranr/driver/handoffSecret",
  "lib/couranr/driver/proofPaths",
];

const SPEC_RE = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;

const specifiersOf = (source: string): string[] =>
  Array.from(source.matchAll(SPEC_RE), (m) => m[1]);

/** Repo-relative and extensionless, or null for a package specifier. */
function resolveSpec(fromFile: string, spec: string): string | null {
  let abs: string;
  if (spec.startsWith("@/")) abs = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) abs = path.resolve(path.dirname(fromFile), spec);
  else return null;
  return path
    .relative(ROOT, abs)
    .split(path.sep)
    .join("/")
    .replace(/\.(tsx?|jsx?)$/, "");
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.includes(path.extname(full))) out.push(full);
  }
  return out;
}

describe("server-only driver modules are unreachable from any component", () => {
  const componentFiles = walk(path.join(ROOT, "components"));

  it("scanned a meaningful set of components", () => {
    // A scan over an empty list would pass in silence.
    expect(componentFiles.length).toBeGreaterThan(20);
    expect(componentFiles.some((f) => f.endsWith(path.join("dispatch", "DropoffProof.tsx")))).toBe(
      true
    );
  });

  it("every server-only module exists to be policed", () => {
    for (const mod of SERVER_ONLY) {
      expect(existsSync(path.join(ROOT, `${mod}.ts`)), `${mod} not found`).toBe(true);
    }
  });

  /** Positive control: the resolver must recognise every import spelling. */
  it("the import scanner recognises a server-only import", () => {
    const sample = [
      'import { completePickup } from "@/lib/couranr/driver/commands";',
      'import { proofObjectPath } from "../../../lib/couranr/driver/proofPaths";',
      'const x = await import("@/lib/couranr/driver/codes");',
      'import { Card } from "@/components/couranr/primitives";',
    ].join("\n");
    const from = path.join(ROOT, "components", "couranr", "dispatch", "Fake.tsx");
    const resolved = specifiersOf(sample)
      .map((s) => resolveSpec(from, s))
      .filter((s): s is string => s !== null);

    expect(resolved).toContain("lib/couranr/driver/commands");
    expect(resolved).toContain("lib/couranr/driver/proofPaths");
    expect(resolved).toContain("lib/couranr/driver/codes");
    expect(resolved.filter((r) => SERVER_ONLY.includes(r))).toHaveLength(3);
    // And an ordinary import is not flagged.
    expect(resolved).toContain("components/couranr/primitives");
    expect(SERVER_ONLY).not.toContain("components/couranr/primitives");
  });

  it("no component imports one", () => {
    const offenders: string[] = [];
    for (const file of componentFiles) {
      for (const spec of specifiersOf(readFileSync(file, "utf8"))) {
        const resolved = resolveSpec(file, spec);
        if (resolved && SERVER_ONLY.includes(resolved)) {
          offenders.push(`${path.relative(ROOT, file)} -> ${resolved}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the driver components reach the server through the browser client instead", () => {
    const dropoff = readFileSync(
      path.join(ROOT, "components/couranr/dispatch/DropoffProof.tsx"),
      "utf8"
    );
    // Proof the assertion above is not passing because these files import
    // nothing at all.
    expect(specifiersOf(dropoff)).toContain("./client");
    expect(dropoff.startsWith('"use client"')).toBe(true);
  });

  it("every dispatch component that uses hooks or forms declares use client", () => {
    const dir = path.join(ROOT, "components/couranr/dispatch");
    for (const name of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, name), "utf8");
      const needsClient =
        /use(State|Effect|Callback|Memo|Ref)\(/.test(src) ||
        /from "@\/components\/couranr\/forms"/.test(src);
      if (!needsClient) continue;
      expect(src.startsWith('"use client"'), `${name} is missing "use client"`).toBe(true);
    }
  });
});

/* =========================================================================
 * Integration: the panels are mounted where the registry says they are
 * ====================================================================== */

describe("the driver-execution panels are actually mounted", () => {
  const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

  it("MER-007 and the stage-aware OPS-003 workbench render every panel they import", () => {
    const detail = read("components/couranr/requests/DeliveryRequestDetail.tsx");
    const workbench = read("components/couranr/operations/OperationsDeliveryWorkbench.tsx");

    for (const panel of ["DeliveryExecutionTimeline", "HandoffCodePanel", "MerchantProofPanel"]) {
      expect(detail, `${panel} is imported but never rendered`).toContain(`<${panel}`);
    }
    for (const panel of [
      "ReviewOutcomeActions",
      "OperationsPlanPanel",
      "OperationsPaymentRecoveryPanel",
      "OperationsAssignmentPanel",
      "OperationsExecutionPanel",
    ]) {
      expect(workbench, `${panel} is imported but never rendered`).toContain(`<${panel}`);
    }
    expect(detail).toContain("<OperationsDeliveryWorkbench");
    expect(workbench).toContain('work.phase === "execute"');
    expect(workbench).toContain("<OperationsExecutionPanel");
  });

  it("assigning a driver tells the workbench parent, so execution is not left stale", () => {
    const workbench = read("components/couranr/operations/OperationsDeliveryWorkbench.tsx");
    expect(workbench).toMatch(/<OperationsAssignmentPanel[\s\S]{0,400}?onChanged=/);
    expect(read("components/couranr/dispatch/OperationsAssignmentPanel.tsx")).toContain(
      "onChanged?.()"
    );
  });

  it("DRV-005 is reachable as ?mode=driving on the delivery route", () => {
    const page = read("app/(couranr)/driver/deliveries/[id]/page.tsx");
    expect(page).toContain('searchParams?.mode === "driving"');
    expect(page).toContain("drivingMode={drivingMode}");
    expect(read("components/couranr/dispatch/AssignedDeliveryDetail.tsx")).toContain("<DrivingMode");
  });

  it("the driver dashboard reaches the canonical assignment card through DriverHome", () => {
    const page = read("app/(couranr)/driver/page.tsx");
    const home = read("components/couranr/driver/DriverHome.tsx");
    expect(page).toContain("<DriverHome");
    expect(home).toContain("<DriverAssignmentCard />");
    // The legacy list is gone rather than sitting below canonical current work.
    expect(page).not.toContain("No active delivery assigned right now.");
    expect(page).not.toContain("fetchMyDeliveries");
  });
});

/* ================================================ the concurrency token === */

/**
 * `readDeliveryVersion` in isolation. The screen-level behaviour is covered
 * above; this pins the READER, because the tempting "fix" for a blocked button
 * is to make it return 1 instead of null. That passes every test — a fixture
 * delivery really is at version 1 — and in production sends a version nobody
 * observed, so the compare-and-set that exists to stop a lost update matches by
 * accident and the driver overwrites whatever Operations just changed.
 */
describe("the delivery version is read, never invented", () => {
  it("refuses to guess when the projection carries no usable version", () => {
    for (const bad of [undefined, null, 0, -1, 2.5, "4", Number.NaN]) {
      expect(
        readDeliveryVersion({ version: bad } as never),
        `readDeliveryVersion must not invent a version for ${String(bad)}`
      ).toBeNull();
    }
  });

  it("returns the real version when there is one", () => {
    expect(readDeliveryVersion(assignedView({ version: 4 }))).toBe(4);
    expect(readDeliveryVersion(assignedView({ version: 1 }))).toBe(1);
  });
});

/* ============================================ the proof-upload contract === */

/**
 * The upload ticket is NESTED under `upload`, and reading it flat is invisible
 * to every other kind of test.
 *
 * `requestProofUpload` was typed flat while the route returned
 * `{ upload: … }`, so `ticket.value.signedUrl` was `undefined` at runtime.
 * `fetch(undefined)` resolves against the PAGE url, Next answered with an HTML
 * page and a 200, `put.ok` was therefore true, and the hook went on to
 * "finalize" an object that had never been stored. Proof upload had never once
 * worked — through a green typecheck, a green 1001-test suite, and a component
 * suite whose only assertions about this function were that it had NOT been
 * called.
 *
 * So this drives the SUCCESS path and asserts on the request that leaves the
 * browser: the PUT must go to the signed URL the server issued, carrying the
 * bytes, and finalize must receive the server's real upload id.
 */
describe("the proof upload sends the server's own ticket", () => {
  const SIGNED = "https://example.supabase.co/storage/v1/object/upload/sign/delivery-photos/canonical-proof/v1/d/p/abc.png?token=t";
  const UPLOAD_ID = "aaaaaaaa-1111-4111-8111-111111111111";

  function grantTicket() {
    requestProofUpload.mockResolvedValue(
      // The REAL wire shape. A flat fixture here would re-hide the defect.
      ok({
        upload: {
          uploadId: UPLOAD_ID,
          signedUrl: SIGNED,
          token: "t",
          expectedBytes: 3,
          expectedMime: "image/png",
          expiresInSeconds: 900,
        },
      })
    );
    finalizeProofUpload.mockResolvedValue(
      ok({
        proof: {
          proofId: "bbbbbbbb-2222-4222-8222-222222222222",
          proofStage: "pickup",
          proofType: "shipment_photo",
          finalizedAt: "2026-08-03T17:06:14.972131+00:00",
          byteSize: 3,
        },
      })
    );
  }

  async function runUpload() {
    const calls: Array<{ url: unknown; method?: string; bodyLen?: number }> = [];
    const realFetch = global.fetch;
    global.fetch = vi.fn(async (url: any, init: any) => {
      calls.push({
        url,
        method: init?.method,
        bodyLen: init?.body?.byteLength ?? init?.body?.length,
      });
      return { ok: true, status: 200 } as Response;
    }) as never;

    const { useProofUpload } = await import("@/components/couranr/dispatch/useProofUpload");
    const location = {
      status: "ready", fix: { latitude: 38.42, longitude: -77.41, accuracyM: 8 },
      message: "Location captured.", usable: true, request: vi.fn(),
    } as LocationState;

    let hook: any;
    function Probe() {
      hook = useProofUpload({
        deliveryId: "del-fixture-1", stage: "pickup", proofType: "shipment_photo", location,
      });
      return <span>{hook.status}</span>;
    }
    render(<Probe />);

    const file = new File([new Uint8Array([1, 2, 3])], "s.png", { type: "image/png" });
    await hook.upload(file);
    global.fetch = realFetch;
    return calls;
  }

  it("PUTs the bytes to the signed URL the server issued, not to undefined", async () => {
    grantTicket();
    const calls = await runUpload();

    const put = calls.find((c) => c.method === "PUT");
    expect(put, "no PUT was issued at all").toBeTruthy();
    // The precise regression: `undefined` here became a same-origin request
    // that Next answered 200, so the upload silently stored nothing.
    expect(put!.url, "the PUT went somewhere other than the signed URL").toBe(SIGNED);
    expect(String(put!.url)).not.toMatch(/undefined/);
    expect(put!.bodyLen, "the PUT carried no bytes").toBe(3);
  });

  it("finalizes with the server's upload id, never the string \"undefined\"", async () => {
    grantTicket();
    await runUpload();

    expect(finalizeProofUpload).toHaveBeenCalledTimes(1);
    const [body] = finalizeProofUpload.mock.calls[0];
    expect(body.uploadId).toBe(UPLOAD_ID);
    expect(String(body.uploadId)).not.toBe("undefined");
    // The location travels as evidence, and is never defaulted to 0/0.
    expect(body.latitude).toBe(38.42);
    expect(body.longitude).toBe(-77.41);
  });

  it("refuses to PUT anywhere when the ticket has no signed URL", async () => {
    // A malformed grant must fail closed rather than fetch(undefined).
    requestProofUpload.mockResolvedValue(ok({ upload: { uploadId: UPLOAD_ID } }));
    const calls = await runUpload();
    expect(calls.some((c) => c.method === "PUT"), "PUT issued without a signed URL").toBe(false);
    expect(finalizeProofUpload).not.toHaveBeenCalled();
  });

  it("the route really does nest the ticket under `upload`", () => {
    // Source-level, because the runtime shape above is a fixture and a fixture
    // can drift from the server exactly as this one did.
    const route = readFileSync(
      path.join(process.cwd(), "app/api/couranr/driver/deliveries/[id]/proof-upload/route.ts"),
      "utf8"
    );
    expect(route).toMatch(/NextResponse\.json\(\{\s*upload:/);
    const client = readFileSync(
      path.join(process.cwd(), "components/couranr/dispatch/client.ts"),
      "utf8"
    );
    expect(client).toMatch(/call<\{\s*upload:\s*ProofUploadTicketView\s*\}>/);
  });
});

/* ================================== proof already recorded on the server === */

/**
 * A reload must not re-demand work Couranr already holds.
 *
 * The pickup requirements used to live only in this component's state, so a
 * driver who photographed the shipment and then lost the tab at a loading dock
 * was told to record it again — while the server held the proof and would have
 * accepted the completion. Their only way out was to re-do the work.
 *
 * The failure direction matters too: a FAILED read must leave the requirement
 * unmet. Telling a driver a photo is recorded when Couranr cannot confirm it is
 * the worse of the two errors.
 */
describe("the pickup form reflects proof the server already holds", () => {
  const assignedAtPickup = () =>
    assignedView({ fulfillmentState: "at_pickup", proof: { method: "photo_or_pin", signatureRequired: false } });

  const readyLocation = {
    status: "ready", fix: { latitude: 38.42, longitude: -77.41, accuracyM: 8 },
    message: "Location captured.", usable: true, request: vi.fn(),
  } as LocationState;

  async function renderPickup() {
    return render(
      <PickupFlow assigned={assignedAtPickup() as never} location={readyLocation} onCompleted={() => {}} />
    );
  }

  it("stops asking for a photo the server already recorded", async () => {
    fetchMyProof.mockResolvedValue(
      ok({
        proof: [
          { proofId: "p-1", proofStage: "pickup", proofType: "shipment_photo",
            finalizedAt: "2026-08-03T17:00:00Z", hasMedia: true },
          { proofId: "p-2", proofStage: "pickup", proofType: "condition_photo",
            finalizedAt: "2026-08-03T17:01:00Z", hasMedia: true },
        ],
      })
    );
    const { container } = await renderPickup();
    await waitFor(() =>
      expect(container.textContent ?? "").not.toMatch(/record a photo of the shipment/i)
    );
    expect(container.textContent ?? "").not.toMatch(/record a photo of the shipment's condition/i);
  });

  it("POSITIVE CONTROL: with nothing recorded it still asks for both", async () => {
    fetchMyProof.mockResolvedValue(ok({ proof: [] }));
    const { container } = await renderPickup();
    await waitFor(() => expect(container.textContent ?? "").toMatch(/record a photo of the shipment/i));
    expect(container.textContent ?? "").toMatch(/record a photo of the shipment's condition/i);
  });

  it("a FAILED read leaves the requirement unmet rather than claiming proof exists", async () => {
    fetchMyProof.mockResolvedValue(fail(500));
    const { container } = await renderPickup();
    await waitFor(() => expect(container.textContent ?? "").toMatch(/record a photo of the shipment/i));
  });

  it("ignores proof from another stage", async () => {
    // A drop-off photo is not a pickup photo, and must not satisfy this form.
    fetchMyProof.mockResolvedValue(
      ok({
        proof: [
          { proofId: "p-9", proofStage: "dropoff", proofType: "delivery_photo",
            finalizedAt: "2026-08-03T18:00:00Z", hasMedia: true },
        ],
      })
    );
    const { container } = await renderPickup();
    await waitFor(() => expect(container.textContent ?? "").toMatch(/record a photo of the shipment/i));
  });

  it("the driver proof route is scoped to the caller's own ACTIVE assignment", () => {
    const route = readFileSync(
      path.join(process.cwd(), "app/api/couranr/driver/deliveries/[id]/proof/route.ts"),
      "utf8"
    );
    expect(route).toContain('.eq("assignment_state", "active")');
    expect(route).toContain('.eq("driver_id", driver.id)');
    // Metadata only: no path, no bucket, no signed URL on this route.
    expect(route).not.toMatch(/signedProofUrl|storage_object_path|createSignedUrl/);
  });
});
