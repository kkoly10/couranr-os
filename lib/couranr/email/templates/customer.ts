/**
 * Business → Customer (recipient-facing) templates — sent by Couranr on the
 * shop's behalf.
 *
 * The shop is foregrounded ("Your delivery from Bloom & Co"); the From name
 * reads "<Shop> via Couranr" while the address stays on the verified Couranr
 * sending domain and replies route to Couranr Support. Merchandise questions go
 * to the shop; delivery questions to Couranr. Handoff codes are NEVER put in the
 * email — we point to the token-protected tracking page instead.
 */

import { EmailConfig } from "../theme";
import { RenderedEmail } from "../types";
import type {
  CustApproveAndPayInput,
  CustOrderConfirmedInput,
  CustOutForDeliveryInput,
  CustDeliveredInput,
  CustRecipientUnavailableInput,
  CustReturnNoticeInput,
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
  formatMoney,
  esc,
  strongNavy,
} from "../primitives";

const viaName = (shop: string, brand: string) => `${shop} via ${brand}`;

/** 1 · Approve & pay (customer-paid secure link). */
export function custApproveAndPay(
  config: EmailConfig,
  input: CustApproveAndPayInput,
): RenderedEmail {
  const content = [
    eyebrow(`From ${input.shop.name}`),
    h1(`Approve & pay for your delivery`),
    paragraph(
      `Hi ${esc(input.recipientName)} — ${strongNavy(input.shop.name)} is sending you an order and Couranr will deliver it. Review the details below and approve to schedule your delivery.`,
    ),
    detailList([
      { label: "From", value: esc(input.shop.name) },
      { label: "Item", value: input.itemSummary ? esc(input.itemSummary) : "Your order" },
      { label: "Drop-off", value: esc(input.dropoffCity) },
      { label: "Service", value: esc(input.serviceLevelLabel) },
      { label: "Window", value: input.scheduledWindowLabel ? esc(input.scheduledWindowLabel) : "Same-day (estimated)" },
    ]),
    input.lineItems?.length
      ? lineItemsTable(input.lineItems, input.total)
      : detailList([{ label: "Delivery total", value: strongNavy(formatMoney(input.total)) }]),
    button({ label: "Review & pay", href: input.payUrl }),
    fallbackLink(input.payUrl),
    small(
      "No account needed. Your card is authorized now and charged only once the delivery is confirmed. Pickup and delivery times are estimates.",
    ),
  ].join("\n");

  return renderEmail(config, {
    subject: `Approve & pay for your delivery from ${input.shop.name}`,
    preheader: `${input.shop.name} is sending your order — review and pay to schedule it.`,
    contentHtml: content,
    fromName: viaName(input.shop.name, config.brandName),
  });
}

/** 2 · Order confirmed & scheduled. */
export function custOrderConfirmed(
  config: EmailConfig,
  input: CustOrderConfirmedInput,
): RenderedEmail {
  const content = [
    eyebrow(`From ${input.shop.name}`),
    h1("Your delivery is scheduled"),
    paragraph(
      `Hi ${esc(input.recipientName)} — ${strongNavy(input.shop.name)} is sending your order, and Couranr is handling the delivery. You can follow it any time.`,
    ),
    detailList([
      { label: "Reference", value: esc(input.reference) },
      { label: "Window", value: input.scheduledWindowLabel ? esc(input.scheduledWindowLabel) : "Same-day (estimated)" },
      { label: "Drop-off", value: esc(input.dropoffLabel) },
    ]),
    button({ label: "Track your delivery", href: input.trackUrl }),
    fallbackLink(input.trackUrl),
    small("Pickup and delivery times are estimates. We'll let you know when it's on the way."),
  ].join("\n");

  return renderEmail(config, {
    subject: `Your delivery from ${input.shop.name} is scheduled`,
    preheader: "Follow your delivery any time with live tracking.",
    contentHtml: content,
    fromName: viaName(input.shop.name, config.brandName),
  });
}

