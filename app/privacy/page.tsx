// app/privacy/page.tsx
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  const effective = new Date().toLocaleDateString();

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.02em" }}>Privacy Policy</h1>
      <p style={{ marginTop: 10, color: "#555" }}>
        Effective date: <strong>{effective}</strong>
      </p>

      <div style={{ marginTop: 18, lineHeight: 1.75, color: "#111827" }}>
        <p>
          This Privacy Policy explains how Couranr (“Couranr,” “we,” “us,” “our”) collects, uses, shares, and protects personal
          information when you use our websites, apps, and portals (the “Services”).
        </p>

        <h3>1. Information we collect</h3>
        <p>We may collect the following categories of information:</p>
        <ul style={{ paddingLeft: 18 }}>
          <li>
            <strong>Contact and account data:</strong> name (if provided), email, phone number, login/account identifiers.
          </li>
          <li>
            <strong>Identity and verification data (Auto):</strong> driver’s license images (front/back), selfie, residency/eligibility
            documents you upload, verification status, and related metadata (timestamps).
          </li>
          <li>
            <strong>Transaction data:</strong> bookings, service selections, receipts, payments, deposits, refunds, and billing history.
          </li>
          <li>
            <strong>Service details:</strong> delivery addresses, pickup/drop-off instructions, rental dates, and service communications.
          </li>
          <li>
            <strong>Device and usage data:</strong> IP address, browser/device type, pages/actions, logs, and cookies (where used).
          </li>
          <li>
            <strong>Support communications:</strong> messages and attachments you send to customer support.
          </li>
        </ul>

        <h3>2. Why we collect it (purposes)</h3>
        <ul style={{ paddingLeft: 18 }}>
          <li>Provide and operate the Services (quotes, bookings, portal access, customer support).</li>
          <li>Identity verification, fraud prevention, safety checks, and dispute resolution.</li>
          <li>Payment processing and accounting.</li>
          <li>Operational communications (confirmations, reminders, status updates).</li>
          <li>Compliance with legal obligations and enforcement of our Terms.</li>
          <li>Service improvement, analytics, and platform security.</li>
        </ul>

        <h3>3. How we share information</h3>
        <p>We may share information with:</p>
        <ul style={{ paddingLeft: 18 }}>
          <li>
            <strong>Service providers</strong> that help us operate (hosting, databases/storage, payment processors, email/SMS).
          </li>
          <li>
            <strong>Operational partners</strong> (e.g., assigned drivers for courier deliveries) to fulfill your request.
          </li>
          <li>
            <strong>Legal and safety</strong> recipients when required by law, subpoena, court order, or to protect rights/safety.
          </li>
        </ul>
        <p>
          We do not sell personal data in the ordinary sense. If we ever engage in “sale” as defined by applicable law, we will
          provide the required opt-out mechanisms.
        </p>

        <h3>4. Sensitive information and verification uploads</h3>
        <p>
          Verification uploads (driver’s license, selfie, residency documents) are used for fraud prevention, eligibility checks,
          and service safety. Access is restricted and limited to authorized personnel and systems. Please do not upload more
          information than requested.
        </p>

        <h3>5. Data retention</h3>
        <p>
          We retain personal information only as long as reasonably necessary for the purposes described above, including to comply
          with legal, tax, accounting, and dispute-resolution requirements. Retention periods may vary by service and record type.
        </p>

        <h3>6. Security</h3>
        <p>
          We use reasonable administrative, technical, and physical safeguards designed to protect information (access controls,
          encryption in transit where supported, and restricted storage). No system is 100% secure; please use strong passwords and
          protect your account.
        </p>

        <h3>7. Your privacy choices and rights</h3>
        <p>
          Depending on where you live, you may have rights to access, correct, delete, and obtain a copy of your personal data,
          and to opt out of certain processing such as targeted advertising or profiling in furtherance of significant decisions.
          We will verify your request before fulfilling it.
        </p>

        <h3>8. Virginia notice (if applicable)</h3>
        <p>
          If the Virginia Consumer Data Protection Act applies to our processing, we will provide the disclosures and rights process
          contemplated by Virginia law, including an appeals process for denied requests.
        </p>

        <h3>9. Cookies and analytics</h3>
        <p>
          We may use cookies and similar technologies for authentication, security, and basic analytics. You can control cookies
          through your browser settings, but some features may not work properly.
        </p>

        <h3>10. Children’s privacy</h3>
        <p>
          Our Services are not directed to children under 13, and we do not knowingly collect personal data from children under 13.
        </p>

        <h3>11. Changes to this policy</h3>
        <p>
          We may update this Privacy Policy from time to time. Continued use after updates means you accept the updated policy.
        </p>

        <h3>12. Contact</h3>
        <p>
          For privacy questions or requests, contact Couranr using the contact method provided on our website.
        </p>

        <div style={{ marginTop: 18, padding: 14, borderRadius: 14, background: "#f8fafc", border: "1px solid rgba(15,23,42,0.12)" }}>
          <strong>Note:</strong> Because we handle identity verification data (IDs/selfies), you should have a lawyer review your final
          Privacy Policy + data retention rules to match your exact operations and tools.
        </div>
      </div>
    </div>
  );
}