import Link from "next/link";
import {
  OPERATING_DAYS_COPY,
  OPERATING_WINDOW_COPY,
  SAME_DAY_CUTOFF_COPY,
  WEIGHT_INCLUDED_THROUGH_LB,
  WEIGHT_SURCHARGE_THROUGH_LB,
} from "@/lib/couranr/public/governed";
import {
  CONSUMER_MAX_DECLARED_VALUE_CENTS,
  declaredValueDollars,
} from "@/lib/couranr/consumer/protection";
import {
  LEGAL_DRAFTED_ON,
  SAME_DAY_SHIPMENT_TERMS_ID,
  legalDocumentHref,
} from "@/lib/couranr/legal/registry";

export default function DeliveryPolicyPage() {
  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 24px" }}>
      <h1 style={{ margin: 0, fontSize: 36, letterSpacing: "-0.02em" }}>
        Couranr Delivery — Service Policy
      </h1>
      <p style={{ marginTop: 10, color: "#444", lineHeight: 1.6 }}>
        This policy explains what we deliver, how scheduling works, and how we
        protect customers and drivers with verification and clear limits.
      </p>
      <p style={{ marginTop: 10, color: "#444", lineHeight: 1.6 }}>
        For a Couranr Same Day shipment the governing document is the{" "}
        <Link href={legalDocumentHref(SAME_DAY_SHIPMENT_TERMS_ID)}>
          Same Day Shipment Terms
        </Link>
        , which is the version a sender accepts and Couranr records. Where this
        page and that document differ, that document is the one that applies.
      </p>

      <Section title="Delivery Scope">
        Couranr Delivery provides local courier services for documents, packages,
        boxes, and everyday items within defined limits for weight, distance,
        value, and safety.
      </Section>

      {/* RECONCILED. This section published "80 lbs" and "$300" as the
          standard-checkout limits, and BOTH were unsourced: the root decision
          registry contains no `80 lb` and no `$300` anywhere. The declared-value
          figure also contradicted the live consumer flow, which refuses anything
          above CONSUMER_MAX_DECLARED_VALUE_CENTS in TypeScript, re-derives the
          same ceiling in SQL, and enforces it a third time with a CHECK
          constraint on couranr_delivery_requests. Two different published
          numbers for one limit is the defect — a customer reading this page and
          a customer using /send were told different things — so the fix is to
          render the constants the system actually enforces, exactly the way the
          hours below were fixed when they drifted. */}
      <Section title="Item Limits">
        <ul style={ul}>
          <li>
            Weight is included through{" "}
            <strong>{WEIGHT_INCLUDED_THROUGH_LB} lb</strong>, and a weight
            surcharge applies through{" "}
            <strong>{WEIGHT_SURCHARGE_THROUGH_LB} lb</strong>. Heavier than that
            is a Large Item and goes to Couranr review rather than straight to
            checkout.
          </li>
          <li>
            Maximum declared value, counted across the whole shipment rather
            than per item:{" "}
            <strong>{declaredValueDollars(CONSUMER_MAX_DECLARED_VALUE_CENTS)}</strong>.
            Couranr refuses a higher declared value at the moment it is entered.
          </li>
          <li>
            Anything outside these limits is reviewed by Couranr before it can
            be booked.
          </li>
        </ul>
      </Section>

      <Section title="Item Declaration">
        Customers confirm that item details (weight, contents, and declared
        value) are accurate. Misdeclared items may be refused. If an item is
        refused due to misdeclaration or policy violation, fees may be retained
        to cover dispatch and time.
      </Section>

      {/* HRS/TMZ-001 — rendered from the governed module so this page cannot
          drift from authority again. It used to open three hours later than
          the doctrine says, which is exactly the class of stale active claim
          the timing-truth regression now scans for. */}
      <Section title="Business Hours & Cutoff">
        <ul style={ul}>
          <li>
            Operating hours: <strong>{OPERATING_DAYS_COPY}, {OPERATING_WINDOW_COPY}</strong>
          </li>
          <li>
            Same-day cutoff: <strong>{SAME_DAY_CUTOFF_COPY} Eastern</strong>
          </li>
          <li>
            Requests placed after the cutoff are normally fulfilled the{" "}
            <strong>next business day</strong>.
          </li>
        </ul>
      </Section>

      <Section title="Scheduling">
        Scheduled deliveries are completed within selected time windows. Exact
        delivery times are not guaranteed. Couranr may route multi-stop orders
        in a logical sequence unless a specific sequence is approved.
      </Section>

      <Section title="Cancellations">
        <ul style={ul}>
          <li>
            Before driver assignment: authorization is released (no charge)
          </li>
          <li>
            After driver assignment but before pickup: base fee may be retained
          </li>
          <li>
            After pickup: no refund
          </li>
        </ul>
      </Section>

      <Section title="Recipient Availability">
        If the recipient is unavailable:
        <ul style={ul}>
          <li>
            Signature required: delivery may be returned/held pending admin
            decision
          </li>
          <li>
            No signature: delivery can be completed with photo proof where safe
          </li>
        </ul>
      </Section>

      <Section title="Proof of Delivery & Photos">
        Pickup and drop-off photos are required. Blurry or incomplete photos may
        invalidate delivery. Couranr uses photo verification to protect both
        customers and drivers.
      </Section>

      <Section title="Driver Safety & Refusal Rights">
        Drivers may refuse a delivery if unsafe, non-compliant, overweight, or
        otherwise violates policy. Admin review determines next steps.
      </Section>

      <Section title="Force Majeure">
        Delivery times may be affected by traffic, weather, accidents, or other
        conditions beyond our control.
      </Section>

      {/* `new Date().toLocaleDateString()` used to render here, which claimed
          this page was last updated today, every day, forever — and rendered a
          server-locale date the reader never sees the same way twice. A fixed
          draft date is both honest and deterministic. */}
      <div style={{ marginTop: 26, paddingTop: 16, borderTop: "1px solid #e5e7eb", color: "#6b7280", fontSize: 13 }}>
        Version: v1 • Drafted {LEGAL_DRAFTED_ON}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 22 }}>
      <h2 style={{ margin: 0, fontSize: 16, letterSpacing: "0.02em", textTransform: "uppercase" }}>
        {title}
      </h2>
      <div style={{ marginTop: 10, color: "#444", lineHeight: 1.65 }}>
        {children}
      </div>
    </section>
  );
}

const ul: React.CSSProperties = {
  marginTop: 10,
  marginBottom: 0,
  paddingLeft: 18,
  color: "#444",
  lineHeight: 1.65,
};