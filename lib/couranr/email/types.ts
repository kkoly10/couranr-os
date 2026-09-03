/**
 * Input shapes for Couranr email templates.
 *
 * Templates are PURE: a caller maps database rows (business_accounts,
 * couranr_deliveries, merchant_customers, couranr_quote_versions, …) into these
 * plain objects and gets HTML back. No template reads the database or app state.
 *
 * `to` (the recipient address) is intentionally NOT part of any template input.
 * The caller supplies it at send time from the row it already loaded, so a
 * template can never accidentally leak or hardcode a recipient.
 */

export interface Money {
  amountCents: number;
  currency: string; // ISO 4217, e.g. "USD"
}

export interface LineItem {
  label: string;
  amountCents: number;
  /** Optional muted note, e.g. "2.4 loaded miles". */
  note?: string;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  /** Handoff instructions, shown only where relevant. */
  instructions?: string;
}

/** The merchant, as the recipient sees it ("Your delivery from Bloom & Co"). */
export interface Shop {
  name: string;
}

/** The rendered, sendable email. The caller adds `to` and hands this to Resend. */
export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  from: string; // e.g. `Couranr <no-reply@mail.couranr.com>`
  replyTo: string; // support@couranr.com
}

/* ------------------------------------------------------------------ */
/* Couranr → Business (merchant-facing)                               */
/* ------------------------------------------------------------------ */

export interface BizWorkspaceCreatedInput {
  contactFirstName?: string;
  businessName: string;
  onboardingUrl: string;
}

export interface BizActivationApprovedInput {
  businessName: string;
  newDeliveryUrl: string;
}

export interface BizQuoteReadyInput {
  businessName: string;
  reference: string;
  dropoffCity: string;
  serviceLevelLabel: string;
  scheduledWindowLabel?: string;
  weightLabel?: string;
  lineItems?: LineItem[];
  total: Money;
  approveUrl: string;
  /** True when the customer, not the business, will be asked to pay. */
  customerPays?: boolean;
}

export interface BizPaymentReceiptInput {
  businessName: string;
  reference: string;
  paidAtLabel: string;
  cardLabel?: string; // "Visa ···· 4242"
  lineItems?: LineItem[];
  total: Money;
  detailsUrl: string;
}

export type BizReviewOutcome = "confirmed" | "requote" | "declined";

export interface BizReviewOutcomeInput {
  businessName: string;
  reference: string;
  outcome: BizReviewOutcome;
  /** confirmed */
  scheduledWindowLabel?: string;
  vehicleLabel?: string;
  /** requote */
  newTotal?: Money;
  changeReason?: string;
  /** declined */
  declineReason?: string;
  ctaUrl: string;
}

export interface BizDeliveredReceiptInput {
  businessName: string;
  reference: string;
  recipientName: string;
  deliveredAtLabel: string;
  proofMethodLabel: string; // "Photo + PIN", "Signature", "Left at door"
  proofUrl?: string;
  detailsUrl: string;
}

export type BizActionIssue =
  | "recipient_unavailable"
  | "return_required"
  | "address_problem"
  | "other";

export interface BizActionNeededInput {
  businessName: string;
  reference: string;
  recipientName: string;
  issue: BizActionIssue;
  message: string;
  ctaUrl: string;
}

/* ------------------------------------------------------------------ */
/* Business → Customer (recipient-facing, sent by Couranr for the shop) */
/* ------------------------------------------------------------------ */

export interface CustApproveAndPayInput {
  shop: Shop;
  recipientName: string;
  itemSummary?: string;
  dropoffCity: string;
  serviceLevelLabel: string;
  scheduledWindowLabel?: string;
  lineItems?: LineItem[];
  total: Money;
  payUrl: string;
}

export interface CustOrderConfirmedInput {
  shop: Shop;
  recipientName: string;
  reference: string;
  scheduledWindowLabel?: string;
  dropoffLabel: string; // e.g. "Woodbridge, VA" — never the full street line
  trackUrl: string;
}

export interface CustOutForDeliveryInput {
  shop: Shop;
  recipientName: string;
  reference: string;
  driverFirstName?: string;
  etaLabel?: string;
  handoffMethodLabel: string; // "Hand to you", "Signature", "Leave at door"
  /** When a handoff code is required, we tell them WHERE to find it — we never
   * put the code itself in the email. */
  codeOnTrackingPage?: boolean;
  trackUrl: string;
}

export interface CustDeliveredInput {
  shop: Shop;
  recipientName: string;
  reference: string;
  deliveredAtLabel: string;
  proofMethodLabel: string;
  proofUrl?: string;
  trackUrl: string;
}

export interface CustRecipientUnavailableInput {
  shop: Shop;
  recipientName: string;
  reference: string;
  message: string;
  helpUrl: string;
}

export interface CustReturnNoticeInput {
  shop: Shop;
  recipientName: string;
  reference: string;
  reasonLabel: string;
  helpUrl: string;
}
