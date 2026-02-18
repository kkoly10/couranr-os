// app/terms/page.tsx
export const dynamic = "force-dynamic";

export default function TermsPage() {
  const effective = new Date().toLocaleDateString();

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 34, letterSpacing: "-0.02em" }}>Terms of Use</h1>
      <p style={{ marginTop: 10, color: "#555" }}>
        Effective date: <strong>{effective}</strong>
      </p>

      <div style={{ marginTop: 18, lineHeight: 1.75, color: "#111827" }}>
        <p>
          These Terms govern your use of Couranr’s websites, apps, portals, and service flows (“Couranr,” “we,” “us,” “our”).
          By accessing or using the Services, you agree to these Terms.
        </p>

        <h3>1. Services overview</h3>
        <p>
          Couranr is a local service platform that may include: (a) auto rental workflows and related support (“Auto”),
          (b) pickup/drop-off coordination (“Courier”), and (c) document-related and appointment assistance (“Docs”).
          Service availability, service areas, eligibility requirements, and features may change.
        </p>

        <h3>2. IMPORTANT: Docs / immigration / DMV disclaimer (administrative assistance only)</h3>
        <p>
          Couranr is <strong>not a law firm</strong> and does <strong>not</strong> provide legal advice, legal services,
          legal representation, or attorney-client relationships. Docs services are <strong>clerical/administrative</strong> only
          (for example: typing, organizing, checklists, printing/scanning where available, uploading, and appointment coordination).
        </p>
        <p>
          We do not guarantee outcomes or approvals for any government or third-party process (including USCIS/immigration or DMV matters).
          You are responsible for reviewing all documents for accuracy and truthfulness before submission.
          If you need legal advice, consult a licensed attorney or accredited representative.
        </p>

        <h3>3. Eligibility, accounts, and identity verification</h3>
        <p>
          You must provide accurate information, maintain account security, and be legally able to enter contracts.
          We may refuse service, suspend accounts, or cancel bookings for safety, compliance, fraud prevention, or misuse.
          Some services (especially Auto) may require identity verification before approval or fulfillment.
        </p>

        <h3>4. Quotes, confirmations, and changes</h3>
        <p>
          Quotes may be estimates until confirmed. Requirements (verification, documents, time windows, availability) may apply.
          If details change (addresses, scope, timing, vehicle selection), pricing and availability may change.
        </p>

        <h3>5. Payments, deposits, fees, and authorizations</h3>
        <p>
          You authorize Couranr (and our payment processors) to charge the payment method you provide for confirmed fees, deposits,
          add-ons, taxes, tolls, tickets/citations, late fees, cleaning fees, damage-related costs, administrative/recovery costs
          where permitted, and other amounts you authorize or incur under these Terms or a service-specific agreement.
        </p>
        <p>
          <strong>Disputes:</strong> If you have a billing concern, contact us promptly so we can attempt to resolve it.
          Chargeback abuse or suspected fraud may result in account suspension.
        </p>

        <h3>6. Cancellations, no-shows, and refunds</h3>
        <p>
          Cancellation/refund rules may vary by service and will be disclosed during checkout/confirmation or in the service-specific agreement.
          No-shows, last-minute cancellations, incomplete verification, or inability to access pickup/drop-off locations may result in fees.
        </p>

        <h3>7. Auto: renter responsibilities and vehicle rules</h3>
        <p>
          You agree to follow all applicable laws and any rental agreement terms, including: no illegal activity, no impaired driving,
          no racing, no towing unless explicitly permitted, no off-road use unless explicitly permitted, and no unauthorized drivers.
          You are responsible for fuel, tolls, tickets, and citations during your rental period.
        </p>
        <p>
          <strong>Condition & damage:</strong> You are responsible for loss or damage to the vehicle and related costs to the maximum extent
          permitted by law, subject to any coverage options you purchase (if offered). Certain items may remain renter-responsible even with coverage
          (commonly: glass, wheels/tires, interior damage/cleaning, misuse, negligence).
        </p>
        <p>
          <strong>Maintenance & safety:</strong> Vehicles are maintained routinely; you must promptly report issues and stop driving if warning lights,
          overheating, or unsafe conditions appear. Continuing to operate an unsafe vehicle may increase your responsibility for resulting damage.
        </p>
        <p>
          <strong>Recovery / immobilization:</strong> If a vehicle is not returned as agreed, or we reasonably believe fraud/theft/misuse is occurring,
          you consent to reasonable recovery actions allowed by law (including remote immobilization if installed and legally permitted).
        </p>

        <h3>8. Courier: prohibited items, packaging, and timing</h3>
        <p>
          You agree not to request delivery of prohibited, illegal, dangerous, or restricted items (including hazardous materials) and to comply with all laws.
          You are responsible for proper packaging and accurate pickup/drop-off information. We may refuse items or cancel if safety/compliance concerns arise.
        </p>
        <p>
          Courier timing is not guaranteed; delays may occur due to traffic, weather, availability, access issues, verification issues, or other conditions outside our control.
        </p>

        <h3>9. Uploads, user content, and accuracy</h3>
        <p>
          You represent that uploaded materials (IDs, selfies, documents, photos) are accurate and lawful to provide.
          You grant Couranr permission to store and process uploads for verification, service fulfillment, fraud prevention,
          dispute resolution, and compliance, consistent with our Privacy Policy.
        </p>

        <h3>10. Prohibited conduct</h3>
        <p>
          You agree not to misuse the Services, attempt unauthorized access, submit fraudulent information, harass personnel, interfere with operations,
          or use the Services for illegal purposes. We may investigate and take action, including suspension/termination.
        </p>

        <h3>11. Third-party services</h3>
        <p>
          Couranr may rely on third-party platforms (payments, hosting, messaging, mapping). We are not responsible for third-party outages or errors beyond our control.
        </p>

        <h3>12. Disclaimer of warranties</h3>
        <p>
          The Services are provided “as is” and “as available.” To the maximum extent permitted by law,
          we disclaim warranties of merchantability, fitness for a particular purpose, and non-infringement.
        </p>

        <h3>13. Limitation of liability</h3>
        <p>
          To the maximum extent permitted by law, Couranr will not be liable for indirect, incidental, special, consequential, or punitive damages,
          or for lost profits, lost data, or business interruption.
        </p>
        <p>
          To the maximum extent permitted by law, Couranr’s total liability for any claim will not exceed the amount you paid to Couranr for the service
          giving rise to the claim in the <strong>30 days</strong> before the event.
          Nothing in these Terms limits liability that cannot be limited by law.
        </p>

        <h3>14. Indemnification</h3>
        <p>
          You agree to defend, indemnify, and hold Couranr harmless from claims arising out of your misuse of the Services,
          violation of these Terms, unlawful deliveries, document falsification, unauthorized driver use, or infringement of third-party rights.
        </p>

        <h3>15. Changes to Terms</h3>
        <p>
          We may update these Terms from time to time. Continued use after updates means you accept the updated Terms.
        </p>

        <h3>16. Governing law</h3>
        <p>
          These Terms are governed by the laws of the Commonwealth of Virginia, without regard to conflict of law principles.
        </p>

        <h3>17. Contact</h3>
        <p>
          For support and disputes, contact Couranr using the contact method provided on our website.
        </p>

        <div
          style={{
            marginTop: 18,
            padding: 14,
            borderRadius: 14,
            background: "#fffbeb",
            border: "1px solid #fde68a",
          }}
        >
          <strong>Template notice:</strong> This Terms page is a protective baseline. Have a qualified attorney review your final version
          (insurance, fees, cancellations, repossession/immobilization rules, and local compliance).
        </div>
      </div>
    </div>
  );
}