/** 3 · Out for delivery. */
export function custOutForDelivery(
  config: EmailConfig,
  input: CustOutForDeliveryInput,
): RenderedEmail {
  const who = input.driverFirstName ? `${esc(input.driverFirstName)}, your Couranr driver,` : "Your Couranr driver";
  const content = [
    eyebrow("On the way"),
    h1("Your delivery is on the way"),
    paragraph(
      `${who} is bringing your order from ${strongNavy(input.shop.name)}.${
        input.etaLabel ? ` Estimated arrival ${esc(input.etaLabel)}.` : ""
      }`,
    ),
    input.codeOnTrackingPage
      ? panel({
          tone: "info",
          title: "Handoff code",
          html: `Your driver will ask for a short code to confirm the handoff (${esc(
            input.handoffMethodLabel,
          )}). Find it on your tracking page — for your security, we never include it in an email.`,
        })
      : panel({ tone: "info", title: "Handoff", html: `Method: ${esc(input.handoffMethodLabel)}.` }),
    button({ label: "Track your delivery", href: input.trackUrl }),
    fallbackLink(input.trackUrl),
    small("Arrival times are estimates and can shift with traffic."),
  ].join("\n");

  return renderEmail(config, {
    subject: `On the way — your delivery from ${input.shop.name}`,
    preheader: input.etaLabel ? `Estimated arrival ${input.etaLabel}.` : "Your driver is on the way.",
    contentHtml: content,
    fromName: viaName(input.shop.name, config.brandName),
  });
}

/** 4 · Delivered. */
export function custDelivered(config: EmailConfig, input: CustDeliveredInput): RenderedEmail {
  const content = [
    eyebrow("Delivered"),
    h1("Your delivery arrived"),
    panel({ tone: "success", title: "Delivered", html: `Completed ${esc(input.deliveredAtLabel)}.` }),
    detailList([
      { label: "From", value: esc(input.shop.name) },
      { label: "Reference", value: esc(input.reference) },
      { label: "Delivered", value: esc(input.deliveredAtLabel) },
      { label: "Proof", value: esc(input.proofMethodLabel) },
    ]),
    input.proofUrl
      ? button({ label: "View proof", href: input.proofUrl })
      : button({ label: "View delivery", href: input.trackUrl, variant: "secondary" }),
    small(
      `Questions about the delivery? Just reply. For anything about your order itself, please contact ${esc(input.shop.name)}.`,
    ),
  ].join("\n");

  return renderEmail(config, {
    subject: `Delivered — your order from ${input.shop.name}`,
    preheader: `Your delivery from ${input.shop.name} arrived ${input.deliveredAtLabel}.`,
    contentHtml: content,
    fromName: viaName(input.shop.name, config.brandName),
  });
}

/** 5 · Recipient unavailable. */
export function custRecipientUnavailable(
  config: EmailConfig,
  input: CustRecipientUnavailableInput,
): RenderedEmail {
  const content = [
    eyebrow("We missed you"),
    h1("We couldn't complete your delivery"),
    paragraph(
      `Hi ${esc(input.recipientName)} — Couranr tried to deliver your order from ${strongNavy(
        input.shop.name,
      )}, but couldn't complete the handoff.`,
    ),
    panel({ tone: "warning", title: "What happened", html: esc(input.message) }),
    paragraph("Choose what happens next and we'll follow your instructions."),
    button({ label: "Choose what happens next", href: input.helpUrl }),
    fallbackLink(input.helpUrl),
  ].join("\n");

  return renderEmail(config, {
    subject: `We missed you — your delivery from ${input.shop.name}`,
    preheader: "Choose what happens next with your delivery.",
    contentHtml: content,
    fromName: viaName(input.shop.name, config.brandName),
  });
}

/** 6 · Return notice. */
export function custReturnNotice(
  config: EmailConfig,
  input: CustReturnNoticeInput,
): RenderedEmail {
  const content = [
    eyebrow("Return"),
    h1("Your delivery is being returned"),
    paragraph(
      `Your order from ${strongNavy(input.shop.name)} is on its way back. Here's why, and what you can do.`,
    ),
    panel({ tone: "neutral", title: "Reason", html: esc(input.reasonLabel) }),
    button({ label: "See details", href: input.helpUrl, variant: "secondary" }),
    small(`For questions about the order itself, please contact ${esc(input.shop.name)}.`),
  ].join("\n");

  return renderEmail(config, {
    subject: `Your delivery from ${input.shop.name} is being returned`,
    preheader: "Here's why your delivery is coming back, and what you can do.",
    contentHtml: content,
    fromName: viaName(input.shop.name, config.brandName),
  });
}
