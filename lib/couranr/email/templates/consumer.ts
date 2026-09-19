/**
 * Couranr Same Day — the direct-consumer lifecycle.
 *
 * Couranr is the sender of record on every message here: there is no merchant
 * to foreground, so the From name stays "Couranr" and nothing invents a shop.
 *
 * TWO AUDIENCES, DELIBERATELY SEPARATE. The SENDER paid and can still act, so
 * their messages carry the reference and a link back to Couranr Same Day. The
 * RECIPIENT holds one private tracking link and nothing else, so their messages
 * carry that link and never the sender's status page.
 *
 * NO EMAIL IN THIS FILE — OR ANY OTHER — CONTAINS A HANDOFF CODE OR RECIPIENT
 * PIN. The input types carry no field that could hold one (see types.ts), and
 * `tests/couranr-consumer-lifecycle-email.test.ts` renders every template in
 * the system with PIN-shaped fields attached and asserts the digits never reach
 * the HTML. A code lives behind the token-protected tracking page; the most an
 * email ever says is that one exists and where to find it.
 *
 * NO SMS. Couranr Same Day notifies by email only, and no copy here claims
 * otherwise.
 */

import { EmailConfig } from "../theme";
import { RenderedEmail } from "../types";
import type {
  ConsumerSenderRequestReceivedInput,
  ConsumerSenderRequestConfirmedInput,
  ConsumerSenderOutForDeliveryInput,
  ConsumerSenderDeliveredInput,
  ConsumerRecipientOutForDeliveryInput,
  ConsumerRecipientDeliveredInput,
  ConsumerRecipientHandoffFailedInput,
  ConsumerRecipientReturnNoticeInput,
  ConsumerSenderHandoffFailedInput,
  ConsumerSenderReturnNoticeInput,
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
  esc,
  strongNavy,
} from "../primitives";

const EYEBROW = "Couranr Same Day";

/** "Hi Avery — " where a name exists, "Hi — " where it does not. */
const hi = (name?: string) => (name && name.trim() ? `Hi ${esc(name.trim())} — ` : "");

/* ----------------------------------------------------------- sender --- */

/** 1 · Couranr has the request and is confirming it. */
export function consumerSenderRequestReceived(
  config: EmailConfig,
  input: ConsumerSenderRequestReceivedInput,
): RenderedEmail {
  const content = [
    eyebrow(EYEBROW),
    h1("Couranr has your delivery"),
    paragraph(
      `${hi(input.senderName)}Couranr received your Same Day delivery to ${strongNavy(
        input.recipientName,
      )} and is confirming it now. Nothing more is needed from you right now.`,
    ),
    detailList([
      { label: "Reference", value: esc(input.reference) },
      { label: "Delivering to", value: esc(input.dropoffLabel) },
      { label: "Recipient", value: esc(input.recipientName) },
    ]),
    button({ label: "Open Couranr Same Day", href: input.statusUrl, variant: "secondary" }),
    fallbackLink(input.statusUrl),
    small(
      "Couranr will email you once this delivery is confirmed, and will email your recipient their own private tracking link. Pickup and delivery times are estimates.",
    ),
  ].join("\n");

  return renderEmail(config, {
    subject: `Couranr has your delivery — ${input.reference}`,
    preheader: "Couranr received your Same Day delivery and is confirming it.",
    contentHtml: content,
  });
}

/** 2 · Confirmed and being scheduled. */
export function consumerSenderRequestConfirmed(
  config: EmailConfig,
  input: ConsumerSenderRequestConfirmedInput,
): RenderedEmail {
  const content = [
    eyebrow(EYEBROW),
    h1("Your delivery is confirmed"),
    paragraph(
      `${hi(input.senderName)}Couranr confirmed your delivery to ${strongNavy(
        input.recipientName,
      )} and is assigning a driver.`,
    ),
    detailList([
      { label: "Reference", value: esc(input.reference) },
      { label: "Delivering to", value: esc(input.dropoffLabel) },
      { label: "Recipient", value: esc(input.recipientName) },
    ]),
    /* The FACT of the recipient's notification, never the link itself. That
       link is a recipient capability — it authorizes their adult attestation,
       their identity verification and their handoff PIN — so forwarding it to
       the sender would hand one party another party's credential. */
    input.recipientNotified
      ? panel({
          tone: "success",
          title: "Recipient notified",
          html: `Couranr emailed ${esc(
            input.recipientName,
          )} their own private tracking link. For their security that link is theirs alone and is never copied into this message.`,
        })
      : panel({
          tone: "info",
          title: "Recipient notification",
          html: `Couranr is emailing ${esc(
            input.recipientName,
          )} their own private tracking link. For their security that link is theirs alone and is never copied into this message.`,
        }),
    button({ label: "Open Couranr Same Day", href: input.statusUrl, variant: "secondary" }),
    fallbackLink(input.statusUrl),
    small("Pickup and delivery times are estimates."),
  ].join("\n");

  return renderEmail(config, {
    subject: `Confirmed — your Couranr delivery ${input.reference}`,
    preheader: "Couranr confirmed your delivery and is assigning a driver.",
    contentHtml: content,
  });
}

