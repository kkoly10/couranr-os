/**
 * Renders a self-contained gallery of every Couranr email with sample data,
 * for visual review. Nothing here sends mail. Consumed by
 * scripts/emailPreview.mjs, which inlines the real logo as data-URIs so the
 * gallery renders the actual brand mark in a browser.
 */

import { EmailConfig, COLORS, FONTS } from "./theme";
import { buildSamples } from "./sampleData";
import {
  bizWorkspaceCreated,
  bizActivationApproved,
  bizQuoteReady,
  bizPaymentReceipt,
  bizReviewOutcome,
  bizDeliveredReceipt,
  bizActionNeeded,
} from "./templates/business";
import {
  custApproveAndPay,
  custOrderConfirmed,
  custOutForDelivery,
  custDelivered,
  custRecipientUnavailable,
  custReturnNotice,
} from "./templates/customer";
import { allAuthEmails } from "./templates/supabaseAuth";

interface Entry {
  group: string;
  title: string;
  subject: string;
  from: string;
  html: string;
}

export function collectEmails(config: EmailConfig): Entry[] {
  const s = buildSamples(config);
  const biz = "Couranr → Business";
  const cust = "Business → Customer";
  const auth = "Supabase Auth";

  const entries: Entry[] = [];
  const push = (group: string, title: string, r: { subject: string; from?: string; html: string }) =>
    entries.push({ group, title, subject: r.subject, from: r.from ?? "Supabase SMTP (set to Couranr)", html: r.html });

  push(biz, "Workspace created (welcome)", bizWorkspaceCreated(config, s.business.workspaceCreated));
  push(biz, "Live activation approved", bizActivationApproved(config, s.business.activationApproved));
  push(biz, "Quote ready — approve & pay", bizQuoteReady(config, s.business.quoteReady));
  push(biz, "Payment receipt", bizPaymentReceipt(config, s.business.paymentReceipt));
  push(biz, "Review outcome — confirmed", bizReviewOutcome(config, s.business.reviewConfirmed));
  push(biz, "Review outcome — updated quote", bizReviewOutcome(config, s.business.reviewRequote));
  push(biz, "Review outcome — couldn't confirm", bizReviewOutcome(config, s.business.reviewDeclined));
  push(biz, "Delivered — proof receipt", bizDeliveredReceipt(config, s.business.deliveredReceipt));
  push(biz, "Action needed", bizActionNeeded(config, s.business.actionNeeded));

  push(cust, "Approve & pay (customer-paid)", custApproveAndPay(config, s.customer.approveAndPay));
  push(cust, "Order confirmed & scheduled", custOrderConfirmed(config, s.customer.orderConfirmed));
  push(cust, "Out for delivery", custOutForDelivery(config, s.customer.outForDelivery));
  push(cust, "Delivered", custDelivered(config, s.customer.delivered));
  push(cust, "Recipient unavailable", custRecipientUnavailable(config, s.customer.recipientUnavailable));
  push(cust, "Return notice", custReturnNotice(config, s.customer.returnNotice));

  for (const a of allAuthEmails(config)) {
    push(auth, a.key.replace(/_/g, " "), { subject: a.subject, html: a.html });
  }

  return entries;
}

export function renderGallery(config: EmailConfig): string {
  const entries = collectEmails(config);
  const groups = Array.from(new Set(entries.map((e) => e.group)));
  const payload = JSON.stringify(
    entries.map((e, i) => ({ id: `frame-${i}`, html: e.html })),
  ).replace(/<\//g, "<\\/");

  const nav = groups
    .map((g) => {
      const count = entries.filter((e) => e.group === g).length;
      return `<a href="#${slug(g)}" style="color:${COLORS.textInverseMuted};text-decoration:none;font-size:13px;">${escapeHtml(g)} <span style="color:${COLORS.gold};">${count}</span></a>`;
    })
    .join('<span style="color:#33415560;">·</span>');

  let idx = 0;
  const sections = groups
    .map((g) => {
      const cards = entries
        .filter((e) => e.group === g)
        .map((e) => {
          const id = `frame-${idx++}`;
          return `
          <div style="margin:0 0 30px 0;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin:0 0 10px 2px;flex-wrap:wrap;">
              <div style="font-family:${FONTS.body};font-size:15px;font-weight:700;color:${COLORS.navy};">${escapeHtml(e.title)}</div>
              <div style="font-family:${FONTS.mono};font-size:11px;color:${COLORS.textMuted};">${escapeHtml(e.from)}</div>
            </div>
            <div style="font-family:${FONTS.body};font-size:13px;color:${COLORS.textMuted};margin:0 0 10px 2px;">
              <span style="color:${COLORS.textSubtle};">Subject:</span> ${escapeHtml(e.subject)}
            </div>
            <div style="border:1px solid ${COLORS.border};border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(13,21,37,.06);background:${COLORS.canvas};">
              <iframe id="${id}" title="${escapeHtml(e.title)}" style="width:100%;border:0;display:block;height:640px;background:${COLORS.canvas};" scrolling="no"></iframe>
            </div>
          </div>`;
        })
        .join("");
      return `
      <section id="${slug(g)}" style="margin:0 0 20px 0;">
        <h2 style="font-family:${FONTS.body};font-size:13px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${COLORS.textMuted};margin:34px 0 18px 2px;">${escapeHtml(g)}</h2>
        ${cards}
      </section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Couranr · email preview</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  body{ margin:0; background:${COLORS.surfaceSunken}; }
  .wrap{ max-width:760px; margin:0 auto; padding:0 18px 80px 18px; }
  a:hover{ text-decoration:underline!important; }
</style>
</head>
<body>
  <div style="background:${COLORS.navy};position:sticky;top:0;z-index:10;box-shadow:0 1px 0 rgba(0,0,0,.2);">
    <div class="wrap" style="padding-top:16px;padding-bottom:16px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="${escapeHtml(config.assets.logoDarkUrl)}" alt="Couranr" style="height:22px;width:auto;">
        <span style="font-family:${FONTS.body};font-size:13px;color:${COLORS.textInverseMuted};">email preview · ${entries.length} templates</span>
      </div>
      <nav style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">${nav}</nav>
    </div>
  </div>
  <div class="wrap">
    <p style="font-family:${FONTS.body};font-size:13px;color:${COLORS.textMuted};margin:22px 2px 0 2px;line-height:1.6;">
      Rendered from <code style="font-family:${FONTS.mono};">lib/couranr/email</code> with sample data. Reply-To on every message is
      <strong style="color:${COLORS.navy};">${escapeHtml(config.replyToEmail)}</strong>. Nothing here is sent.
    </p>
    ${sections}
  </div>
  <script>
    var EMAILS = ${payload};
    EMAILS.forEach(function(e){
      var f = document.getElementById(e.id);
      if(!f) return;
      f.addEventListener('load', function(){
        try { f.style.height = (f.contentWindow.document.body.scrollHeight + 2) + 'px'; } catch(_){}
      });
      f.srcdoc = e.html;
    });
  </script>
</body>
</html>`;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
