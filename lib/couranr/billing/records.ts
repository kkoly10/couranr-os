/**
 * MER-016 — merchant billing records.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN MAY SHOW, AND WHAT IT IS FORBIDDEN TO SHOW
 * ---------------------------------------------------------------------------
 *
 * Of MER-016's four registry-required states — no method, default method,
 * payment failed, refund pending/complete — only TWO are reachable from data
 * that exists. The other two are not "unbuilt UI"; they have no source at all,
 * and one of them is blocked by an unresolved decision that names this exact
 * screen. Each is recorded below with its citation, because the difference
 * between "not built yet" and "not decided yet" changes who unblocks it.
 *
 *   Reachable
 *     - NO PAYMENT METHOD. Universally true today: nothing anywhere stores a
 *       payment method. Verified — no `stripe_customer_id`, no SetupIntent
 *       call and no payment-method table exists in migrations or `lib/`.
 *     - PAYMENT FAILED. `couranr_payment_obligations.payment_state = 'failed'`
 *       with `failed_at`, written by the real authorization path.
 *
 *   NOT reachable — and each for a different reason
 *     - DEFAULT PAYMENT METHOD. Saving a method for reuse requires a Stripe
 *       **Customer** object AND a **SetupIntent**, with the customer id
 *       persisted on our own backend ("To set up a payment method for future
 *       payments, you must attach it to an object that represents your
 *       customer" — Stripe, Save a customer's payment method, Setup Intents
 *       API variant). None of those exist here. That is a payments
 *       integration touching a frozen SDK, not a screen.
 *     - REFUND PENDING / COMPLETE. `REF-001` (decided) puts delivery refunds
 *       under Couranr Operations at implementation phase 7 and records the
 *       code state as "not implemented". Correspondingly `refunded` and
 *       `partially_refunded` are declared in the payment vocabulary and
 *       provably have zero transition writers — `UNREACHABLE_PAYMENT_STATES`
 *       in `lib/couranr/payments/states.ts`, asserted by
 *       `tests/couranr-payment-vocabulary.test.ts`.
 *
 *   BLOCKED BY AN UNRESOLVED DECISION — the important one
 *     - A DOWNLOADABLE RECEIPT. `TAX-001` is `unresolved` and lists `MER-016`
 *       in its own `blocked_screen_ids`. Its `missing` field is explicit: "No
 *       authority states whether delivery is taxable in the launch markets,
 *       who remits, or **how tax appears on a receipt**." A receipt is a tax
 *       document. Issuing one either states a tax position or omits one, and
 *       both are answers to a question no authority has answered. So this
 *       build shows a CHARGE RECORD — what Couranr charged, which is the same
 *       server-computed amount the merchant already saw at quote time under
 *       PRC-001 — and says plainly that it is not a tax receipt and that a
 *       downloadable one is not available yet.
 *
 * `REF-002` (decided) is a copy constraint over everything here: Couranr
 * charges for delivery and approved operating charges only; the product price
 * and any product refund are the merchant's own responsibility. No string in
 * this module or its screen may imply Couranr refunds merchandise, and
 * `tests/couranr-billing.test.ts` asserts it.
 *
 * Pure and dependency-free so every claim above is testable without a
 * database.
 */

import type { PaymentState } from "@/lib/couranr/payments/states";

/** What a merchant sees for one delivery charge. */
export const CHARGE_RECORD_STATES = [
  /** Priced, nothing authorized yet. */
  "not_authorized",
  /** Stripe needs the payer to act — 3DS, a re-confirm. */
  "action_required",
  /** Held, not taken. */
  "authorized",
  /** Capture asked for, Stripe has not settled it yet. */
  "capture_pending",
  /** Money taken. This is the only state where a merchant has been charged. */
  "charged",
  /** The authorization was declined or expired. */
  "failed",
  /** Superseded by a requote, or the request ended. Nothing is owed. */
  "cancelled",
] as const;
export type ChargeRecordState = (typeof CHARGE_RECORD_STATES)[number];

