/**
 * Bulletproof HTML-email primitives for Couranr.
 *
 * Everything is table-based with inline styles so it survives Gmail, Apple
 * Mail, Outlook (incl. the Word engine) and mobile clients. A <style> block
 * adds Inter (Google Fonts), a mobile media query and light-mode locking, but
 * nothing depends on it — every element is also styled inline.
 */

import { COLORS, FONTS, RADII, EmailConfig, EmailTone } from "./theme";
import { Money, LineItem, RenderedEmail } from "./types";

/* ----------------------------- helpers ----------------------------- */

export function esc(input: string | number | undefined | null): string {
  if (input === undefined || input === null) return "";
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatMoney({ amountCents, currency }: Money): string {
  const value = amountCents / 100;
  const s = value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency === "USD" ? `$${s}` : `${s} ${esc(currency)}`;
}

const TONE: Record<EmailTone, { fg: string; bg: string }> = {
  neutral: { fg: COLORS.textSecondary, bg: COLORS.surfaceSunken },
  info: { fg: COLORS.info, bg: COLORS.infoBg },
  success: { fg: COLORS.success, bg: COLORS.successBg },
  warning: { fg: COLORS.warning, bg: COLORS.warningBg },
  danger: { fg: COLORS.danger, bg: COLORS.dangerBg },
};

/* --------------------------- typography ---------------------------- */

/** Small uppercase kicker above a heading. */
export function eyebrow(text: string): string {
  return `<p style="margin:0 0 10px 0;font-family:${FONTS.body};font-size:12px;line-height:1;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${COLORS.textMuted};">${esc(text)}</p>`;
}

export function h1(text: string): string {
  return `<h1 class="cr-h1" style="margin:0 0 14px 0;font-family:${FONTS.heading};font-size:26px;line-height:1.22;font-weight:700;letter-spacing:-0.02em;color:${COLORS.navy};">${esc(text)}</h1>`;
}

export function lead(html: string): string {
  return `<p style="margin:0 0 18px 0;font-family:${FONTS.body};font-size:17px;line-height:1.55;color:${COLORS.textSecondary};">${html}</p>`;
}

export function paragraph(html: string): string {
  return `<p style="margin:0 0 16px 0;font-family:${FONTS.body};font-size:15px;line-height:1.6;color:${COLORS.textSecondary};">${html}</p>`;
}

export function small(html: string): string {
  return `<p style="margin:0 0 8px 0;font-family:${FONTS.body};font-size:13px;line-height:1.55;color:${COLORS.textMuted};">${html}</p>`;
}

export function strongNavy(text: string): string {
  return `<span style="color:${COLORS.navy};font-weight:600;">${esc(text)}</span>`;
}

/* ----------------------------- button ------------------------------ */

export function button({
  label,
  href,
  variant = "primary",
}: {
  label: string;
  href: string;
  variant?: "primary" | "secondary";
}): string {
  const isPrimary = variant === "primary";
  const bg = isPrimary ? COLORS.gold : COLORS.surface;
  const fg = COLORS.navy;
  const border = isPrimary ? COLORS.gold : COLORS.borderStrong;
  return `
  <table role="presentation" class="cr-btn" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 8px 0;">
    <tr>
      <td align="center" bgcolor="${bg}" style="border-radius:${RADII.md};background:${bg};border:1px solid ${border};">
        <a href="${esc(href)}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${FONTS.body};font-size:15px;font-weight:600;line-height:1;color:${fg};text-decoration:none;border-radius:${RADII.md};">${esc(label)}</a>
      </td>
    </tr>
  </table>`;
}

/** A muted fallback link shown under a button (in case the button image/color
 * is stripped or the reader prefers to copy the URL). */
export function fallbackLink(href: string): string {
  return `<p style="margin:4px 0 4px 0;font-family:${FONTS.body};font-size:12px;line-height:1.5;color:${COLORS.textMuted};">Or copy this link: <a href="${esc(href)}" target="_blank" style="color:${COLORS.routeBlue};word-break:break-all;">${esc(href)}</a></p>`;
}

/* ------------------------------ panel ------------------------------ */

export function panel({
  tone = "neutral",
  title,
  html,
}: {
  tone?: EmailTone;
  title?: string;
  html: string;
}): string {
  const t = TONE[tone];
  const titleHtml = title
    ? `<p style="margin:0 0 6px 0;font-family:${FONTS.body};font-size:13px;font-weight:700;letter-spacing:0.02em;color:${t.fg};text-transform:uppercase;">${esc(title)}</p>`
    : "";
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 18px 0;">
    <tr>
      <td style="background:${t.bg};border-radius:${RADII.md};border-left:3px solid ${t.fg};padding:14px 18px;">
        ${titleHtml}
        <div style="font-family:${FONTS.body};font-size:14px;line-height:1.6;color:${COLORS.textSecondary};">${html}</div>
      </td>
    </tr>
  </table>`;
}

export function badge({ tone = "neutral", label }: { tone?: EmailTone; label: string }): string {
  const t = TONE[tone];
  return `<span style="display:inline-block;padding:5px 12px;border-radius:${RADII.pill};background:${t.bg};font-family:${FONTS.body};font-size:12px;font-weight:600;letter-spacing:0.02em;color:${t.fg};">${esc(label)}</span>`;
}

/** Monospaced boxed value for references / codes. */
export function codeChip(value: string): string {
  return `<span style="display:inline-block;padding:4px 10px;border-radius:${RADII.sm};background:${COLORS.surfaceSunken};border:1px solid ${COLORS.border};font-family:${FONTS.mono};font-size:13px;letter-spacing:0.04em;color:${COLORS.navy};">${esc(value)}</span>`;
}

export function divider(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:6px 0 18px 0;"><div style="height:1px;background:${COLORS.border};line-height:1px;font-size:1px;">&nbsp;</div></td></tr></table>`;
}

/* --------------------------- detail list --------------------------- */

/** Clean label/value rows for delivery details. */
export function detailList(rows: Array<{ label: string; value: string }>): string {
  const body = rows
    .filter((r) => r.value)
    .map(
      (r) => `
      <tr>
        <td style="padding:7px 16px 7px 0;font-family:${FONTS.body};font-size:13px;line-height:1.5;color:${COLORS.textMuted};vertical-align:top;white-space:nowrap;">${esc(r.label)}</td>
        <td style="padding:7px 0;font-family:${FONTS.body};font-size:14px;line-height:1.5;color:${COLORS.navy};vertical-align:top;text-align:left;">${r.value}</td>
      </tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 16px 0;">${body}</table>`;
}

/** Line-item receipt with a bold total. Amounts right-aligned. */
export function lineItemsTable(items: LineItem[], total: Money): string {
  const rows = items
    .map(
      (it) => `
      <tr>
        <td style="padding:7px 0;font-family:${FONTS.body};font-size:14px;line-height:1.5;color:${COLORS.textSecondary};vertical-align:top;">
          ${esc(it.label)}${it.note ? `<span style="display:block;font-size:12px;color:${COLORS.textMuted};">${esc(it.note)}</span>` : ""}
        </td>
        <td style="padding:7px 0;font-family:${FONTS.body};font-size:14px;line-height:1.5;color:${COLORS.navy};text-align:right;white-space:nowrap;vertical-align:top;">${formatMoney({ amountCents: it.amountCents, currency: total.currency })}</td>
      </tr>`,
    )
    .join("");
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0 18px 0;">
    ${rows}
    <tr><td colspan="2" style="padding:6px 0;"><div style="height:1px;background:${COLORS.border};line-height:1px;font-size:1px;">&nbsp;</div></td></tr>
    <tr>
      <td style="padding:2px 0;font-family:${FONTS.body};font-size:15px;font-weight:700;color:${COLORS.navy};">Total</td>
      <td style="padding:2px 0;font-family:${FONTS.body};font-size:16px;font-weight:700;color:${COLORS.navy};text-align:right;white-space:nowrap;">${formatMoney(total)}</td>
    </tr>
  </table>`;
}

export function spacer(px: number): string {
  return `<div style="height:${px}px;line-height:${px}px;font-size:1px;">&nbsp;</div>`;
}

/* --------------------------- the layout ---------------------------- */

function preheaderBlock(text: string): string {
  // Trailing zero-width + non-breaking chars push the "…rest of body" preview
  // text out of the snippet so only our sentence shows.
  const pad = "&nbsp;&zwnj;".repeat(60);
  return `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;height:0;width:0;">${esc(text)}${pad}</div>`;
}

function footer(config: EmailConfig): string {
  const { company, assets, supportEmail, tagline } = config;
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:26px 24px 8px 24px;">
        <img src="${esc(assets.iconUrl)}" width="26" height="26" alt="" style="width:26px;height:26px;border-radius:6px;margin:0 auto 12px auto;">
        <p style="margin:0 0 8px 0;font-family:${FONTS.body};font-size:13px;line-height:1.5;color:${COLORS.textMuted};">${esc(tagline)}</p>
        <p style="margin:0 0 8px 0;font-family:${FONTS.body};font-size:12px;line-height:1.55;color:${COLORS.textSubtle};">${esc(company.serviceArea)}</p>
        <p style="margin:0 0 4px 0;font-family:${FONTS.body};font-size:12px;line-height:1.5;color:${COLORS.textSubtle};">
          Questions? <a href="mailto:${esc(supportEmail)}" style="color:${COLORS.textMuted};text-decoration:underline;">${esc(supportEmail)}</a>
        </p>
        <p style="margin:0;font-family:${FONTS.body};font-size:12px;line-height:1.5;color:${COLORS.textSubtle};">${esc(company.addressLine)}</p>
      </td>
    </tr>
  </table>`;
}

export function layout({
  config,
  previewText,
  contentHtml,
}: {
  config: EmailConfig;
  previewText: string;
  contentHtml: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <title>${esc(config.brandName)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body,table,td,a{ -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
    table,td{ mso-table-lspace:0pt; mso-table-rspace:0pt; }
    img{ -ms-interpolation-mode:bicubic; border:0; height:auto; line-height:100%; outline:none; text-decoration:none; }
    body{ margin:0!important; padding:0!important; width:100%!important; background:${COLORS.canvas}; }
    a{ color:${COLORS.routeBlue}; }
    u + .body .cr-container{ width:600px; }
    @media only screen and (max-width:620px){
      .cr-container{ width:100%!important; }
      .cr-px{ padding-left:24px!important; padding-right:24px!important; }
      .cr-btn{ width:100%!important; }
      .cr-btn a{ display:block!important; text-align:center; }
      .cr-h1{ font-size:23px!important; }
    }
  </style>
</head>
<body class="body" style="margin:0;padding:0;background:${COLORS.canvas};">
  ${preheaderBlock(previewText)}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.canvas};">
    <tr>
      <td align="center" style="padding:30px 12px 40px 12px;">
        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
        <table role="presentation" class="cr-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
          <tr>
            <td style="padding:2px 6px 20px 6px;">
              <img src="${esc(config.assets.logoLightUrl)}" width="128" alt="${esc(config.brandName)}" style="width:128px;max-width:128px;height:auto;">
            </td>
          </tr>
          <tr>
            <td style="background:${COLORS.surface};border:1px solid ${COLORS.border};border-radius:${RADII.lg};overflow:hidden;">
              <div style="height:4px;background:${COLORS.gold};line-height:4px;font-size:4px;">&nbsp;</div>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="cr-px" style="padding:36px 38px 34px 38px;">
                    ${contentHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td>${footer(config)}</td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/* --------------------------- assembler ----------------------------- */

/**
 * Wrap composed content into a full RenderedEmail. `fromName` overrides the
 * display name (customer mail uses "Shop via Couranr"); the address always
 * stays on the verified sending domain.
 */
export function renderEmail(
  config: EmailConfig,
  {
    subject,
    preheader,
    contentHtml,
    fromName,
  }: { subject: string; preheader: string; contentHtml: string; fromName?: string },
): RenderedEmail {
  const displayName = fromName ?? config.fromName;
  return {
    subject,
    preheader,
    html: layout({ config, previewText: preheader, contentHtml }),
    from: `${displayName} <${config.fromEmail}>`,
    replyTo: config.replyToEmail,
  };
}

/** Greeting line, tolerant of a missing first name. */
export function greeting(name?: string): string {
  const who = name && name.trim() ? `, ${esc(name.trim())}` : "";
  return paragraph(`Hi${who} —`);
}
