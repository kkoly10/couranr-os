/**
 * Couranr → Business (merchant-facing) templates.
 *
 * Voice: Couranr (never a personal "I/we the operator"), plainspoken,
 * reassuring, concrete. Sentence case. No prohibited claims (guaranteed times,
 * instant confirmation, 24/7 support, new customers, subscription pricing).
 * All pickup/delivery times are estimates.
 */

import { EmailConfig } from "../theme";
import { RenderedEmail } from "../types";
import type {
  BizWorkspaceCreatedInput,
  BizActivationApprovedInput,
  BizQuoteReadyInput,
  BizPaymentReceiptInput,
  BizReviewOutcomeInput,
  BizDeliveredReceiptInput,
  BizActionNeededInput,
} from "../types";
import {
  renderEmail,
  eyebrow,
  h1,
  paragraph,
  small,
  button,
  fallbackLink,
  panel,
  detailList,
  lineItemsTable,
  strongNavy,
} from "../primitives";

const ESTIMATE_NOTE =
  "Pickup and delivery times are estimates until Couranr confirms them.";

/** 1 · Test workspace created (after sign-up). */
export function bizWorkspaceCreated(
  config: EmailConfig,
  input: BizWorkspaceCreatedInput,
): RenderedEmail {
  const content = [
    eyebrow(`Welcome to ${config.brandName}`),
    h1("Your workspace is ready"),
    paragraph(
      `Hi${input.contactFirstName ? ` ${input.contactFirstName}` : ""} — ${strongNavy(
        input.businessName,
      )} now has a Couranr workspace. Keep taking orders however you already do — website, phone, text, social, or in person — and Couranr handles what happens after the order is ready: quote, payment, dispatch, tracking, and proof.`,
    ),
    paragraph(
      "Your workspace is in test mode, so you can look around first. To book live deliveries, finish a short activation.",
    ),
    button({ label: "Finish activation", href: input.onboardingUrl }),
    fallbackLink(input.onboardingUrl),
    panel({
      tone: "neutral",
      title: "What activation covers",
      html: "Verify your contact details, add your pickup location, and accept the delivery terms and prohibited-item policy. No monthly fee and no product-sales commission during the pilot.",
    }),
    small(config.company.serviceArea),
  ].join("\n");

  return renderEmail(config, {
    subject: "Your Couranr workspace is ready",
    preheader: "Finish a short activation to start booking local deliveries.",
    contentHtml: content,
  });
}

/** 2 · Live activation approved. */
export function bizActivationApproved(
  config: EmailConfig,
  input: BizActivationApprovedInput,
): RenderedEmail {
  const content = [
    eyebrow("You're live"),
    h1("You can now book live deliveries"),
    paragraph(
      `${strongNavy(input.businessName)} is activated. The next time an order is ready, create a delivery and Couranr takes it from there.`,
    ),
    button({ label: "Create a delivery", href: input.newDeliveryUrl }),
    fallbackLink(input.newDeliveryUrl),
    panel({
      tone: "success",
      title: "Activated",
      html: `You're set to serve customers across Washington DC, Stafford, Woodbridge, and Fredericksburg. Requests to surrounding areas are still welcome — Couranr reviews them before quoting.`,
    }),
    small(ESTIMATE_NOTE),
  ].join("\n");

  return renderEmail(config, {
    subject: "You're live on Couranr",
    preheader: "Your business is activated — create a delivery whenever an order is ready.",
    contentHtml: content,
  });
}

