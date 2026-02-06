"use client";

import Link from "next/link";
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
  const [acceptPolicies, setAcceptPolicies] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const agreementText = useMemo(() => {
    const purpose = rental?.purpose || "personal";
    return purpose === "rideshare" ? RIDESHARE_AGREEMENT_V2 : PERSONAL_AGREEMENT_V2;
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

    if (!rentalId) return setError("Missing rentalId.");
    if (!acceptPolicies) return setError("You must accept Terms and Privacy Policy before continuing.");
    if (!agree) return setError("You must check the box to agree before continuing.");
    if (!typedName.trim()) return setError("Please type your full name as your signature.");

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
          // ✅ match your API route’s expected key
          signatureName: typedName.trim(),
          agreementVersion: "v2",
          termsVersion: "v1",
          privacyVersion: "v1",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to sign agreement");

      setMsg("Agreement signed. Taking you to checkout…");
      setTimeout(() => router.push(`/auto/checkout?rentalId=${encodeURIComponent(rentalId)}`), 600);
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
              <div><strong>Vehicle:</strong> {rental.vehicleLabel || "—"}</div>
              <div><strong>Purpose:</strong> {rental.purpose === "rideshare" ? "Rideshare (Uber/Lyft)" : "Personal / Leisure"}</div>
              <div><strong>Pickup location:</strong> {rental.pickupLocation || "—"}</div>
              <div><strong>Pickup time:</strong> {rental.pickupAt ? formatLocal(rental.pickupAt) : "—"}</div>
            </div>
          </div>

          <div style={agreementBox}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <strong>{rental.purpose === "rideshare" ? "Rideshare Agreement" : "Personal / Leisure Agreement"}</strong>
              <span style={{ fontSize: 12, color: "#6b7280" }}>Version v2</span>
            </div>

            <div style={{ marginTop: 12, whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.55, color: "#111827" }}>
              {agreementText}
            </div>
          </div>

          <div style={infoCard}>
            <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
              By continuing you agree to our{" "}
              <Link href="/terms" target="_blank" style={{ fontWeight: 900 }}>
                Terms of Use
              </Link>{" "}
              and{" "}
              <Link href="/privacy" target="_blank" style={{ fontWeight: 900 }}>
                Privacy Policy
              </Link>
              .
            </div>

            <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
              <input type="checkbox" checked={acceptPolicies} onChange={() => setAcceptPolicies(!acceptPolicies)} />
              <span>I agree to the Terms of Use and Privacy Policy.</span>
            </label>

            <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12 }}>
              <input type="checkbox" checked={agree} onChange={() => setAgree(!agree)} />
              <span>I have read and agree to the Rental Agreement above.</span>
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

/** ---------------- Agreement Texts (v2) ---------------- */

