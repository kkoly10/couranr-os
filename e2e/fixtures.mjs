/**
 * Canonical synthetic identities for the browser suite.
 *
 * Everything here is FICTIONAL and marked. The connected project holds real
 * data — 42 orders, 29 deliveries, 94 addresses, 28 rentals — so the rule is
 * absolute: create new synthetic rows next to the real ones, never repurpose
 * a real row to set up a test.
 *
 * `E2E_MARKER` is the string every seeded row carries. Cleanup keys off it, so
 * a row without the marker is by construction not ours and is never touched.
 */

export const E2E_MARKER = "couranr-e2e";

/** Fixed so reruns are idempotent rather than piling up new accounts. */
export const PASSWORD = process.env.E2E_PASSWORD ?? "Couranr-E2E-pw-2026!";

/**
 * `example.com` is reserved by RFC 2606 and can never receive mail, which is
 * what we want: a confirmation email must not reach a real inbox.
 */
const at = (local) => `${E2E_MARKER}-${local}@example.com`;

export const USERS = {
  /**
   * Brand-new merchant: NO business account, NO membership, NO workspace.
   * This is the MER-002 subject — the onboarding flow has to create those, so
   * seeding them would test nothing.
   */
  newMerchant: {
    key: "newMerchant",
    // Resolved to a RUN-UNIQUE address by the seed; see `pristine` below.
    email: at("new-merchant"),
    profileRole: "customer",
    confirmed: true,
    seedWorkspace: false,
    /**
     * MER-002 is only testable against a merchant with no workspace, and a
     * successful run creates one. Resetting by deletion is not available:
     * `service_role` deliberately has NO DELETE on
     * couranr_merchant_workspaces (append-only), and the account FK is
     * RESTRICT — so the account cannot be removed either. Rather than weaken
     * that grant, the seed mints a fresh identity per run, which is pristine
     * by construction.
     */
    pristine: true,
  },

  /** Established merchant: business account + active owner membership + workspace. */
  merchant: {
    key: "merchant",
    email: at("merchant"),
    profileRole: "customer",
    confirmed: true,
    seedWorkspace: true,
    businessName: "[E2E] Marker Street Cleaners",
  },

  /** Couranr Operations. `admin` is the only operations value profiles_role_check permits. */
  ops: {
    key: "ops",
    email: at("ops"),
    profileRole: "admin",
    confirmed: true,
    seedWorkspace: false,
  },

  /** Driver surface. */
  driver: {
    key: "driver",
    email: at("driver"),
    profileRole: "driver",
    confirmed: true,
    seedWorkspace: false,
  },

  /**
   * Deliberately unconfirmed, so the "confirm your email" sign-in state is
   * exercised against a real Supabase response rather than a mocked one.
   */
  unconfirmed: {
    key: "unconfirmed",
    email: at("unconfirmed"),
    profileRole: "customer",
    confirmed: false,
    seedWorkspace: false,
  },
};

export const WORKSPACE_SEED = {
  businessCategory: "dry_cleaning_laundry_tailoring",
  contactPhone: "+1-540-555-0142",
  payerDefault: "merchant",
  policiesVersion: "couranr-policies-v1",
  pickupAddress: {
    line1: "412 Marker Street",
    city: "Stafford",
    region: "VA",
    postalCode: "22554",
  },
};

/** Address pair used by the delivery-request flow. Both inside the service area. */
export const SHIPMENT = {
  pickup: { line1: "412 Marker Street", city: "Stafford", region: "VA", postalCode: "22554" },
  dropoff: { line1: "1500 Caroline Street", city: "Fredericksburg", region: "VA", postalCode: "22401" },
  loadedMiles: "6.4",
  weightLb: "9",
  recipientName: "E2E Recipient",
};

export const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
