"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const MAX_MILES = 40;
const MAX_WEIGHT = 80;
const MAX_VALUE = 300;
const STOP_FEE = 6;

function isWithinBusinessHours(d: Date) {
  const h = d.getHours();
  return h >= 9 && h < 18;
}

function isAfterCutoff(d: Date) {
  const h = d.getHours();
  const m = d.getMinutes();
  return h > 16 || (h === 16 && m >= 0);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default function CheckoutClient() {
  const sp = useSearchParams();

  const miles = Number(sp.get("miles") ?? "0");
  const weight = Number(sp.get("weight") ?? "0");
  const declaredValue = Number(sp.get("value") ?? "0");
  const extraStops = clamp(Number(sp.get("extraStops") ?? "0"), 0, 3);

  const rush = sp.get("rush") === "1";
  const signature = sp.get("signature") === "1";

  const timingParam = (sp.get("timing") ?? "now") as "now" | "later";
  const date = sp.get("date") ?? "";
  const window = sp.get("window") ?? "";

  const price = Number(sp.get("price") ?? "0");

  const now = new Date();
  const withinHours = isWithinBusinessHours(now);
  const afterCutoff = isAfterCutoff(now);

  const effectiveTiming = useMemo(() => {
    // Enforce: "now" not allowed outside hours or after cutoff
    if (!withinHours || afterCutoff) return "later";
    return timingParam;
  }, [timingParam, withinHours, afterCutoff]);

  const [confirmAccurate, setConfirmAccurate] = useState(false);
  const [acceptPolicy, setAcceptPolicy] = useState(false);

  const violations = useMemo(() => {
    const v: string[] = [];
    if (miles > MAX_MILES) v.push(`Distance exceeds ${MAX_MILES} miles. Use Special Request.`);
    if (weight > MAX_WEIGHT) v.push(`Weight exceeds ${MAX_WEIGHT} lbs. Use Special Request.`);
    if (declaredValue > MAX_VALUE) v.push(`Declared value exceeds $${MAX_VALUE}. Use Special Request.`);
    if (extraStops > 3) v.push("More than 3 additional stops requires Special Request.");
    return v;
  }, [miles, weight, declaredValue, extraStops]);

  const canProceed =
    violations.length === 0 &&
    confirmAccurate &&
    acceptPolicy;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
      <h1 style={{ margin: 0, fontSize: 32, letterSpacing: "-0.02em" }}>
        Checkout
      </h1>
      <p style={{ marginTop: 10, color: "#444", lineHeight: 1.6 }}>
        Confirm details, then proceed to payment authorization. Payment is
        captured only after verified delivery completion.
      </p>

      {(!withinHours || afterCutoff) && (
        <div style={banner}>
          <strong>Timing update:</strong>{" "}
          {withinHours && afterCutoff
            ? "It’s after 4:00 PM. This order will be scheduled for the next business day."
            : "Outside business hours. This order will be scheduled for the next business day."}
        </div>
      )}

      <div style={{ marginTop: 18, ...card }}>
        <div style={sectionTitle}>Order Summary</div>

        <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
          <Row k="Miles" v={miles ? miles.toFixed(2) : "—"} />
          <Row k="Weight" v={weight ? `${weight} lbs` : "—"} />
          <Row k="Declared value" v={declaredValue ? `$${declaredValue}` : "—"} />
          <Row k="Additional stops" v={`${extraStops} (+$${STOP_FEE} each)`} />
          <Row k="Rush" v={rush ? "Yes" : "No"} />
          <Row k="Signature" v={signature ? "Yes" : "No"} />
          <Row
            k="Timing"
            v={
              effectiveTiming === "now"
                ? "Now (ASAP during business hours)"
                : `Scheduled • ${date || "next business day"} • ${window || "window"}`
            }
          />
          <Row k="Total" v={`$${price.toFixed(2)}`} strong />
        </div>
      </div>

      {violations.length > 0 && (
        <div style={{ marginTop: 14, ...warn }}>
          <strong>Checkout blocked:</strong>
          <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18 }}>
            {violations.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link href="/courier" style={ghostBtn}>Back to quote</Link>
            <Link href="/courier/special-request" style={ghostBtn}>
              Special Request
            </Link>
          </div>
        </div>
      )}

      <div style={{ marginTop: 14, ...card }}>
        <div style={sectionTitle}>Required confirmations</div>

        <label style={checkRow}>
          <input
            type="checkbox"
            checked={confirmAccurate}
            onChange={(e) => setConfirmAccurate(e.target.checked)}
          />
          <span>
            I confirm item details (weight, value, and contents) are accurate. Misdeclared items may be refused.
          </span>
        </label>

        <label style={checkRow}>
          <input
            type="checkbox"
            checked={acceptPolicy}
            onChange={(e) => setAcceptPolicy(e.target.checked)}
          />
          <span>
            I agree to the{" "}
            <Link href="/policy/delivery" style={link}>
              Couranr Delivery Service Policy
            </Link>
            .
          </span>
        </label>

        <div style={{ marginTop: 14, color: "#6b7280", fontSize: 13, lineHeight: 1.55 }}>
          Note: Orders placed after 4:00 PM are scheduled for the next business day by default.
          Delivery times may vary due to traffic, weather, accidents, or other conditions beyond our control.
        </div>

        <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/courier" style={ghostBtn}>
            Edit quote
          </Link>

          {!canProceed ? (
            <span style={disabledBtn} aria-disabled="true">
              Continue to payment
            </span>
          ) : (
            <Link href={`/courier/checkout/payment?${sp.toString()}`} style={primaryBtn}>
              Continue to payment
            </Link>
          )}
        </div>
      </div>

      <div style={{ marginTop: 18, color: "#6b7280", fontSize: 13 }}>
        After payment authorization, you’ll enter recipient details and upload required photos (pickup by customer, drop-off by driver).
      </div>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <div style={{ color: "#6b7280", fontWeight: 700 }}>{k}</div>
      <div style={{ fontWeight: strong ? 900 : 700 }}>{v}</div>
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 18,
  background: "#fff",
};

const sectionTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 900,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const checkRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  marginTop: 12,
  alignItems: "flex-start",
  color: "#111",
  lineHeight: 1.5,
};

const link: React.CSSProperties = {
  color: "#2563eb",
  fontWeight: 800,
  textDecoration: "none",
};

const primaryBtn: React.CSSProperties = {
  padding: "12px 16px",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  fontWeight: 900,
  textDecoration: "none",
};

const ghostBtn: React.CSSProperties = {
  padding: "12px 16px",
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  borderRadius: 10,
  fontWeight: 900,
  textDecoration: "none",
};

const disabledBtn: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 10,
  fontWeight: 900,
  background: "#e5e7eb",
  color: "#6b7280",
};

const warn: React.CSSProperties = {
  border: "1px solid #fecaca",
  background: "#fff1f2",
  borderRadius: 14,
  padding: 12,
  color: "#7f1d1d",
};

const banner: React.CSSProperties = {
  marginTop: 14,
  border: "1px solid #fde68a",
  background: "#fffbeb",
  borderRadius: 14,
  padding: 12,
  color: "#92400e",
};