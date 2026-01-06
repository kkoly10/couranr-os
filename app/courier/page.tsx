"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

const BASE_FEE = 0;
const FREE_MILES = 3;
const PER_MILE = 1.75;

const MAX_MILES = 40;
const MAX_WEIGHT = 80;
const MAX_VALUE = 300;

const STOP_FEE = 6;

const RUSH_FEE = 15;
const SIGNATURE_FEE = 5;

type TimingMode = "now" | "later";
type TimeWindow = "9-11" | "11-1" | "1-3" | "3-6";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isWithinBusinessHours(d: Date) {
  const h = d.getHours();
  return h >= 9 && h < 18;
}

function isAfterCutoff(d: Date) {
  // cutoff at 4:00 PM local
  const h = d.getHours();
  const m = d.getMinutes();
  return h > 16 || (h === 16 && m >= 0);
}

function nextBusinessDayISO(d: Date) {
  const nd = new Date(d);
  nd.setDate(nd.getDate() + 1);
  // keep simple v1: allow any next day (no weekend logic yet)
  return nd.toISOString().slice(0, 10);
}

function money(amount: number) {
  return `$${amount.toFixed(2)}`;
}

export default function CourierQuotePage() {
  // v1: miles is manually entered (until you wire Maps again)
  const [miles, setMiles] = useState<number>(5);
  const [weight, setWeight] = useState<number>(20);
  const [declaredValue, setDeclaredValue] = useState<number>(50);

  const [extraStops, setExtraStops] = useState<number>(0); // additional stops beyond pickup+dropoff
  const [rush, setRush] = useState(false);
  const [signature, setSignature] = useState(false);

  const now = new Date();
  const withinHours = isWithinBusinessHours(now);
  const afterCutoff = isAfterCutoff(now);

  const [timing, setTiming] = useState<TimingMode>(() => {
    // Default: if after cutoff or outside hours, push to later
    return withinHours && !afterCutoff ? "now" : "later";
  });

  const [scheduleDate, setScheduleDate] = useState<string>(() =>
    nextBusinessDayISO(now)
  );
  const [window, setWindow] = useState<TimeWindow>("9-11");

  const violations = useMemo(() => {
    const v: string[] = [];
    if (miles > MAX_MILES) v.push(`Over ${MAX_MILES} miles requires Special Request.`);
    if (weight > MAX_WEIGHT) v.push(`Over ${MAX_WEIGHT} lbs requires Special Request.`);
    if (declaredValue > MAX_VALUE) v.push(`Over $${MAX_VALUE} value requires Special Request.`);
    if (extraStops > 3) v.push("More than 3 additional stops requires Special Request.");
    return v;
  }, [miles, weight, declaredValue, extraStops]);

  const effectiveTiming: TimingMode = useMemo(() => {
    // Enforce: after 4pm or outside hours, "now" not allowed
    if (!withinHours || afterCutoff) return "later";
    return timing;
  }, [timing, withinHours, afterCutoff]);

  const price = useMemo(() => {
    const billableMiles = Math.max(0, miles - FREE_MILES);
    const distanceFee = billableMiles * PER_MILE;
    const weightFee = weight > 40 ? 15 : 0; // 41–80 = +15; >80 blocked
    const stopsFee = STOP_FEE * clamp(extraStops, 0, 3);
    const rushFee = rush ? RUSH_FEE : 0;
    const sigFee = signature ? SIGNATURE_FEE : 0;

    return BASE_FEE + distanceFee + weightFee + stopsFee + rushFee + sigFee;
  }, [miles, weight, extraStops, rush, signature]);

  const checkoutHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("miles", miles.toFixed(2));
    params.set("weight", String(weight));
    params.set("value", String(declaredValue));
    params.set("extraStops", String(clamp(extraStops, 0, 3)));
    params.set("rush", rush ? "1" : "0");
    params.set("signature", signature ? "1" : "0");
    params.set("timing", effectiveTiming);

    if (effectiveTiming === "later") {
      params.set("date", scheduleDate);
      params.set("window", window);
    }

    params.set("price", price.toFixed(2));
    return `/courier/checkout?${params.toString()}`;
  }, [miles, weight, declaredValue, extraStops, rush, signature, effectiveTiming, scheduleDate, window, price]);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 24px" }}>
      <h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.02em" }}>
        Courier Delivery Quote
      </h1>
      <p style={{ marginTop: 10, color: "#444", lineHeight: 1.6 }}>
        Transparent pricing with clear limits. Base fee includes the first{" "}
        <strong>3 miles</strong>. Business hours: <strong>9am–6pm</strong>.
      </p>

      {(!withinHours || afterCutoff) && (
        <div style={banner}>
          <strong>Scheduling notice:</strong>{" "}
          {withinHours && afterCutoff
            ? "It’s after 4:00 PM. “Now” is disabled — orders will be scheduled for the next business day."
            : "Outside business hours. Orders will be scheduled for the next business day."}
        </div>
      )}

      <div style={grid}>
        <Card title="Inputs">
          <Field label="Distance (miles)">
            <input
              type="number"
              step="0.01"
              min={0}
              value={miles}
              onChange={(e) => setMiles(Number(e.target.value))}
              style={input}
            />
            <Small>
              Max standard distance: <strong>{MAX_MILES} miles</strong>
            </Small>
          </Field>

          <Field label="Weight (lbs)">
            <input
              type="number"
              min={0}
              value={weight}
              onChange={(e) => setWeight(Number(e.target.value))}
              style={input}
            />
            <Small>
              Max standard weight: <strong>{MAX_WEIGHT} lbs</strong>
            </Small>
          </Field>

          <Field label="Declared item value (USD)">
            <input
              type="number"
              min={0}
              value={declaredValue}
              onChange={(e) => setDeclaredValue(Number(e.target.value))}
              style={input}
            />
            <Small>
              Max standard value: <strong>${MAX_VALUE}</strong>
            </Small>
          </Field>

          <Field label="Additional stops">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setExtraStops((s) => clamp(s - 1, 0, 3))}
                style={miniBtn}
                type="button"
              >
                −
              </button>
              <div style={{ fontWeight: 700 }}>{clamp(extraStops, 0, 3)}</div>
              <button
                onClick={() => setExtraStops((s) => clamp(s + 1, 0, 3))}
                style={miniBtn}
                type="button"
              >
                +
              </button>
              <div style={{ color: "#555" }}>(+${STOP_FEE} each)</div>
            </div>
            <Small>
              Includes 1 pickup + 1 drop-off. Each extra stop is ${STOP_FEE}.
            </Small>
          </Field>

          <Field label="Delivery timing">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Toggle
                active={effectiveTiming === "now"}
                disabled={!withinHours || afterCutoff}
                onClick={() => setTiming("now")}
                label="Now (ASAP)"
              />
              <Toggle
                active={effectiveTiming === "later"}
                disabled={false}
                onClick={() => setTiming("later")}
                label="Later (Schedule)"
              />
            </div>

            {effectiveTiming === "later" && (
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <div>
                  <div style={label}>Date</div>
                  <input
                    type="date"
                    value={scheduleDate}
                    min={nextBusinessDayISO(now)}
                    max={(() => {
                      const d = new Date(now);
                      d.setDate(d.getDate() + 7);
                      return d.toISOString().slice(0, 10);
                    })()}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    style={input}
                  />
                  <Small>7-day rolling window</Small>
                </div>

                <div>
                  <div style={label}>Time window</div>
                  <select
                    value={window}
                    onChange={(e) => setWindow(e.target.value as TimeWindow)}
                    style={input}
                  >
                    <option value="9-11">9:00–11:00</option>
                    <option value="11-1">11:00–1:00</option>
                    <option value="1-3">1:00–3:00</option>
                    <option value="3-6">3:00–6:00</option>
                  </select>
                  <Small>Exact delivery times are not guaranteed.</Small>
                </div>
              </div>
            )}
          </Field>

          <Field label="Options">
            <label style={checkRow}>
              <input
                type="checkbox"
                checked={rush}
                onChange={(e) => setRush(e.target.checked)}
              />
              <span>
                Rush (+${RUSH_FEE}){" "}
                <span style={{ color: "#6b7280" }}>
                  — Same-day within ~2 hours (availability)
                </span>
              </span>
            </label>

            <label style={checkRow}>
              <input
                type="checkbox"
                checked={signature}
                onChange={(e) => setSignature(e.target.checked)}
              />
              <span>
                Signature required (+${SIGNATURE_FEE}){" "}
                <span style={{ color: "#6b7280" }}>
                  — Recommended for higher value items
                </span>
              </span>
            </label>
          </Field>
        </Card>

        <Card title="Price">
          <Breakdown
            miles={miles}
            weight={weight}
            extraStops={clamp(extraStops, 0, 3)}
            rush={rush}
            signature={signature}
            timing={effectiveTiming}
            scheduleDate={scheduleDate}
            window={window}
            total={price}
          />

          {violations.length > 0 ? (
            <div style={{ marginTop: 14, ...warn }}>
              <strong>Not eligible for instant checkout:</strong>
              <ul style={{ marginTop: 8, marginBottom: 0, paddingLeft: 18 }}>
                {violations.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <div style={{ marginTop: 10 }}>
                <Link href="/courier/special-request" style={linkBtn}>
                  Submit Special Request
                </Link>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 14, display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href={checkoutHref} style={primaryBtn}>
                Continue to checkout
              </Link>
              <Link href="/policy/delivery" style={ghostBtn}>
                View service policy
              </Link>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Breakdown(props: {
  miles: number;
  weight: number;
  extraStops: number;
  rush: boolean;
  signature: boolean;
  timing: TimingMode;
  scheduleDate: string;
  window: string;
  total: number;
}) {
  const billableMiles = Math.max(0, props.miles - FREE_MILES);
  const distanceFee = billableMiles * PER_MILE;
  const weightFee = props.weight > 40 ? 15 : 0;
  const stopsFee = props.extraStops * STOP_FEE;
  const rushFee = props.rush ? RUSH_FEE : 0;
  const sigFee = props.signature ? SIGNATURE_FEE : 0;

  return (
    <div>
      <div style={{ fontWeight: 800, fontSize: 22 }}>{money(props.total)}</div>
      <div style={{ marginTop: 10, color: "#555", lineHeight: 1.6 }}>
        Base fee {money(BASE_FEE)} (includes first {FREE_MILES} miles)
        <br />
        Distance fee {money(distanceFee)} ({billableMiles.toFixed(2)} mi × {money(PER_MILE)})
        <br />
        Weight fee {money(weightFee)} {props.weight > 40 ? "(41–80 lbs)" : "(0–40 lbs)"}
        <br />
        Stops fee {money(stopsFee)} ({props.extraStops} × ${STOP_FEE})
        <br />
        Rush {money(rushFee)} {props.rush ? "" : "(off)"}
        <br />
        Signature {money(sigFee)} {props.signature ? "" : "(off)"}
      </div>

      <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #e5e7eb", color: "#444" }}>
        <div style={{ fontWeight: 700 }}>Timing</div>
        {props.timing === "now" ? (
          <div style={{ color: "#555" }}>Now (ASAP during business hours)</div>
        ) : (
          <div style={{ color: "#555" }}>
            Scheduled: <strong>{props.scheduleDate}</strong> • Window{" "}
            <strong>{props.window}</strong>
          </div>
        )}
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 14, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {title}
      </div>
      <div style={{ marginTop: 14 }}>{children}</div>
    </div>
  );
}

function Field({ label: lab, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={label}>{lab}</div>
      <div style={{ marginTop: 8 }}>{children}</div>
    </div>
  );
}

function Small({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 6, fontSize: 12, color: "#6b7280" }}>{children}</div>;
}

function Toggle({
  active,
  disabled,
  onClick,
  label,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      style={{
        padding: "10px 12px",
        borderRadius: 999,
        border: "1px solid " + (active ? "#2563eb" : "#d1d5db"),
        background: active ? "#dbeafe" : "#fff",
        fontWeight: 700,
        color: disabled ? "#9ca3af" : "#111",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
      aria-disabled={disabled}
    >
      {label}
    </button>
  );
}

const grid: React.CSSProperties = {
  marginTop: 18,
  display: "grid",
  gridTemplateColumns: "1.2fr 0.8fr",
  gap: 16,
};

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 18,
  background: "#fff",
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  outline: "none",
};

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#111",
};

const miniBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
  fontWeight: 900,
};

const checkRow: React.CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  color: "#111",
};

const primaryBtn: React.CSSProperties = {
  padding: "12px 16px",
  background: "#2563eb",
  color: "#fff",
  borderRadius: 10,
  fontWeight: 800,
  textDecoration: "none",
};

const ghostBtn: React.CSSProperties = {
  padding: "12px 16px",
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  borderRadius: 10,
  fontWeight: 800,
  textDecoration: "none",
};

const linkBtn: React.CSSProperties = {
  ...ghostBtn,
  display: "inline-block",
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