const PERSONAL_AGREEMENT_V2 = `
COURANR AUTO — RENTAL AGREEMENT (PERSONAL / LEISURE) — v2

IMPORTANT: PLEASE READ CAREFULLY. THIS IS A LEGALLY BINDING AGREEMENT.

1) PARTIES
This Rental Agreement (“Agreement”) is between Couranr Auto / Couranr (“Company,” “Owner,” “We,” “Us”) and the individual renter (“Renter,” “You”).
By clicking accept / signing electronically, You agree to all terms.

2) ELIGIBILITY & DRIVER REQUIREMENTS
- Minimum age: 21. Standard advertised pricing applies to ages 25+. Under age 25 fee may apply if disclosed at booking.
- A valid driver’s license and identity verification (license + selfie) are required.
- Only approved drivers may operate the vehicle. No unauthorized drivers.

3) RENTAL TERM, PICKUP & RETURN
- Pickup/Return Location: 1090 Stafford Marketplace, VA 22556 (or other disclosed location).
- Hours: 9:00 AM – 6:00 PM unless otherwise stated.
- You must pick up and return on time. Late returns may be billed at the daily rate and/or additional fees disclosed in booking or this Agreement.

4) VEHICLE CONDITION PHOTOS & DISPUTE PROTECTION
- You agree to provide required condition photos at pickup and return when instructed.
- Photos may be GPS/time verified where applicable. Failure to provide required photos may result in delayed deposit decisions and/or administrative fees.

5) PAYMENT, DEPOSIT, AND AUTHORIZATION HOLDS
- You agree to pay rental charges, deposits, fees, and any authorized additional charges under this Agreement.
- Deposits are refundable only after return review and subject to deductions for damage, cleaning, late fees, tolls, tickets, administrative/recovery fees, and unpaid balances.

6) CANCELLATION & REFUND POLICY
Unless a different policy is disclosed at booking:
- Cancel 48+ hours before pickup: refund rental charges (excluding any non-refundable processing fees if disclosed).
- Cancel within 48 hours / same day / no-show: may be non-refundable.

7) PROHIBITED USE
No illegal activity, DUI, racing, off-road use, towing, reckless use, or unauthorized drivers. No subleasing/lending.

8) INSURANCE & LIABILITY (CRITICAL)
A) If You have your own insurance:
- You represent you have active coverage that applies to rental vehicle operation.
- You are responsible for all losses, damages, claims, deductibles, diminished value, loss of use, towing, storage, and related costs during the rental.

B) If Company coverage is provided (if offered):
- Coverage reduces liability but does not eliminate responsibility.
- Deductible up to $1,000 per incident may apply.
- You remain responsible for prohibited use, negligence, misuse, and unauthorized drivers.

C) If You have no valid coverage:
- You are fully responsible for all loss or damage to the vehicle and third-party claims to the maximum extent allowed by law.

9) GLASS / BODY / WHEELS (ALWAYS RENTER RESPONSIBILITY)
Regardless of fault or coverage:
- Glass damage, body damage, wheel/tire damage, curb rash, and undercarriage damage are renter responsibility.
Company may repair without involving insurance and charge actual repair costs plus administrative fees.

10) DAMAGE RESPONSIBILITY & “DAMAGE UNDER REVIEW”
- You are responsible for all loss or damage during the rental, regardless of fault.
- Vehicle may be placed in “Damage Under Review” status after return.
- Deposit may be held pending review and repair estimates.
- You authorize charges for verified damage costs, deductibles, cleaning, and permitted fees.

11) ADMIN / RECOVERY FEES DISCLOSURE
Administrative and recovery fees may apply for: unpaid balances, late return, tow/impound handling, damage processing, vehicle recovery/immobilization, and dispute/chargeback handling.

12) REPOSSESSION / IMMOBILIZATION CONSENT
If payment is not received, you breach this Agreement, or the vehicle is not returned on time, you authorize Company to locate, immobilize, and/or recover the vehicle where legally permitted, and you agree to pay recovery costs.

13) MAINTENANCE & SAFETY (ALERTS/WARNINGS)
Company performs routine maintenance. You must:
- follow dashboard alerts,
- stop driving on warnings indicating risk,
- report issues immediately.
Damage caused by continuing to operate after warnings, misuse, or neglect is renter responsibility.

14) CHARGEBACK PROHIBITION & DISPUTES
You agree not to initiate chargebacks for authorized charges. You must contact Company first for dispute resolution.

15) LIMITATION OF LIABILITY
To the maximum extent permitted by law, Company is not liable for indirect/incidental/consequential damages. Company is not responsible for lost items.

16) INDEMNIFICATION
You agree to indemnify and hold Company harmless from claims/losses arising from your use of the vehicle, including costs and attorney fees where permitted.

17) ELECTRONIC CONSENT
You consent to electronic records and signatures. Your typed name and acceptance actions constitute your legal signature.

18) GOVERNING LAW
Virginia law governs this Agreement. Venue shall be in Virginia unless otherwise required by law.

19) SEVERABILITY & ENTIRE AGREEMENT
If any term is unenforceable, the rest remains in effect. This Agreement plus referenced policies form the entire agreement.

ACCEPTANCE
By accepting, you confirm you have read, understand, and agree to this Agreement.
`;

const RIDESHARE_AGREEMENT_V2 = `
COURANR AUTO — RENTAL AGREEMENT (RIDESHARE: UBER/LYFT) — v2

This Rideshare Agreement includes ALL terms in the Personal/Leisure Agreement v2, plus:

A) RIDESHARE AUTHORIZATION
Rideshare use is permitted only if:
- You are the approved driver on your rideshare platform account, and
- You comply with all platform requirements, and
- No unauthorized drivers operate the vehicle.

B) PLATFORM INSURANCE / COVERAGE
Platform coverage may apply only in certain trip phases and may have coverage gaps. You remain responsible for all loss or damage as stated in the base agreement.

C) PAYMENT STRUCTURE
Rideshare rentals may be billed weekly or by plan. Extensions must be approved and paid in advance.

D) MILEAGE / ABUSE
High-mileage terms may apply based on plan, but abuse or prohibited use may trigger fees and/or termination.

ACCEPTANCE
By accepting, you confirm you have read, understand, and agree to this Agreement.
`;