/** 3 · Quote ready — approve & pay (or hand to the customer). */
export function bizQuoteReady(
  config: EmailConfig,
  input: BizQuoteReadyInput,
): RenderedEmail {
  const details = detailList([
    { label: "Reference", value: input.reference },
    { label: "Drop-off", value: input.dropoffCity },
    { label: "Service", value: input.serviceLevelLabel },
    { label: "Window", value: input.scheduledWindowLabel ?? "Same-day (estimated)" },
    { label: "Weight", value: input.weightLabel ?? "" },
  ]);

  const money = input.lineItems?.length
    ? lineItemsTable(input.lineItems, input.total)
    : detailList([
        { label: "Delivery total", value: strongNavy(fmt(input.total.amountCents, input.total.currency)) },
      ]);

  const action = input.customerPays
    ? [
        paragraph(
          "This delivery is set to customer-paid. Couranr will send your customer a secure link to review and pay — you don't need to do anything now.",
        ),
        button({ label: "Review the request", href: input.approveUrl }),
      ]
    : [
        paragraph("Approve the quote to authorize payment. Couranr captures it only after your delivery is confirmed."),
        button({ label: "Approve & pay", href: input.approveUrl }),
      ];

  const content = [
    eyebrow(`Quote ready · ${input.reference}`),
    h1("Your delivery quote is ready"),
    details,
    money,
    ...action,
    fallbackLink(input.approveUrl),
    small(`${ESTIMATE_NOTE} A quote holds for 15 minutes, then it's refreshed before you approve.`),
  ].join("\n");

  return renderEmail(config, {
    subject: `Delivery quote ready — ${input.reference}`,
    preheader: `${input.serviceLevelLabel} to ${input.dropoffCity} · ${fmt(input.total.amountCents, input.total.currency)}`,
    contentHtml: content,
  });
}

/** 4 · Payment receipt (merchant-paid capture). */
export function bizPaymentReceipt(
  config: EmailConfig,
  input: BizPaymentReceiptInput,
): RenderedEmail {
  const content = [
    eyebrow(`Receipt · ${input.reference}`),
    h1("Payment received"),
    paragraph("Thanks — here's your receipt. Keep it for your records."),
    detailList([
      { label: "Reference", value: input.reference },
      { label: "Paid", value: input.paidAtLabel },
      { label: "Method", value: input.cardLabel ?? "Card on file" },
    ]),
    input.lineItems?.length
      ? lineItemsTable(input.lineItems, input.total)
      : detailList([{ label: "Total", value: strongNavy(fmt(input.total.amountCents, input.total.currency)) }]),
    button({ label: "View delivery", href: input.detailsUrl, variant: "secondary" }),
  ].join("\n");

  return renderEmail(config, {
    subject: `Receipt for delivery ${input.reference}`,
    preheader: `Payment of ${fmt(input.total.amountCents, input.total.currency)} received.`,
    contentHtml: content,
  });
}