export const CHARGE_RECORD_LABELS: Readonly<Record<ChargeRecordState, string>> = {
  not_authorized: "Not authorized yet",
  action_required: "Needs confirmation",
  authorized: "Authorized, not charged",
  capture_pending: "Charging",
  charged: "Charged",
  failed: "Payment failed",
  cancelled: "Cancelled",
};

/**
 * What each state means for the merchant's money, in a sentence.
 *
 * Every one of these says whether money has actually moved. That is the only
 * question a billing screen exists to answer, and a merchant should never
 * have to infer it from a status word.
 */
export const CHARGE_RECORD_DESCRIPTIONS: Readonly<Record<ChargeRecordState, string>> = {
  not_authorized:
    "This delivery has a price but no payment has been authorized. Nothing has been charged.",
  action_required:
    "Your bank asked for confirmation before authorizing. Nothing has been charged.",
  authorized:
    "The amount is held against your payment method. Couranr has not taken it, and does not until the delivery is confirmed.",
  capture_pending: "Couranr has requested this charge. It has not settled yet.",
  charged: "Couranr charged this amount for the delivery.",
  failed:
    "The authorization did not go through, so this delivery cannot be dispatched until payment is authorized again. Nothing has been charged.",
  cancelled: "This charge was cancelled. Nothing has been charged.",
};

export const CHARGE_RECORD_TONE: Readonly<
  Record<ChargeRecordState, "neutral" | "info" | "success" | "warning">
> = {
  not_authorized: "neutral",
  action_required: "warning",
  authorized: "info",
  capture_pending: "info",
  charged: "success",
  failed: "warning",
  cancelled: "neutral",
};

/** Money actually left the merchant's account only in this state. */
export function moneyWasTaken(state: ChargeRecordState): boolean {
  return state === "charged";
}

/**
 * The merchant-facing state for one obligation.
 *
 * This is a RENAMING of the stored payment state, not a second opinion about
 * it. Every stored value maps to exactly one record state, and an unknown
 * value maps to `not_authorized` — the state that claims the least — rather
 * than throwing on a screen someone is trying to read their charges from.
 *
 * `refunded` and `partially_refunded` are deliberately absent from the map:
 * they have no writer (REF-001, phase 7), so a row carrying one would mean
 * something wrote a state this build does not understand. Claiming the least
 * is the right answer there too.
 */
export function chargeRecordState(paymentState: string | null | undefined): ChargeRecordState {
  switch (paymentState) {
    case "requires_action":
      return "action_required";
    case "authorized":
      return "authorized";
    case "capture_pending":
      return "capture_pending";
    case "captured":
      return "charged";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "not_started":
    default:
      return "not_authorized";
  }
}

/**
 * The state of the merchant's stored payment method.
 *
 * There is exactly one value this can take today, and it is not a placeholder
 * for a feature that is nearly done — nothing in this system has ever stored a
 * payment method. The type has a second member so that adding storage later
 * changes a return value rather than a type.
 */
export const PAYMENT_METHOD_STATES = ["none_on_file", "default_on_file"] as const;
export type PaymentMethodState = (typeof PAYMENT_METHOD_STATES)[number];

/**
 * Always `none_on_file`.
 *
 * Deliberately a FUNCTION rather than a constant, so the screen reads it the
 * same way it will read a real lookup, and so this file is the single place
 * that has to change when saved methods ship.
 */
export function paymentMethodState(): PaymentMethodState {
  return "none_on_file";
}

/**
 * The capabilities this screen does NOT have, each with the reason and who can
 * unblock it.
 *
 * This exists so the SCREEN cannot quietly grow an "Add payment method" button
 * that does nothing, and so a reader of the code learns the difference between
 * "nobody built it" and "nobody decided it". `id` is stable; `blockedBy` is the
 * citation.
 */
