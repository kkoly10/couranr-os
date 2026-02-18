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
          This Privacy Policy explains how Couranr (“Couranr,” “we,” “us,” “our”) collects, uses, shares, and protects personal information when you use
          our websites, apps, and portals (the “Services”).
        </p>

        <h3>1. Information we collect</h3>
        <p>We may collect the following categories of information:</p>
        <ul style={{ paddingLeft: 18 }}>
          <li>
            <strong>Contact and account data:</strong> name (if provided), email, phone number, account identifiers, login metadata.
          </li>
          <li>
            <strong>Identity and verification data (Auto):</strong> driver’s license images (front/back), selfie, and eligibility/residency documents you upload;
            verification status; timestamps and limited upload metadata.
          </li>
          <li>
            <strong>Transaction data:</strong> bookings, service selections, receipts, payments, deposits, refunds, and billing history.
          </li>
          <li>
            <strong>Service details:</strong> delivery addresses and instructions, pickup/drop-off details, rental dates, and service communications.
          </li>
          <li>
            <strong>Device and usage data:</strong> IP address, device type, browser, pages/actions, logs, and cookies (where used).
          </li>
          <li>
            <strong>Support communications:</strong> messages and attachments you send to customer support.
          </li>
        </ul>

        <h3>2. How we use information (purposes)</h3>
        <ul style={{ paddingLeft: 18 }}>
          <li>Provide and operate the Services (quotes, bookings, portal access, customer support).</li>
          <li>Identity verification, fraud prevention, safety checks, and dispute resolution.</li>
          <li>Payment processing, receipts, and accounting.</li>
          <li>Operational communications (confirmations, reminders, status updates).</li>
          <li>Compliance with legal obligations and enforcement of our Terms.</li>
          <li>Service improvement, analytics, and platform security.</li>
        </ul>

        <h3>3. How we share information</h3>
        <p>We may share information with:</p>
        <ul style={{ paddingLeft: 18 }}>
          <li>
            <strong>Service providers</strong> that help us operate the Services (hosting, databases/storage, payment processors, email/SMS).
          </li>
          <li>
            <strong>Operational partners</strong> (for example, assigned drivers for Courier deliveries) to fulfill your request.
          </li>
          <li>
            <strong>Legal and safety recipients</strong> when required by law or to protect rights, safety, and prevent fraud.
          </li>
        </ul>
        <p>
          We do not sell personal data in the ordinary sense. If we ever engage in “sale” or “targeted advertising” as defined by applicable law,
          we will provide the required disclosures and opt-out mechanisms.  [oai_citation:2‡Virginia Law](https://law.lis.virginia.gov/vacode/title59.1/chapter53/section59.1-578/)
        </p>

        <h3>4. Sensitive information and verification uploads</h3>
        <p>
          Verification uploads (IDs/selfies/residency documents) are used for eligibility checks, fraud prevention, safety, and dispute handling.
          Access is restricted and limited to authorized personnel and systems. Please do not upload more information than requested.
        </p>

        <h3>5. Data retention</h3>
        <p>
          We retain personal information only as long as reasonably necessary for the purposes described above, including legal, tax, accounting,
          fraud prevention, and dispute-resolution requirements. Retention periods vary by record type and service.
        </p>

        <h3>6. Security</h3>
        <p>
          We use reasonable administrative, technical, and physical safeguards designed to protect information, such as access controls and restricted storage.
          No system is 100% secure; use strong passwords and protect your account.
          Our approach aligns with common “start with security” best practices (limit access, secure systems, and plan for incidents).  [oai_citation:3‡Federal Trade Commission](https://www.ftc.gov/system/files/ftc_gov/pdf/920a_start_with_security_en_aug2023_508_final_0.pdf)
        </p>

        <h3>7. Your privacy choices and rights</h3>
        <p>
          Depending on where you live, you may have rights to access, correct, delete, and obtain a copy of your personal data, and to opt out of certain processing
          such as targeted advertising, sale of personal data, or profiling in furtherance of decisions with legal or similarly significant effects.
        </p>

        <h3>8. Virginia notice (consumer rights requests + appeals)</h3>
        <p>
          If the Virginia Consumer Data Protection Act applies, you may submit a request to exercise your rights, and you may appeal a denial.
          We will verify your request before completing it, respond within required timeframes, and provide an appeals process where required.  [oai_citation:4‡Virginia Law](https://law.lis.virginia.gov/vacode/title59.1/chapter53/section59.1-578/)
        </p>

        <h3>9. How to submit a privacy request</h3>
        <p>
          Submit requests using the contact method listed on our website. We may ask for information to verify your identity.
          We do not require you to create a new account to submit a rights request, but we may require you to use an existing account if you already have one.  [oai_citation:5‡Virginia Law](https://law.lis.virginia.gov/vacode/title59.1/chapter53/section59.1-578/)
        </p>

        <h3>10. Cookies and analytics</h3>
        <p>
          We may use cookies and similar technologies for authentication, security, and basic analytics. You can control cookies through your browser settings,
          but some features may not work properly.
        </p>

        <h3>11. Children’s privacy</h3>
        <p>
          Our Services are not directed to children under 13, and we do not knowingly collect personal data from children under 13.
        </p>

        <h3>12. Changes to this policy</h3>
        <p>
          We may update this Privacy Policy from time to time. Continued use after updates means you accept the updated policy.
        </p>

        <h3>13. Contact</h3>
        <p>
          For privacy questions or requests, contact Couranr using the contact method provided on our website.
        </p>

        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 14,
            background: "#f8fafc",
            border: "1px solid rgba(15,23,42,0.12)",
          }}
        >
          <strong>Note:</strong> Because you collect identity verification data (IDs/selfies), have counsel review your final Privacy Policy and retention rules
          to match your exact operations and vendors.
        </div>
      </div>
    </div>
  );
}