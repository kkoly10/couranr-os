"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RentalSummary = {
  rentalId: string;
  purpose: "personal" | "rideshare";
  vehicleLabel: string;
  pickupLocation: string;
  pickupAt: string;
};

function formatLocal(dt: string) {
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return dt;
    return d.toLocaleString();
  } catch {
    return dt;
  }
}

export default function AgreementClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const rentalId = sp.get("rentalId") || "";

  const [loading, setLoading] = useState(true);
  const [rental, setRental] = useState<RentalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [agree, setAgree] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const agreementText = useMemo(() => {
    const purpose = rental?.purpose || "personal";
    return purpose === "rideshare" ? RIDESHARE_AGREEMENT : PERSONAL_AGREEMENT;
  }, [rental]);

  useEffect(() => {
    async function load() {
      setError(null);
      setLoading(true);

      if (!rentalId) {
        setError("Missing rentalId.");
        setLoading(false);
        return;
      }

      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;

      if (!token) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }

      try {
        const res = await fetch(`/api/auto/rental-summary?rentalId=${encodeURIComponent(rentalId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Failed to load rental");

        setRental(data.rental);
      } catch (e: any) {
        setError(e?.message || "Failed to load rental");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [rentalId, router]);

  async function signAgreement() {
    setMsg(null);
    setError(null);

    if (!rentalId) {
      setError("Missing rentalId.");
      return;
    }
    if (!agree) {
      setError("You must check the box to agree before continuing.");
      return;
    }
    if (!typedName.trim()) {
      setError("Please type your full name as your signature.");
      return;
    }

    setSubmitting(true);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;

    if (!token) {
      setSubmitting(false);
      router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    try {
      const res = await fetch("/api/auto/sign-agreement", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rentalId,
          signedName: typedName.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to sign agreement");

      setMsg("Agreement signed. Taking you to checkout…");
      setTimeout(() => router.push(`/auto/checkout?rentalId=${encodeURIComponent(rentalId)}`), 700);
    } catch (e: any) {
      setError(e?.message || "Failed to sign agreement");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 30 }}>Rental Agreement</h1>
      <p style={{ marginTop: 8, color: "#555" }}>
        Please review carefully. You must accept before payment.
      </p>

      {loading && <p style={{ marginTop: 16 }}>Loading…</p>}

      {error && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 12, border: "1px solid #fecaca", background: "#fff" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
        </div>
      )}

      {rental && (
        <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
          <div style={infoCard}>
            <strong>Rental summary</strong>
            <div style={{ marginTop: 8, color: "#374151", lineHeight: 1.6 }}>
              <div><strong>Vehicle:</strong> {rental.vehicleLabel}</div>
              <div><strong>Purpose:</strong> {rental.purpose === "rideshare" ? "Rideshare (Uber/Lyft)" : "Personal / Leisure"}</div>
              <div><strong>Pickup location:</strong> {rental.pickupLocation}</div>
              <div><strong>Pickup time:</strong> {formatLocal(rental.pickupAt)}</div>
            </div>
          </div>

          <div style={agreementBox}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <strong>{rental.purpose === "rideshare" ? "Rideshare Agreement" : "Personal / Leisure Agreement"}</strong>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Version v1</span>
            </div>

            <div style={{ marginTop: 12, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55, color: "#111827" }}>
              {agreementText}
            </div>
          </div>

          <div style={infoCard}>
            <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={agree}
                onChange={() => setAgree(!agree)}
              />
              <span>
                I have read and agree to the Rental Agreement above.
              </span>
            </label>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 800, display: "block", marginBottom: 6 }}>
                Type your full name as signature <span style={{ color: "#dc2626" }}>*</span>
              </label>
              <input
                value={typedName}
                onChange={(e) => setTypedName(e.target.value)}
                placeholder="Your legal name"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                }}
              />
            </div>

            {msg && (
              <div style={{ marginTop: 12, fontWeight: 800, color: "#166534" }}>
                {msg}
              </div>
            )}

            <button
              onClick={signAgreement}
              disabled={submitting}
              style={{
                marginTop: 14,
                width: "100%",
                padding: "14px 18px",
                borderRadius: 12,
                border: "none",
                background: "#111827",
                color: "#fff",
                fontWeight: 900,
                cursor: submitting ? "not-allowed" : "pointer",
                opacity: submitting ? 0.75 : 1,
              }}
            >
              {submitting ? "Saving…" : "Agree & Continue to Payment"}
            </button>

            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              Payment is the next step. Vehicle condition photos will be required after checkout.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const infoCard: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 16,
  background: "#fff",
};

const agreementBox: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 16,
  background: "#f9fafb",
  maxHeight: 520,
  overflow: "auto",
};

/** ---------------- Agreement Texts ---------------- */

const PERSONAL_AGREEMENT = `
COURANR AUTO — PERSONAL / LEISURE RENTAL AGREEMENT (v1)

1) Parties
This Rental Agreement (“Agreement”) is between Couranr (“Owner”) and the renter (“Renter”).

2) Eligibility
Minimum age: 21. Standard advertised pricing applies to ages 25+. Under age 25 fee: +$30/day.

3) Pickup & Return
Pickup/Return Location: 1090 Stafford Marketplace, VA 22556
Hours: 9:00 AM – 6:00 PM
Late return: time past the agreed return time may be charged at the daily rate (and additional fees where applicable).

4) Insurance Requirement
Renter must maintain valid auto insurance that covers rental vehicles.
If Renter does not have personal insurance, Couranr may offer optional coverage at:
- $15/day OR $100/week (as applicable)
Couranr coverage reduces liability but does not eliminate responsibility.