/** 5 · The handoff could not be completed. */
export function consumerSenderHandoffFailed(
  config: EmailConfig,
  input: ConsumerSenderHandoffFailedInput,
): RenderedEmail {
  const content = [
    eyebrow(EYEBROW),
    h1("Couranr couldn't complete the handoff"),
    paragraph(
      `${hi(input.senderName)}Couranr's driver could not complete the handoff to ${strongNavy(
        input.recipientName,
      )}. Your items are safe and Couranr Support is on it.`,
    ),
    panel({ tone: "warning", title: "What happened", html: esc(input.reasonLabel) }),
    detailList([
      { label: "Reference", value: esc(input.reference) },
      { label: "Recipient", value: esc(input.recipientName) },
    ]),
    paragraph("Reply to this email and Couranr Support will arrange what happens next."),
    button({ label: "Open Couranr Same Day", href: input.statusUrl, variant: "secondary" }),
    fallbackLink(input.statusUrl),
  ].join("\n");

  return renderEmail(config, {
    subject: `Action needed — your Couranr delivery ${input.reference}`,
    preheader: "Couranr couldn't complete the handoff. Here's what happened.",
    contentHtml: content,
  });
}

/** 6 · The items are coming back. */
export function consumerSenderReturnNotice(
  config: EmailConfig,
  input: ConsumerSenderReturnNoticeInput,
): RenderedEmail {
  const content = [
    eyebrow(EYEBROW),
    h1("Your delivery is being returned"),
    paragraph(
      `${hi(input.senderName)}The items Couranr collected for ${strongNavy(
        input.recipientName,
      )} are on their way back to you.`,
    ),
    panel({ tone: "neutral", title: "Reason", html: esc(input.reasonLabel) }),
    detailList([
      { label: "Reference", value: esc(input.reference) },
      { label: "Recipient", value: esc(input.recipientName) },
    ]),
    button({ label: "Open Couranr Same Day", href: input.statusUrl, variant: "secondary" }),
    fallbackLink(input.statusUrl),
    small("Reply to this email and Couranr Support will pick it up from here."),
  ].join("\n");

  return renderEmail(config, {
    subject: `Returning — your Couranr delivery ${input.reference}`,
    preheader: "Here's why your delivery is coming back, and what happens next.",
    contentHtml: content,
  });
}

/** Sender progress — courier is on the way to the recipient. */
export function consumerSenderOutForDelivery(
  config: EmailConfig,
  input: ConsumerSenderOutForDeliveryInput,
): RenderedEmail {
  const content = [
    eyebrow(EYEBROW),
    h1("Your delivery is on the way"),
    paragraph(
      `${hi(input.senderName)}Couranr picked up your delivery and is heading to ${strongNavy(
        input.recipientName,
      )}.`,
    ),
    detailList([
      { label: "Reference", value: esc(input.reference) },
      { label: "Recipient", value: esc(input.recipientName) },
    ]),
    button({ label: "Open Couranr Same Day", href: input.statusUrl, variant: "secondary" }),
    fallbackLink(input.statusUrl),
    small("Arrival times are estimates and can shift with traffic."),
  ].join("\n");
  return renderEmail(config, {
    subject: `On the way — your Couranr delivery ${input.reference}`,
    preheader: `Couranr is heading to ${input.recipientName}.`,
    contentHtml: content,
  });
}

/** Sender receipt — successful handoff. */
export function consumerSenderDelivered(
  config: EmailConfig,
  input: ConsumerSenderDeliveredInput,
): RenderedEmail {
  const content = [
    eyebrow(EYEBROW),
    h1("Your delivery was delivered"),
    paragraph(
      `${hi(input.senderName)}Couranr completed the handoff to ${strongNavy(
        input.recipientName,
      )}.`,
    ),
    detailList([
      { label: "Reference", value: esc(input.reference) },
      { label: "Recipient", value: esc(input.recipientName) },
      { label: "Delivered", value: esc(input.deliveredAtLabel) },
    ]),
    button({ label: "Open Couranr Same Day", href: input.statusUrl, variant: "secondary" }),
    fallbackLink(input.statusUrl),
  ].join("\n");
  return renderEmail(config, {
    subject: `Delivered — your Couranr delivery ${input.reference}`,
    preheader: `Couranr completed the handoff to ${input.recipientName}.`,
    contentHtml: content,
  });
}

