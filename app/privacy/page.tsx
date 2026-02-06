export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 32 }}>Privacy Policy</h1>
      <p style={{ marginTop: 10, color: "#555" }}>
        Effective date: {new Date().toLocaleDateString()}
      </p>

      <div style={{ marginTop: 18, lineHeight: 1.7, color: "#111827" }}>
        <h3>1. What we collect</h3>
        <p>
          We may collect identity verification images (license front/back, selfie), contact information, booking details, payment records, and GPS/time metadata for uploads.
        </p>

        <h3>2. Why we collect it</h3>
        <p>
          Fraud prevention, dispute resolution, safety, booking fulfillment, customer support, and legal compliance.
        </p>

        <h3>3. How we store and protect data</h3>
        <p>
          Files are stored securely in private storage buckets and linked only to your rental. Access is restricted.
        </p>

        <h3>4. Sharing</h3>
        <p>
          We may share data with payment processors (Stripe), insurers (if applicable), and service providers as needed to operate the service or comply with law.
        </p>

        <h3>5. Your choices</h3>
        <p>
          You may request access, correction, or deletion where applicable, subject to legal retention requirements.
        </p>

        <h3>6. Contact</h3>
        <p>
          Contact Couranr Auto through the site for privacy requests.
        </p>
      </div>
    </div>
  );
}