5) Mileage Policy (Locked)
Mileage is not unlimited. Daily rentals include a reasonable daily mileage allowance. Weekly rentals include a weekly allowance.
Excess mileage may be charged per mile, as disclosed at booking.

6) Prohibited Use
No rideshare (Uber/Lyft), racing, off-road, towing, illegal activity, or driving under the influence.
Unauthorized drivers are prohibited.

7) Fees
- Smoking fee: charged for evidence of smoking/vaping (including odor/ash)
- Excess cleaning: charged for heavy stains, pet hair, spills, trash, sand/mud
- Late fees and admin fees may apply for violations

8) Damage Responsibility (Agreement-Ready Damage Clause)
Renter is responsible for all loss or damage to the vehicle during the rental period, regardless of fault.
This responsibility applies whether Renter uses personal insurance or Couranr-provided insurance.

If damage is minor (scratches, curb rash, interior):
Couranr may choose not to involve insurance and may charge repair cost.
Deposit may be applied toward repair costs, deductibles, cleaning fees, late fees, or other charges.

If Renter uses Couranr coverage:
Couranr coverage reduces liability but does not eliminate responsibility.
Deductible (up to) $1,000 per incident may apply.
Renter remains responsible for negligence, misuse, prohibited use, and unauthorized drivers.

9) Deposit
Deposits are refundable subject to vehicle condition, time returned, mileage, and fees.

10) Acknowledgment
By signing, Renter confirms all information provided is accurate and agrees to this Agreement.
`;

const RIDESHARE_AGREEMENT = `
COURANR AUTO — RIDESHARE (UBER/LYFT) RENTAL AGREEMENT (v1)

1) Parties
This Rental Agreement (“Agreement”) is between Couranr (“Owner”) and the renter (“Renter”).

2) Eligibility
Minimum age: 21. Standard advertised pricing applies to ages 25+. Under age 25 fee: +$30/day.

3) Pickup & Return
Pickup/Return Location: 1090 Stafford Marketplace, VA 22556
Hours: 9:00 AM – 6:00 PM
Late return: time past the agreed return time may be charged at the daily rate (and additional fees where applicable).

4) Rideshare Use Permitted
Rideshare use is permitted ONLY if:
- Renter is the approved driver on their rideshare platform account
- Renter complies with platform requirements
- No unauthorized drivers operate the vehicle

5) Payment Structure
Rideshare rentals are typically billed weekly (7 days). Extensions must be approved and paid in advance.

6) Mileage
Rideshare rentals may include high or “unlimited-style” mileage terms based on the vehicle and plan, but abuse is prohibited.
Owner may investigate abnormal usage patterns and apply limits/fees if misuse is detected.

7) Insurance
Renter must maintain valid auto insurance that covers rideshare/rental use OR comply with platform-provided coverage.
If Renter does not have personal insurance, Couranr may offer optional coverage at:
- $15/day OR $100/week (as applicable)
Couranr coverage reduces liability but does not eliminate responsibility.

8) Damage Responsibility (Agreement-Ready Damage Clause)
Renter is responsible for all loss or damage to the vehicle during the rental period, regardless of fault.
This responsibility applies whether Renter uses personal insurance or Couranr-provided insurance.

If damage is minor (scratches, curb rash, interior):
Couranr may choose not to involve insurance and may charge repair cost.
Deposit may be applied toward repair costs, deductibles, cleaning fees, late fees, or other charges.

If Renter uses Couranr coverage:
Couranr coverage reduces liability but does not eliminate responsibility.
Deductible (up to) $1,000 per incident may apply.
Renter remains responsible for negligence, misuse, and unauthorized drivers.

9) Fees
- Smoking fee
- Excess cleaning fee
- Late return fees
- Administrative fees for violations or unpaid balances

10) Acknowledgment
By signing, Renter confirms information is accurate and agrees to this Agreement.
`;