/* -------------------------------------------------------- recipient --- */

/** 3 · On the way to the recipient. */
export function consumerRecipientOutForDelivery(
  config: EmailConfig,
  input: ConsumerRecipientOutForDeliveryInput,
): RenderedEmail {
  const sender = input.senderName ? esc(input.senderName) : "The sender";
  const content = [
    eyebrow("On the way"),
    h1("Your delivery is on the way"),
    paragraph(
      `${hi(input.recipientName)}a Couranr driver is bringing you the delivery ${sender} sent.`,
    ),
    /* WHERE the code is, never WHAT it is. An emailed code is a code in a
       forwarded thread, in a mail search index and in a screenshot. */
    input.codeOnTrackingPage
      ? panel({
          tone: "info",
          title: "Handoff code",
          html: `Your driver will ask for a short code to confirm the handoff (${esc(
            input.handoffMethodLabel,
          )}). Open the private tracking link Couranr emailed you to see it — for your security Couranr never puts it in an email.`,
        })
      : panel({
          tone: "info",
          title: "Handoff",
          html: `Method: ${esc(input.handoffMethodLabel)}.`,
        }),
    detailList([{ label: "Reference", value: esc(input.reference) }]),
    small(
      "Follow this delivery with the private tracking link in your Couranr confirmation email. Keep that link private. Arrival times are estimates and can shift with traffic.",
    ),
  ].join("\n");

  return renderEmail(config, {
    subject: "On the way — your Couranr delivery",
    preheader: "A Couranr driver is on the way to you.",
    contentHtml: content,
  });
}

/** 4 · Delivered. */
export function consumerRecipientDelivered(
  config: EmailConfig,
  input: ConsumerRecipientDeliveredInput,
): RenderedEmail {
  const sender = input.senderName ? esc(input.senderName) : "the sender";
  const content = [
    eyebrow("Delivered"),
    h1("Your delivery arrived"),
    panel({
      tone: "success",
      title: "Delivered",
      html: `Completed ${esc(input.deliveredAtLabel)}.`,
    }),
    paragraph(`${hi(input.recipientName)}the delivery ${sender} sent you is complete.`),
    detailList([
      { label: "Reference", value: esc(input.reference) },
      { label: "Delivered", value: esc(input.deliveredAtLabel) },
    ]),
    small(
      "Proof of delivery is on the private tracking link in your Couranr confirmation email. Questions about this delivery? Just reply and Couranr Support will help.",
    ),
  ].join("\n");

  return renderEmail(config, {
    subject: "Delivered — your Couranr delivery",
    preheader: `Your Couranr delivery arrived ${input.deliveredAtLabel}.`,
    contentHtml: content,
  });
}


/** Recipient exception — the handoff could not be completed. */
export function consumerRecipientHandoffFailed(
  config: EmailConfig,
  input: ConsumerRecipientHandoffFailedInput,
): RenderedEmail {
  const sender = input.senderName ? esc(input.senderName) : "the sender";
  const content = [
    eyebrow(EYEBROW),
    h1("Couranr couldn't complete the handoff"),
    paragraph(`${hi(input.recipientName)}Couranr could not complete the delivery ${sender} sent you.`),
    panel({ tone: "warning", title: "What happened", html: esc(input.reasonLabel) }),
    detailList([{ label: "Reference", value: esc(input.reference) }]),
    small("Couranr also notified the sender. Reply to this email for delivery help, and keep your private tracking link for status updates."),
  ].join("\n");
  return renderEmail(config, {
    subject: "Action needed — your Couranr delivery",
    preheader: "Couranr couldn't complete the handoff.",
    contentHtml: content,
  });
}

/** Recipient exception — the shipment is returning to its sender. */
export function consumerRecipientReturnNotice(
  config: EmailConfig,
  input: ConsumerRecipientReturnNoticeInput,
): RenderedEmail {
  const sender = input.senderName ? esc(input.senderName) : "the sender";
  const content = [
    eyebrow(EYEBROW),
    h1("This delivery is being returned"),
    paragraph(`${hi(input.recipientName)}the delivery ${sender} sent you is being returned.`),
    panel({ tone: "neutral", title: "Reason", html: esc(input.reasonLabel) }),
    detailList([{ label: "Reference", value: esc(input.reference) }]),
    small("Couranr also notified the sender. Reply to this email if you need delivery help."),
  ].join("\n");
  return renderEmail(config, {
    subject: "Returning — your Couranr delivery",
    preheader: "The delivery is being returned to its sender.",
    contentHtml: content,
  });
}
