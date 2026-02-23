"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  status: string | null;
  purpose?: string | null;
  docs_complete?: boolean | null;
  verification_status?: "pending" | "approved" | "denied" | string | null;
  agreement_signed?: boolean | null;
  paid?: boolean | null;
  paid_at?: string | null;
  lockbox_code_released_at?: string | null;
  condition_photos_status?: string | null;
  pickup_confirmed_at?: string | null;
  return_confirmed_at?: string | null;
  deposit_refund_status?: string | null;
  deposit_refund_amount_cents?: number | null;
  damage_confirmed?: boolean | null;
  created_at?: string | null;
  completed_at?: string | null;
  vehicle_id?: string | null;
  vehicle?: {
    year: number;
    make: string;
    model: string;
  } | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "unauth" }
  | { kind: "not_found" }
  | { kind: "ready"; rental: Rental }
  | { kind: "error"; message: string };

function Badge({ label, tone = "neutral" }: { label: string; tone?: "green" | "yellow" | "red" | "neutral" }) {
  const styles =
    tone === "green"
      ? { color: "#166534", background: "#ecfdf5", border: "#bbf7d0" }
      : tone === "yellow"
      ? { color: "#92400e", background: "#fffbeb", border: "#fde68a" }
      : tone === "red"
      ? { color: "#991b1b", background: "#fef2f2", border: "#fecaca" }
      : { color: "#374151", background: "#f3f4f6", border: "#e5e7eb" };

  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        border: `1px solid ${styles.border}`,
        color: styles.color,
        background: styles.background,
      }}
    >
      {label}
    </span>
  );
}

function boolTone(v: boolean | null | undefined): "green" | "red" {
  return v ? "green" : "red";
}