/** 5 · Couranr review outcome — confirmed / requote / declined. */
export function bizReviewOutcome(
  config: EmailConfig,
  input: BizReviewOutcomeInput,
): RenderedEmail {
  if (input.outcome === "confirmed") {
    const content = [
      eyebrow(`Confirmed · ${input.reference}`),
      h1("Couranr confirmed your delivery"),
      panel({
        tone: "success",
        title: "Confirmed",
        html: "Your delivery is scheduled and a vehicle is assigned. You'll get tracking updates as it moves.",
      }),
      detailList([
        { label: "Reference", value: input.reference },
        { label: "Window", value: input.scheduledWindowLabel ?? "Same-day (estimated)" },
        { label: "Vehicle", value: input.vehicleLabel ?? "Couranr-assigned" },
      ]),
      button({ label: "View delivery", href: input.ctaUrl }),
      small(ESTIMATE_NOTE),
    ].join("\n");
    return renderEmail(config, {
      subject: `Confirmed — delivery ${input.reference}`,
      preheader: "Couranr confirmed your delivery and assigned a vehicle.",
      contentHtml: content,
    });
  }

  if (input.outcome === "requote") {
    const content = [
      eyebrow(`Updated quote · ${input.reference}`),
      h1("This delivery needs an updated quote"),
      panel({
        tone: "warning",
        title: "Review needed",
        html: input.changeReason
          ? input.changeReason
          : "After review, the delivery needs a revised quote before it can be confirmed.",
      }),
      input.newTotal
        ? detailList([
            { label: "Reference", value: input.reference },
            { label: "Updated total", value: strongNavy(fmt(input.newTotal.amountCents, input.newTotal.currency)) },
          ])
        : "",
      paragraph("Nothing has been captured. Review the updated quote to continue, or reply to this email with questions."),
      button({ label: "Review updated quote", href: input.ctaUrl }),
      fallbackLink(input.ctaUrl),
    ].join("\n");
    return renderEmail(config, {
      subject: `Updated quote — delivery ${input.reference}`,
      preheader: "Your delivery needs a revised quote before it's confirmed.",
      contentHtml: content,
    });
  }

  // declined
  const content = [
    eyebrow(`Couldn't confirm · ${input.reference}`),
    h1("Couranr couldn't confirm this delivery"),
    panel({
      tone: "neutral",
      title: "Not confirmed",
      html: input.declineReason ?? "Couranr wasn't able to confirm this delivery.",
    }),
    paragraph(
      "You haven't been charged — any payment authorization has been released. Reply to this email and Couranr will help you find another option.",
    ),
    button({ label: "View details", href: input.ctaUrl, variant: "secondary" }),
  ].join("\n");
  return renderEmail(config, {
    subject: `Couldn't confirm — delivery ${input.reference}`,
    preheader: "This delivery couldn't be confirmed. You haven't been charged.",
    contentHtml: content,
  });
}

/** 6 · Delivered — proof receipt to the merchant. */
export function bizDeliveredReceipt(
  config: EmailConfig,
  input: BizDeliveredReceiptInput,
): RenderedEmail {
  const content = [
    eyebrow(`Delivered · ${input.reference}`),
    h1(`Delivered to ${input.recipientName}`),
    panel({ tone: "success", title: "Delivered", html: `Completed ${escapeInline(input.deliveredAtLabel)}.` }),
    detailList([
      { label: "Reference", value: input.reference },
      { label: "Recipient", value: input.recipientName },
      { label: "Delivered", value: input.deliveredAtLabel },
      { label: "Proof", value: input.proofMethodLabel },
    ]),
    input.proofUrl
      ? button({ label: "View proof", href: input.proofUrl })
      : button({ label: "View delivery", href: input.detailsUrl, variant: "secondary" }),
  ].join("\n");

  return renderEmail(config, {
    subject: `Delivered — ${input.reference}`,
    preheader: `Your delivery to ${input.recipientName} is complete, with proof on file.`,
    contentHtml: content,
  });
}

/** 7 · Action needed (recipient unavailable, return, address problem). */
export function bizActionNeeded(
  config: EmailConfig,
  input: BizActionNeededInput,
): RenderedEmail {
  const heading: Record<BizActionNeededInput["issue"], string> = {
    recipient_unavailable: "Your recipient wasn't available",
    return_required: "This delivery needs to be returned",
    address_problem: "There's an address problem",
    other: "This delivery needs your input",
  };
  const content = [
    eyebrow(`Action needed · ${input.reference}`),
    h1(heading[input.issue]),
    panel({ tone: "warning", title: "Needs a decision", html: escapeInline(input.message) }),
    detailList([
      { label: "Reference", value: input.reference },
      { label: "Recipient", value: input.recipientName },
    ]),
    paragraph("Let Couranr know how you'd like to proceed and we'll take it from there."),
    button({ label: "Review & respond", href: input.ctaUrl }),
    fallbackLink(input.ctaUrl),
  ].join("\n");

  return renderEmail(config, {
    subject: `Action needed — delivery ${input.reference}`,
    preheader: escapeInline(input.message).slice(0, 90),
    contentHtml: content,
  });
}

/* helpers */
function fmt(amountCents: number, currency: string): string {
  const v = (amountCents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "USD" ? `$${v}` : `${v} ${currency}`;
}

function escapeInline(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
