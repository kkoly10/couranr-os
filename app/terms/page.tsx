export const dynamic = "force-dynamic";

export default function TermsPage() {
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 32 }}>Terms of Use</h1>
      <p style={{ marginTop: 10, color: "#555" }}>
        Effective date: {new Date().toLocaleDateString()}
      </p>

      <div style={{ marginTop: 18, lineHeight: 1.7, color: "#111827" }}>
        <h3>1. Overview</h3>
        <p>
          These Terms govern your use of Couranr Auto services, websites, and booking flows. By using the service, you agree to these Terms.
        </p>

        <h3>2. Eligibility and Account</h3>
        <p>
          You must provide accurate information and maintain the security of your account. We may deny service for fraud prevention or safety.
        </p>

        <h3>3. Payments, Deposits, and Fees</h3>
        <p>
          You authorize charges for rental fees, deposits, tolls, tickets, late returns, cleaning, damage, and permitted administrative/recovery costs.
        </p>

        <h3>4. Chargebacks</h3>
        <p>
          You agree not to initiate chargebacks for authorized transactions. Contact us first for dispute resolution.
        </p>

        <h3>5. Vehicle Use Rules</h3>
        <p>
          No illegal activity, DUI, racing, towing, off-road use, or unauthorized drivers.
        </p>

        <h3>6. Limitation of Liability</h3>
        <p>
          To the maximum extent permitted by law, Couranr Auto is not liable for indirect or consequential losses. Personal items are not our responsibility.
        </p>

        <h3>7. Governing Law</h3>
        <p>
          These Terms are governed by Virginia law.
        </p>

        <h3>8. Contact</h3>
        <p>
          For support and disputes, contact Couranr Auto via the contact details provided on our site.
        </p>
      </div>
    </div>
  );
}