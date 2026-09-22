import type { EmailConfig } from "../theme";
import type { RenderedEmail } from "../types";
import { renderEmail, eyebrow, h1, paragraph, detailList, button, fallbackLink, esc, small } from "../primitives";

export type DriverDispatchInput = {
  audience: "sender" | "recipient" | "merchant";
  reference: string;
  driverName: string;
  /** Absolute, Couranr-owned public portrait URL. Never a signed proof URL. */
  driverPortraitUrl: string | null;
  statusUrl?: string | null;
  replacement: boolean;
};

/** The same assignment identity snapshot as tracking; no phone or credential. */
export function driverDispatched(config: EmailConfig, input: DriverDispatchInput): RenderedEmail {
  const changed = input.replacement;
  const title = changed ? "Your Couranr driver has changed" : "Your Couranr driver is assigned";
  const body = input.audience === "recipient"
    ? "Couranr has assigned a driver to your delivery. Keep your private tracking link from the confirmation email to follow its progress."
    : "Couranr has assigned a driver to this delivery. You can follow its progress from your Couranr status page.";
  const portrait = input.driverPortraitUrl && /^https:\/\//.test(input.driverPortraitUrl)
    ? `<img src="${esc(input.driverPortraitUrl)}" width="96" height="96" alt="Portrait of ${esc(input.driverName)}" style="display:block;border:0;border-radius:48px;object-fit:cover;margin:18px 0;" />`
    : "";
  const content = [
    eyebrow("Couranr delivery"), h1(title), paragraph(body), portrait,
    detailList([
      { label: "Driver", value: esc(input.driverName) },
      { label: "Reference", value: esc(input.reference) },
    ]),
    input.statusUrl ? button({ label: "View delivery status", href: input.statusUrl }) : "",
    input.statusUrl ? fallbackLink(input.statusUrl) : "",
    small("Assignments may change before pickup. Couranr's current status page has the latest driver. Driver phone numbers are not shared."),
  ].join("\n");
  return renderEmail(config, {
    subject: `${title} — ${input.reference}`,
    preheader: `${input.driverName} is assigned to your Couranr delivery.`,
    contentHtml: content,
  });
}
