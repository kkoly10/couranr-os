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

      <Section title="Delivery Scope">
        Couranr Delivery provides local courier services for documents, packages,
        boxes, and everyday items within defined limits for weight, distance,
        value, and safety.
      </Section>

      <Section title="Item Limits">
        <ul style={ul}>
          <li>
            Maximum weight (standard checkout): <strong>80 lbs</strong>
          </li>
          <li>
            Maximum declared value (standard checkout): <strong>$300</strong>
          </li>
          <li>
            Over limits require a <strong>Special Request</strong> approval.
          </li>
        </ul>
      </Section>

      <Section title="Item Declaration">
        Customers confirm that item details (weight, contents, and declared
        value) are accurate. Misdeclared items may be refused. If an item is
        refused due to misdeclaration or policy violation, fees may be retained
        to cover dispatch and time.
      </Section>

      <Section title="Business Hours & Cutoff">
        <ul style={ul}>
          <li>
            Business hours: <strong>9:00 AM – 6:00 PM</strong>
          </li>
          <li>
            Same-day cutoff: <strong>4:00 PM</strong>
          </li>
          <li>
            Orders placed after <strong>4:00 PM</strong> are delivered the{" "}
            <strong>next business day</strong> by default.
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

      <div style={{ marginTop: 26, paddingTop: 16, borderTop: "1px solid #e5e7eb", color: "#6b7280", fontSize: 13 }}>
        Version: v1 • Last updated: {new Date().toLocaleDateString()}
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