"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  created_at: string;
  purpose: "personal" | "rideshare";
  status: string | null;
  verification_status: "pending" | "approved" | "denied";
  docs_complete: boolean;
  agreement_signed: boolean;
  paid: boolean;
  lockbox_code: string | null;
  lockbox_code_released_at: string | null;
  condition_photos_status:
    | "not_started"
    | "pickup_exterior_done"
    | "pickup_interior_done"
    | "return_exterior_done"
    | "return_interior_done"
    | "complete";
  pickup_at: string | null;
  pickup_confirmed_at: string | null;
  return_confirmed_at: string | null;
  deposit_refund_status: "n/a" | "pending" | "refunded" | "withheld";
  vehicles: { year: number; make: string; model: string } | null;
};

function fmt(dt?: string | null) {
  if (!dt) return "—";
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return dt;
    return d.toLocaleString();
  } catch {
    return dt;
  }
}

export default function AutoDashboard() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [rental, setRental] = useState<Rental | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    async function boot() {
      setLoading(true);
      setErr(null);

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push("/login?next=/dashboard/auto");
        return;
      }

      try {
        const res = await fetch("/api/auto/my-latest-rental", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to load rental");
        setRental(json.rental || null);
      } catch (e: any) {
        setErr(e?.message || "Failed to load");
      } finally {
        setLoading(false);
      }
    }
    boot();
  }, [router]);

  const vehicleLabel = useMemo(() => {
    const v: any = rental?.vehicles;
    return v ? `${v.year} ${v.make} ${v.model}` : "Vehicle";
  }, [rental]);

  const nextAction = useMemo(() => {
    if (!rental) return { label: "Book a car", href: "/auto/vehicles" };

    if (!rental.docs_complete) return { label: "Upload ID + selfie", href: `/auto/verify?rentalId=${rental.id}` };
    if (!rental.agreement_signed) return { label: "Sign agreement", href: `/auto/agreement?rentalId=${rental.id}` };
    if (!rental.paid) return { label: "Complete payment", href: `/auto/checkout?rentalId=${rental.id}` };

    if (rental.verification_status !== "approved") {
      return { label: "Waiting for approval", href: `/auto/confirmation?rentalId=${rental.id}` };
    }

    // Pickup photos
    if (rental.condition_photos_status === "not_started") {
      return { label: "Upload pickup exterior photos", href: `/auto/photos?rentalId=${rental.id}&phase=pickup_exterior` };
    }
    if (rental.condition_photos_status === "pickup_exterior_done") {
      return { label: "Upload pickup interior photos", href: `/auto/photos?rentalId=${rental.id}&phase=pickup_interior` };
    }

    // Return flow
    if (!rental.return_confirmed_at) {
      if (rental.condition_photos_status === "pickup_interior_done") {
        return { label: "Upload return exterior photos", href: `/auto/photos?rentalId=${rental.id}&phase=return_exterior` };
      }
      if (rental.condition_photos_status === "return_exterior_done") {
        return { label: "Upload return interior photos", href: `/auto/photos?rentalId=${rental.id}&phase=return_interior` };
      }
    }

    return { label: "View confirmation", href: `/auto/confirmation?rentalId=${rental.id}` };
  }, [rental]);

  if (loading) return <p style={{ padding: 24 }}>Loading auto dashboard…</p>;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32 }}>Auto rentals</h1>
          <p style={{ marginTop: 8, color: "#555" }}>
            One place to finish verification, agreement, payment, pickup photos, and returns.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/auto/vehicles" style={btnGhost}>View cars</Link>
          <Link href="/dashboard" style={btnGhost}>Back to dashboards</Link>
        </div>
      </div>

      {err && (
        <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: "1px solid #fecaca", background: "#fff" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {err}
        </div>
      )}

      {!rental ? (
        <div style={card}>
          <strong>No rentals yet.</strong>
          <p style={{ color: "#555", marginTop: 8 }}>Start by booking a vehicle.</p>
          <Link href="/auto/vehicles" style={btnPrimary}>Book a car</Link>
        </div>
      ) : (
        <>
          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <div>
                <strong style={{ fontSize: 16 }}>{vehicleLabel}</strong>
                <div style={{ marginTop: 6, color: "#6b7280", fontSize: 13 }}>
                  Purpose: <strong>{rental.purpose === "rideshare" ? "Rideshare (Uber/Lyft)" : "Personal / Leisure"}</strong>
                  {"  •  "}Pickup: <strong>{fmt(rental.pickup_at)}</strong>
                </div>
              </div>
              <Link href={nextAction.href} style={btnPrimary}>
                {nextAction.label}
              </Link>
            </div>
          </div>

          <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <StepCard title="1) Upload ID & Selfie" done={rental.docs_complete} actionHref={`/auto/verify?rentalId=${rental.id}`} />
            <StepCard title="2) Agreement" done={rental.agreement_signed} actionHref={`/auto/agreement?rentalId=${rental.id}`} />
            <StepCard title="3) Payment" done={rental.paid} actionHref={`/auto/checkout?rentalId=${rental.id}`} />
            <StepCard title="4) Admin approval" done={rental.verification_status === "approved"} subtitle={`Status: ${rental.verification_status}`} />
            <StepCard
              title="5) Lockbox code"
              done={!!rental.lockbox_code && rental.verification_status === "approved"}
              subtitle={rental.lockbox_code ? `Code: ${rental.lockbox_code}` : "Available after approval"}
            />
            <StepCard
              title="6) Pickup photos"
              done={["pickup_exterior_done","pickup_interior_done","return_exterior_done","return_interior_done","complete"].includes(rental.condition_photos_status)}
              actionHref={`/auto/photos?rentalId=${rental.id}&phase=pickup_exterior`}
            />
            <StepCard
              title="7) Return photos"
              done={["return_exterior_done","return_interior_done","complete"].includes(rental.condition_photos_status)}
              actionHref={`/auto/photos?rentalId=${rental.id}&phase=return_exterior`}
            />
            <StepCard title="8) Deposit result" done={rental.deposit_refund_status === "refunded" || rental.deposit_refund_status === "withheld"} subtitle={`Status: ${rental.deposit_refund_status}`} />
          </div>

          <div style={notice}>
            <strong>Pickup/Return:</strong> 1090 Stafford Marketplace, VA 22556 • <strong>Hours:</strong> 9am–6pm
          </div>
        </>
      )}
    </div>
  );
}

