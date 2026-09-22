import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { driverDispatched } from "@/lib/couranr/email/templates/driverDispatch";
import { defaultEmailConfig } from "@/lib/couranr/email/theme";
import { normalizeDriverPortrait } from "@/lib/couranr/driver/publicProfile";
import { tipIntentMetadata } from "@/lib/couranr/driver/feedback";

const root = path.resolve(__dirname, "..");
const source = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("approved public driver identity", () => {
  it("renders assignment identity in dispatch email without contact details", () => {
    const email = driverDispatched(defaultEmailConfig, {
      audience: "recipient",
      reference: "CR-1234",
      driverName: "Avery Driver",
      driverPortraitUrl: "https://www.couranr.com/api/couranr/driver-portrait/11111111-1111-4111-8111-111111111111",
      replacement: false,
    });
    expect(email.html).toContain("Avery Driver");
    expect(email.html).toContain("driver-portrait");
    expect(email.html.toLowerCase()).not.toContain("tel:");
    expect(email.html).not.toMatch(/\+1\d{10}/);
  });

  it("decodes and re-encodes raster input to one EXIF-free 512px JPEG", async () => {
    const input = await sharp({ create: { width: 32, height: 16, channels: 3, background: "#d89b00" } })
      .png().toBuffer();
    const output = await normalizeDriverPortrait(input);
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
    expect(meta.exif).toBeUndefined();
  });

  it("refuses active content instead of trusting a filename or MIME header", async () => {
    await expect(normalizeDriverPortrait(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')))
      .rejects.toThrow("portrait_format_invalid");
  });
});

describe("company-held voluntary driver tips", () => {
  it("puts only non-PII canonical identities in Stripe metadata", () => {
    expect(tipIntentMetadata({
      id: "tip-id", delivery_id: "delivery-id", driver_id: "driver-id",
      request_id: "request-id", amount_cents: 500, currency: "usd",
      provider_payment_intent_id: null, payment_state: "prepared", intent_generation: 0,
    })).toEqual({
      couranrTipId: "tip-id",
      couranrTipDeliveryId: "delivery-id",
      couranrTipDriverId: "driver-id",
    });
  });

  it("creates a separate automatic-capture PI with no Connect destination or payout", () => {
    const payment = source("lib/couranr/driver/feedback.ts");
    expect(payment).toContain('capture_method: "automatic"');
    expect(payment).toContain("couranr:driver-tip:");
    expect(payment).not.toMatch(/transfer_data|destination|on_behalf_of|application_fee/);
    expect(payment).not.toMatch(/transfers\.(create|update)|payouts\.(create|update)/);
  });

  it("books gross capture to tips payable and refund as a liability reversal", () => {
    const sql = source("supabase/migrations/20260922210000_couranr_driver_feedback_and_tips.sql");
    expect(sql).toContain("'stripe_clearing','side','debit'");
    expect(sql).toContain("'tips_payable','side','credit'");
    expect(sql).toContain("'tips_payable','side','debit'");
    expect(sql).toContain("'stripe_clearing','side','credit'");
    expect(sql).toContain("fulfillment_state<>'delivered'");
  });

  it("keeps closed non-loss disputes as history without weakening open/lost bounds", () => {
    const repair = source(
      "supabase/migrations/20260922213915_couranr_tip_closed_dispute_refund_repair.sql",
    );
    const rollback = source(
      "supabase/rollbacks/20260922213915_couranr_tip_closed_dispute_refund_repair.rollback.sql",
    );
    expect(repair).toContain(
      "v_dispute_closed_non_loss:=v_dispute_status in ('warning_closed','won','prevented')",
    );
    expect(repair).toContain(
      "not v_dispute_closed_non_loss and v_dispute_amount>v_capture-v_refund",
    );
    expect(repair).toContain("from public,anon,authenticated,service_role");
    expect(repair).toContain("lock table public.couranr_driver_tips in exclusive mode");
    expect(rollback).toContain("lock table public.couranr_driver_tips in exclusive mode");
    expect(rollback).toContain(
      "tip_closed_dispute_repair_rollback_refused_live_semantics_use_forward_repair",
    );
  });

  it("keeps the Operations report explicitly out of payroll execution", () => {
    const api = source("app/api/couranr/operations/driver-feedback/route.ts");
    expect(api).toContain("driver payment occurs outside this system");
    expect(api).not.toMatch(/stripe|payout|transfer_data/);
  });

  it("never tells a customer an ambiguous provider error means no charge occurred", () => {
    const payment = source("components/couranr/payments/DriverTipPaymentElement.tsx");
    expect(payment).not.toContain("The tip was not charged");
    expect(payment).toContain("a charge may have completed");
  });
});
