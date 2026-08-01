/**
 * Canonical synthetic identities for the browser suite.
 *
 * Everything here is FICTIONAL and marked. The connected project holds real
 * data — 42 orders, 29 deliveries, 94 addresses, 28 rentals — so the rule is
 * absolute: create new synthetic rows next to the real ones, never repurpose a
 * real row to set up a test.
 *
 * NO CREDENTIAL LIVES IN THIS FILE. The seed generates a cryptographically
 * random password per run and writes it only to `e2e/.state.json` (mode 0600,
 * gitignored, deleted by cleanup). A committed fallback password is a real
 * credential for real privileged accounts — including an `admin` fixture — and
 * the fact that the accounts are synthetic does not make it safe.
 */

export const E2E_MARKER = "couranr-e2e";

/**
 * Written into `raw_user_meta_data` so cleanup can find EVERY synthetic user,
 * including run-unique addresses that no static list would contain.
 */
export const E2E_META = { e2e: true, marker: E2E_MARKER };

/** `example.com` is reserved by RFC 2606 — it can never receive real mail. */
const at = (local) => `${E2E_MARKER}-${local}@example.com`;

export const USERS = {
  /**
   * Brand-new merchant: NO business account, NO membership, NO workspace.
   * This is the MER-002 subject — the onboarding flow has to create those, so
   * seeding them would test nothing.
   */
  newMerchant: {
    key: "newMerchant",
    email: at("new-merchant"),
    profileRole: "customer",
    confirmed: true,
    seedWorkspace: false,
    /**
     * MER-002 is only testable against a merchant with no workspace, and a
     * successful run creates one. Resetting by deletion is unavailable:
     * `service_role` deliberately has NO DELETE on
     * couranr_merchant_workspaces (append-only) and business_accounts is
     * shielded by a RESTRICT foreign key. Minting a fresh identity per run is
     * cheaper than widening a deliberately narrow grant.
     */
    pristine: true,
  },

  /**
   * Established merchant: business account + active owner membership.
   *
   * Deliberately NO couranr_merchant_workspaces row. Landing resolution reads
   * memberships, not workspaces (Commit K1 removed that lookup), so a workspace
   * bought nothing here — and `service_role` has no DELETE on that table, so
   * seeding one left a row in production that the harness could never remove.
   * Both tables seeded below ARE deletable by the harness.
   */
  merchant: {
    key: "merchant",
    email: at("merchant"),
    profileRole: "customer",
    confirmed: true,
    seedAccount: true,
    businessName: "[E2E] Marker Street Cleaners",
  },

  /**
   * Couranr Operations. `admin` is the only operations value
   * profiles_role_check permits.
   *
   * PRIVILEGED. This account must never survive a run — see the cleanup
   * contract in seed.mjs. It is also why no password may be committed.
   */
  ops: { key: "ops", email: at("ops"), profileRole: "admin", confirmed: true, seedWorkspace: false, privileged: true },

  /** Driver surface. Also removed unconditionally at the end of every run. */
  driver: { key: "driver", email: at("driver"), profileRole: "driver", confirmed: true, seedWorkspace: false, privileged: true },

  /**
   * The second assignable driver for the reassignment path, and RUN-UNIQUE by
   * necessity rather than convenience.
   *
   * Whoever holds the assignment when group P ends is left `on_delivery`, and
   * this slice has no command that ends an assignment except replacing it —
   * driver execution is the next slice. `couranr_assert_driver_mutable` then
   * refuses to activate that driver ever again, so a stable identity in this
   * role poisons every subsequent run. A fresh auth user per run costs one
   * pinned row and keeps the suite re-runnable; the alternative is a DELETE
   * grant on `couranr_drivers`, which is not a trade worth making for a test.
   */
  spareDriver: {
    key: "spareDriver",
    email: at("spare-driver"),
    profileRole: "customer",
    confirmed: true,
    seedWorkspace: false,
    pristine: true,
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
  pickupAddress: { line1: "412 Marker Street", city: "Stafford", region: "VA", postalCode: "22554" },
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
