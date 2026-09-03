import { describe, it, expect } from "vitest";
import {
  defaultEmailConfig,
  bizWorkspaceCreated,
  bizActivationApproved,
  bizQuoteReady,
  bizPaymentReceipt,
  bizReviewOutcome,
  bizDeliveredReceipt,
  bizActionNeeded,
  custApproveAndPay,
  custOrderConfirmed,
  custOutForDelivery,
  custDelivered,
  custRecipientUnavailable,
  custReturnNotice,
  allAuthEmails,
  type RenderedEmail,
} from "@/lib/couranr/email";
import { buildSamples } from "@/lib/couranr/email/sampleData";

const cfg = defaultEmailConfig;
const s = buildSamples(cfg);

const businessEmails: RenderedEmail[] = [
  bizWorkspaceCreated(cfg, s.business.workspaceCreated),
  bizActivationApproved(cfg, s.business.activationApproved),
  bizQuoteReady(cfg, s.business.quoteReady),
  bizPaymentReceipt(cfg, s.business.paymentReceipt),
  bizReviewOutcome(cfg, s.business.reviewConfirmed),
  bizReviewOutcome(cfg, s.business.reviewRequote),
  bizReviewOutcome(cfg, s.business.reviewDeclined),
  bizDeliveredReceipt(cfg, s.business.deliveredReceipt),
  bizActionNeeded(cfg, s.business.actionNeeded),
];

const customerEmails: RenderedEmail[] = [
  custApproveAndPay(cfg, s.customer.approveAndPay),
  custOrderConfirmed(cfg, s.customer.orderConfirmed),
  custOutForDelivery(cfg, s.customer.outForDelivery),
  custDelivered(cfg, s.customer.delivered),
  custRecipientUnavailable(cfg, s.customer.recipientUnavailable),
  custReturnNotice(cfg, s.customer.returnNotice),
];

const all = [...businessEmails, ...customerEmails];

describe("Couranr email — envelope", () => {
  it("sends from the DKIM-verified subdomain, never the unverified apex", () => {
    for (const e of all) {
      expect(e.from).toContain("<no-reply@mail.couranr.com>");
      expect(e.from).not.toContain("@couranr.com>"); // apex would end exactly like this
    }
  });

  it("routes every reply to Couranr Support (the iCloud inbox)", () => {
    for (const e of all) expect(e.replyTo).toBe("support@couranr.com");
  });

  it("has a non-empty subject and preheader on every email", () => {
    for (const e of all) {
      expect(e.subject.length).toBeGreaterThan(0);
      expect(e.preheader.length).toBeGreaterThan(0);
    }
  });
});

describe("Couranr email — voice/brand guardrails", () => {
  const forbidden = [/guarantee/i, /24\s*\/\s*7/i, /instant confirm/i, /\bmaryland\b/i, /money-?back/i];
  it("never makes a prohibited claim", () => {
    for (const e of all) {
      for (const rx of forbidden) {
        expect(rx.test(e.html), `${e.subject} violated ${rx}`).toBe(false);
      }
    }
  });
  it("uses the brand navy and gold and the real logo", () => {
    for (const e of all) {
      expect(e.html).toContain("#0D1525"); // navy
      expect(e.html).toContain("#F4B740"); // gold accent / CTA
      expect(e.html.toLowerCase()).toContain("couranr-logo-primary");
    }
  });
});

describe("Couranr email — customer mail is sent for the shop", () => {
  it("labels the From as '<Shop> via Couranr' and names the shop", () => {
    for (const e of customerEmails) {
      expect(e.from).toContain("Bloom & Co via Couranr <no-reply@mail.couranr.com>");
      expect(e.html).toContain("Bloom &amp; Co");
    }
  });
  it("never puts a handoff code in the email body", () => {
    const out = custOutForDelivery(cfg, s.customer.outForDelivery);
    expect(out.html.toLowerCase()).toContain("tracking page");
    expect(out.html).not.toMatch(/\bPIN[:=]?\s*\d/);
  });
});

describe("Couranr email — money renders correctly", () => {
  it("shows Pricing V2 line items and the total", () => {
    const q = bizQuoteReady(cfg, s.business.quoteReady);
    expect(q.html).toContain("$7.99"); // base
    expect(q.html).toContain("$13.99"); // total
    const r = bizPaymentReceipt(cfg, s.business.paymentReceipt);
    expect(r.html).toContain("$13.99");
  });
});

describe("Couranr email — Supabase auth templates", () => {
  const auth = allAuthEmails(cfg);
  it("renders all six with subjects", () => {
    expect(auth.map((a) => a.key).sort()).toEqual(
      ["change_email", "confirm_signup", "invite", "magic_link", "reauthentication", "reset_password"].sort(),
    );
    for (const a of auth) expect(a.subject.length).toBeGreaterThan(0);
  });
  it("uses the CROSS-BROWSER token_hash route, never the browser-bound ConfirmationURL", () => {
    // Every link-based auth email must point at /auth/confirm (verifyOtp),
    // not {{ .ConfirmationURL }} (PKCE code — only works in the origin browser).
    const linkTemplates = auth.filter((a) => a.key !== "reauthentication");
    for (const a of linkTemplates) {
      expect(a.html, `${a.key} must link to the token_hash confirm route`).toContain(
        "/auth/confirm?token_hash={{ .TokenHash }}",
      );
      expect(a.html, `${a.key} must NOT use the browser-bound ConfirmationURL`).not.toContain(
        "{{ .ConfirmationURL }}",
      );
    }
    // verifyOtp `type` must match each template.
    expect(auth.find((a) => a.key === "confirm_signup")!.html).toContain("type=email");
    expect(auth.find((a) => a.key === "magic_link")!.html).toContain("type=email");
    expect(auth.find((a) => a.key === "reset_password")!.html).toContain("type=recovery");
    expect(auth.find((a) => a.key === "invite")!.html).toContain("type=invite");
    expect(auth.find((a) => a.key === "change_email")!.html).toContain("type=email_change");
  });

  it("keeps other Supabase variables literal (not HTML-escaped)", () => {
    expect(auth.find((a) => a.key === "reauthentication")!.html).toContain("{{ .Token }}");
    expect(auth.find((a) => a.key === "change_email")!.html).toContain("{{ .NewEmail }}");
  });
});