export type BillingGap = {
  id: string;
  label: string;
  /** What a merchant is told, in their words. Never names a decision id. */
  merchantCopy: string;
  /** Why, for a reader of this repository. */
  blockedBy: string;
  kind: "undecided" | "unbuilt";
};

export const BILLING_GAPS: readonly BillingGap[] = [
  {
    id: "saved_payment_method",
    label: "Saved payment method",
    merchantCopy:
      "Couranr does not store a payment method yet. You confirm payment on each delivery as you authorize it.",
    blockedBy:
      "Saving a method for reuse requires a Stripe Customer and a SetupIntent, with the customer id persisted here. Neither exists; the Stripe server SDK is frozen at 15.x pending characterization tests.",
    kind: "unbuilt",
  },
  {
    id: "downloadable_receipt",
    label: "Downloadable receipt",
    merchantCopy:
      "A downloadable receipt is not available yet. This page is a record of what Couranr charged, not a tax document.",
    blockedBy:
      "TAX-001 is unresolved and names MER-016 in blocked_screen_ids: no authority states whether delivery is taxable in the launch markets, who remits, or how tax appears on a receipt.",
    kind: "undecided",
  },
  {
    id: "refunds_and_credits",
    label: "Refunds and credits",
    merchantCopy:
      "Refunds on a delivery charge are handled by Couranr Support. Couranr charges for delivery only — the price of what you sold, and any refund of it, stays with you.",
    blockedBy:
      "REF-001 (decided) puts delivery refunds under Couranr Operations at phase 7 and records the code as not implemented. `refunded`/`partially_refunded` have zero transition writers.",
    kind: "unbuilt",
  },
];

/** One delivery charge, as the screen renders it. */
export type ChargeRecord = {
  obligationId: string;
  requestId: string;
  amountCents: number;
  /** What was actually taken. Null unless `charged`. */
  capturedAmountCents: number | null;
  currency: string;
  state: ChargeRecordState;
  payerType: string;
  recipientName: string | null;
  createdAt: string;
  /** The moment this record's money question was settled, if it has been. */
  settledAt: string | null;
};

export type BillingView = {
  businessAccountId: string;
  paymentMethod: PaymentMethodState;
  records: ChargeRecord[];
  /** Cents actually charged, summed over `charged` records only. */
  totalChargedCents: number;
  gaps: readonly BillingGap[];
};

/**
 * The total Couranr has actually taken.
 *
 * Sums ONLY `charged` records, and prefers `capturedAmountCents` over the
 * authorized amount — the authorized figure is what was reserved, not what was
 * taken. A total built from authorizations would overstate what a merchant has
 * paid, which on a billing screen is the worst direction to be wrong in.
 *
 * THE PREFERENCE IS CURRENTLY UNREACHABLE, and saying so is the point.
 * `couranr_po_captured_amount_chk` requires `captured_amount_cents =
 * amount_cents`, so the two cannot differ and no partial capture can exist —
 * measured, not assumed: the disposable database refused a fixture that tried
 * to seed one (`e2e/disposable/billingRecords.mjs`, check F1). The preference
 * stays because it is free and it is right the day that constraint is relaxed;
 * it is documented because a reader would otherwise conclude partial captures
 * happen here.
 */
export function totalChargedCents(records: readonly ChargeRecord[]): number {
  return records
    .filter((r) => moneyWasTaken(r.state))
    .reduce((sum, r) => sum + (r.capturedAmountCents ?? r.amountCents), 0);
}

/** `2299` → `"$22.99"`. Integer cents in, never a float. */
export function formatCents(cents: number, currency = "usd"): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  const symbol = currency.toLowerCase() === "usd" ? "$" : "";
  return `${sign}${symbol}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Narrowing helper: `tsconfig` sets `"strict": false`, so `.ok` does not. */
export type { PaymentState };