export default function RentalDetailClient({ rentalId }: { rentalId: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const { data: sessionRes } = await supabase.auth.getSession();
        const token = sessionRes.session?.access_token;

        if (!mounted) return;

        if (!token) {
          setState({ kind: "unauth" });
          router.push(`/login?next=${encodeURIComponent(`/auto/rental/${rentalId}`)}`);
          return;
        }

        // Reuse the existing customer-safe endpoint you already have
        const res = await fetch(`/api/auto/my-rentals?t=${Date.now()}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(out?.error || "Failed to load rental");
        }

        const rentals: Rental[] = Array.isArray(out?.rentals) ? out.rentals : [];
        const rental = rentals.find((r) => r.id === rentalId);

        if (!mounted) return;

        if (!rental) {
          setState({ kind: "not_found" });
          return;
        }

        setState({ kind: "ready", rental });
      } catch (e: any) {
        if (!mounted) return;
        setState({ kind: "error", message: e?.message || "Failed to load rental" });
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [rentalId, router]);

  const ui = useMemo(() => {
    if (state.kind !== "ready") return null;
    const r = state.rental;

    const status = String(r.status || "").toLowerCase();
    const ver = String(r.verification_status || "").toLowerCase();
    const dep = String(r.deposit_refund_status || "").toLowerCase();

    return {
      r,
      status,
      ver,
      dep,
      isCompleted: status === "completed",
      isActiveLike: ["pending", "active", "returned"].includes(status),
    };
  }, [state]);

  if (state.kind === "loading") return <p style={{ padding: 24 }}>Loading rental details…</p>;
  if (state.kind === "unauth") return <p style={{ padding: 24 }}>Redirecting to login…</p>;

  if (state.kind === "not_found") {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>Rental Details</h1>
        <div style={card}>
          <p style={{ margin: 0 }}>This rental was not found in your account.</p>
          <div style={{ marginTop: 12 }}>
            <Link href="/dashboard/auto" style={btnPrimaryLink}>
              Back to Auto Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>Rental Details</h1>
        <div style={{ ...card, borderColor: "#fecaca" }}>
          <div>
            <strong style={{ color: "#b91c1c" }}>Error:</strong> {state.message}
          </div>
          <div style={{ marginTop: 12 }}>
            <Link href="/dashboard/auto" style={btnPrimaryLink}>
              Back to Auto Dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const r = ui!.r;

  const statusTone =
    ui!.status === "completed"
      ? "green"
      : ui!.status === "pending" || ui!.status === "returned"
      ? "yellow"
      : ui!.status === "cancelled"
      ? "red"
      : ui!.status === "active"
      ? "green"
      : "neutral";

  const verTone =
    ui!.ver === "approved" ? "green" : ui!.ver === "pending" ? "yellow" : ui!.ver === "denied" ? "red" : "neutral";

  const depTone =
    ui!.dep === "refunded" ? "green" : ui!.dep === "pending" ? "yellow" : ui!.dep === "withheld" ? "red" : "neutral";

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>Rental Details</h1>
          <p style={{ margin: "6px 0 0 0", color: "#6b7280" }}>
            View your rental timeline and status.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/dashboard/auto" style={btnGhostLink}>
            Back to Auto Dashboard
          </Link>
          {ui!.isActiveLike && (
            <Link href="/auto/vehicles" style={btnPrimaryLink}>
              Book another car
            </Link>
          )}
        </div>
      </div>

      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>
              {r.vehicle?.year} {r.vehicle?.make} {r.vehicle?.model}
            </div>
            <div style={{ marginTop: 4, fontSize: 13, color: "#6b7280" }}>
              Rental ID: {r.id}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
            <Badge label={String(r.status || "unknown").toUpperCase()} tone={statusTone as any} />
            <Badge label={`Verification: ${String(r.verification_status || "unknown")}`} tone={verTone as any} />
            <Badge label={`Deposit: ${String(r.deposit_refund_status || "n/a")}`} tone={depTone as any} />
          </div>
        </div>

        {ui!.isCompleted && (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #bbf7d0",
              background: "#ecfdf5",
              color: "#166534",
              fontWeight: 700,
            }}
          >
            This rental is fully completed and closed.
          </div>
        )}
      </div>

      <div style={card}>
        <div style={sectionTitle}>Status Checklist</div>

        <div style={row}>
          <span>Verification approved</span>
          <Badge label={r.verification_status === "approved" ? "Yes" : "No"} tone={boolTone(r.verification_status === "approved")} />
        </div>
        <div style={row}>
          <span>Docs complete</span>
          <Badge label={r.docs_complete ? "Yes" : "No"} tone={boolTone(r.docs_complete)} />
        </div>
        <div style={row}>
          <span>Agreement signed</span>
          <Badge label={r.agreement_signed ? "Yes" : "No"} tone={boolTone(r.agreement_signed)} />
        </div>
        <div style={row}>
          <span>Payment complete</span>
          <Badge label={r.paid ? "Yes" : "No"} tone={boolTone(r.paid)} />
        </div>
        <div style={row}>
          <span>Lockbox released</span>
          <Badge label={r.lockbox_code_released_at ? "Yes" : "No"} tone={boolTone(!!r.lockbox_code_released_at)} />
        </div>
        <div style={row}>
          <span>Pickup confirmed</span>
          <Badge label={r.pickup_confirmed_at ? "Yes" : "No"} tone={boolTone(!!r.pickup_confirmed_at)} />
        </div>
        <div style={row}>
          <span>Return confirmed</span>
          <Badge label={r.return_confirmed_at ? "Yes" : "No"} tone={boolTone(!!r.return_confirmed_at)} />
        </div>
        <div style={row}>
          <span>Condition photos progress</span>
          <Badge label={String(r.condition_photos_status || "not_started")} tone="neutral" />
        </div>
      </div>

      <div style={card}>
        <div style={sectionTitle}>Timeline</div>
        <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
          <TimelineLine label="Created" value={r.created_at} />
          <TimelineLine label="Paid at" value={r.paid_at} />
          <TimelineLine label="Lockbox released" value={r.lockbox_code_released_at} />
          <TimelineLine label="Pickup confirmed" value={r.pickup_confirmed_at} />
          <TimelineLine label="Return confirmed" value={r.return_confirmed_at} />
          <TimelineLine label="Completed" value={r.completed_at} />
        </div>
      </div>

      <div style={card}>
        <div style={sectionTitle}>Deposit</div>
        <div style={{ display: "grid", gap: 10, fontSize: 14 }}>
          <div style={row}>
            <span>Deposit status</span>
            <Badge label={String(r.deposit_refund_status || "n/a")} tone={depTone as any} />
          </div>
          <div style={row}>
            <span>Damage confirmed</span>
            <Badge label={r.damage_confirmed ? "Yes" : "No"} tone={boolTone(r.damage_confirmed)} />
          </div>
          {r.deposit_refund_status === "withheld" && (
            <div style={{ color: "#111827" }}>
              Amount withheld: <strong>${(Number(r.deposit_refund_amount_cents || 0) / 100).toFixed(2)}</strong>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        <Link href="/dashboard/auto" style={btnGhostLink}>
          Back to Dashboard
        </Link>

        {String(r.status || "").toLowerCase() !== "completed" && (
          <Link href={`/auto/checkout?rentalId=${r.id}`} style={btnPrimaryLink}>
            Open Rental Flow
          </Link>
        )}
      </div>
    </div>
  );
}

function TimelineLine({ label, value }: { label: string; value?: string | null }) {
  return (
    <div style={row}>
      <span style={{ color: "#374151" }}>{label}</span>
      <span style={{ color: value ? "#111827" : "#9ca3af", fontWeight: value ? 600 : 400 }}>
        {value ? new Date(value).toLocaleString() : "—"}
      </span>
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  background: "#fff",
  padding: 16,
  marginBottom: 14,
};

const sectionTitle: React.CSSProperties = {
  fontWeight: 900,
  fontSize: 16,
  marginBottom: 12,
};

const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
  borderTop: "1px solid #f3f4f6",
  paddingTop: 10,
};

const btnPrimaryLink: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  textDecoration: "none",
  display: "inline-block",
};

const btnGhostLink: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111827",
  fontWeight: 900,
  textDecoration: "none",
  display: "inline-block",
};