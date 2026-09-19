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

export interface BizOutForDeliveryInput {
  businessName: string;
  reference: string;
  recipientName: string;
  etaLabel?: string;
  detailsUrl: string;
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

/** Direct Consumer Same Day confirmation; there is no merchant/shop identity. */
export interface CustDirectDeliveryConfirmedInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  dropoffLabel: string;
  trackUrl: string;
  recipientAdultAttestationRequired: boolean;
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
  trackUrl?: string;
}

export interface CustDeliveredInput {
  shop: Shop;
  recipientName: string;
  reference: string;
  deliveredAtLabel: string;
  proofMethodLabel: string;
  proofUrl?: string;
  trackUrl?: string;
}

export interface CustRecipientUnavailableInput {
  shop: Shop;
  recipientName: string;
  reference: string;
  message: string;
  helpUrl?: string;
}

export interface CustReturnNoticeInput {
  shop: Shop;
  recipientName: string;
  reference: string;
  reasonLabel: string;
  helpUrl?: string;
}

/* ------------------------------------------------------------------ */
/* Couranr Same Day — direct consumer lifecycle                        */
/* ------------------------------------------------------------------ */

/**
 * There is no shop in this lane. A person asked Couranr to take something to
 * another person, so the two audiences are the SENDER (who paid, and who can
 * still act) and the RECIPIENT (who is waiting, and who holds a private
 * tracking link and nothing else).
 *
 * NO INPUT HERE CARRIES A CODE OR A PIN, and that is structural rather than a
 * convention: a field that does not exist cannot be interpolated into a
 * template by a later edit. The recipient's handoff PIN lives behind the
 * token-protected tracking page; `codeOnTrackingPage` says only that one
 * exists and where to look.
 */

export interface ConsumerSenderRequestReceivedInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  dropoffLabel: string;
  statusUrl: string;
}

export interface ConsumerSenderRequestConfirmedInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  dropoffLabel: string;
  /** True once the recipient's own tracking invitation has been accepted by the
      provider. The sender is told the FACT, never the recipient's token. */
  recipientNotified: boolean;
  statusUrl: string;
}

/**
 * NO `trackUrl` ON EITHER RECIPIENT FOLLOW-UP, and this is a fact about the
 * system rather than an omission.
 *
 * The recipient's tracking token exists in plaintext for exactly one instant —
 * inside `claimConsumerRecipientTrackingDelivery`, which returns it once and
 * stores only its SHA-256. Nothing can recover it afterwards, so a follow-up
 * sent hours later has no link to offer and must not invent one: minting a
 * SECOND token to fill the gap would revoke the link the recipient is already
 * holding. These messages point back to the invitation instead.
 */
export interface ConsumerSenderOutForDeliveryInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  statusUrl: string;
}

export interface ConsumerSenderDeliveredInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  deliveredAtLabel: string;
  statusUrl: string;
}

export interface ConsumerRecipientOutForDeliveryInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  handoffMethodLabel: string;
  /** A code is required; the email says WHERE it is, never what it is. */
  codeOnTrackingPage?: boolean;
}

export interface ConsumerRecipientDeliveredInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  deliveredAtLabel: string;
}

export interface ConsumerRecipientHandoffFailedInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  reasonLabel: string;
}

export interface ConsumerRecipientReturnNoticeInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  reasonLabel: string;
}

export interface ConsumerSenderHandoffFailedInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  reasonLabel: string;
  statusUrl: string;
}

export interface ConsumerSenderReturnNoticeInput {
  senderName?: string;
  recipientName: string;
  reference: string;
  reasonLabel: string;
  statusUrl: string;
}