function StepCard({
  title,
  done,
  actionHref,
  subtitle,
}: {
  title: string;
  done: boolean;
  actionHref?: string;
  subtitle?: string;
}) {
  return (
    <div style={stepCard}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <strong>{title}</strong>
        <span style={{ fontWeight: 900, color: done ? "#166534" : "#6b7280" }}>
          {done ? "✅" : "⏳"}
        </span>
      </div>
      {subtitle && <div style={{ marginTop: 8, color: "#6b7280", fontSize: 13 }}>{subtitle}</div>}
      {actionHref && (
        <div style={{ marginTop: 12 }}>
          <Link href={actionHref} style={btnGhostSmall}>
            {done ? "View" : "Continue"}
          </Link>
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  marginTop: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 18,
  background: "#fff",
};

const stepCard: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 16,
  background: "#fff",
};

const notice: React.CSSProperties = {
  marginTop: 18,
  borderRadius: 14,
  padding: 12,
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  color: "#1e3a8a",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 16px",
  borderRadius: 12,
  background: "#111827",
  color: "#fff",
  textDecoration: "none",
  fontWeight: 900,
};

const btnGhost: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 16px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  textDecoration: "none",
  fontWeight: 900,
};

const btnGhostSmall: React.CSSProperties = {
  display: "inline-block",
  padding: "9px 12px",
  borderRadius: 12,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  textDecoration: "none",
  fontWeight: 900,
  fontSize: 13,
};