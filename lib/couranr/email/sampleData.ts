/**
 * Realistic sample inputs for previewing and testing every template.
 * Amounts follow Couranr Pricing Authority V2 ($7.99 base / first 2.0 mi,
 * $1.25/mi over 2, signature +$3.00). URLs are built from the config base.
 */

import { EmailConfig, url } from "./theme";
import type {
  BizWorkspaceCreatedInput,
  BizActivationApprovedInput,
  BizQuoteReadyInput,
  BizPaymentReceiptInput,
  BizReviewOutcomeInput,
  BizDeliveredReceiptInput,
  BizActionNeededInput,
  CustApproveAndPayInput,
  CustOrderConfirmedInput,
  CustOutForDeliveryInput,
  CustDeliveredInput,
  CustRecipientUnavailableInput,
  CustReturnNoticeInput,
  LineItem,
} from "./types";

const USD = "USD";
const shop = { name: "Bloom & Co" };
const reference = "CR-8F42QK";
const recipient = "Jordan Rivera";

const lineItems: LineItem[] = [
  { label: "Delivery — first 2.0 mi", amountCents: 799, note: "Standard service" },
  { label: "Distance — 2.4 loaded mi", amountCents: 300, note: "$1.25/mi over 2 mi" },
  { label: "Signature", amountCents: 300 },
];
const total = { amountCents: 1399, currency: USD };

export interface EmailSamples {
  business: {
    workspaceCreated: BizWorkspaceCreatedInput;
    activationApproved: BizActivationApprovedInput;
    quoteReady: BizQuoteReadyInput;
    paymentReceipt: BizPaymentReceiptInput;
    reviewConfirmed: BizReviewOutcomeInput;
    reviewRequote: BizReviewOutcomeInput;
    reviewDeclined: BizReviewOutcomeInput;
    deliveredReceipt: BizDeliveredReceiptInput;
    actionNeeded: BizActionNeededInput;
  };
  customer: {
    approveAndPay: CustApproveAndPayInput;
    orderConfirmed: CustOrderConfirmedInput;
    outForDelivery: CustOutForDeliveryInput;
    delivered: CustDeliveredInput;
    recipientUnavailable: CustRecipientUnavailableInput;
    returnNotice: CustReturnNoticeInput;
  };
}

export function buildSamples(config: EmailConfig): EmailSamples {
  const trackUrl = url(config, "/track/tok_demo7f42qk");
  const payUrl = url(config, "/pay/tok_demo7f42qk");
  const helpUrl = url(config, "/help/tok_demo7f42qk");
  const deliveryUrl = url(config, "/business/deliveries/CR-8F42QK");
  const proofUrl = url(config, "/business/deliveries/CR-8F42QK#proof");

  return {
    business: {
      workspaceCreated: {
        contactFirstName: "Mara",
        businessName: "Bloom & Co",
        onboardingUrl: url(config, "/business/onboarding"),
      },
      activationApproved: {
        businessName: "Bloom & Co",
        newDeliveryUrl: url(config, "/business/deliveries/new"),
      },
      quoteReady: {
        businessName: "Bloom & Co",
        reference,
        dropoffCity: "Woodbridge, VA",
        serviceLevelLabel: "Same-day",
        scheduledWindowLabel: "Today, 2:00–4:00 PM",
        weightLabel: "Up to 25 lb",
        lineItems,
        total,
        approveUrl: deliveryUrl,
      },
      paymentReceipt: {
        businessName: "Bloom & Co",
        reference,
        paidAtLabel: "Sep 3, 2026 · 1:12 PM",
        cardLabel: "Visa ···· 4242",
        lineItems,
        total,
        detailsUrl: deliveryUrl,
      },
      reviewConfirmed: {
        businessName: "Bloom & Co",
        reference,
        outcome: "confirmed",
        scheduledWindowLabel: "Today, 2:00–4:00 PM",
        vehicleLabel: "Standard car",
        ctaUrl: deliveryUrl,
      },
      reviewRequote: {
        businessName: "Bloom & Co",
        reference,
        outcome: "requote",
        changeReason: "The drop-off is just outside the same-day zone, so this needs a larger vehicle window.",
        newTotal: { amountCents: 1699, currency: USD },
        ctaUrl: deliveryUrl,
      },
      reviewDeclined: {
        businessName: "Bloom & Co",
        reference,
        outcome: "declined",
        declineReason: "No driver is available for the requested overnight window in this area tonight.",
        ctaUrl: deliveryUrl,
      },
      deliveredReceipt: {
        businessName: "Bloom & Co",
        reference,
        recipientName: recipient,
        deliveredAtLabel: "Sep 3, 2026 · 3:41 PM",
        proofMethodLabel: "Photo + PIN",
        proofUrl,
        detailsUrl: deliveryUrl,
      },
      actionNeeded: {
        businessName: "Bloom & Co",
        reference,
        recipientName: recipient,
        issue: "recipient_unavailable",
        message: "The driver arrived at 3:20 PM but no one was available to receive the order and leave-at-door isn't authorized.",
        ctaUrl: deliveryUrl,
      },
    },
    customer: {
      approveAndPay: {
        shop,
        recipientName: recipient,
        itemSummary: "1 bouquet + card",
        dropoffCity: "Woodbridge, VA",
        serviceLevelLabel: "Same-day",
        scheduledWindowLabel: "Today, 2:00–4:00 PM",
        lineItems,
        total,
        payUrl,
      },
      orderConfirmed: {
        shop,
        recipientName: recipient,
        reference,
        scheduledWindowLabel: "Today, 2:00–4:00 PM",
        dropoffLabel: "Woodbridge, VA",
        trackUrl,
      },
      outForDelivery: {
        shop,
        recipientName: recipient,
        reference,
        driverFirstName: "Andre",
        etaLabel: "about 20 minutes",
        handoffMethodLabel: "Hand to you",
        codeOnTrackingPage: true,
        trackUrl,
      },
      delivered: {
        shop,
        recipientName: recipient,
        reference,
        deliveredAtLabel: "Sep 3, 2026 · 3:41 PM",
        proofMethodLabel: "Photo + PIN",
        proofUrl: trackUrl,
        trackUrl,
      },
      recipientUnavailable: {
        shop,
        recipientName: recipient,
        reference,
        message: "Our driver stopped by at 3:20 PM but couldn't complete the handoff.",
        helpUrl,
      },
      returnNotice: {
        shop,
        recipientName: recipient,
        reference,
        reasonLabel: "Two delivery attempts were made without a successful handoff.",
        helpUrl,
      },
    },
  };
}
