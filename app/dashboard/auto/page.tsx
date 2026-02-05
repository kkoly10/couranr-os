"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  status: string;
  purpose: string;
  verification_status: string;
  agreement_signed: boolean;
  paid: boolean;
  pickup_confirmed_at: string | null;
  return_confirmed_at: string | null;
  lockbox_code_released_at: string | null;
  deposit_refund_status: string;
  damage_confirmed: boolean;
  created_at: string;
};

export default function AutoDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rentals, setRentals] = useState<Rental[]>([]);

  useEffect(() => {
    async function load() {
      const { data: sessionRes } = await supabase.auth.getSession();
      if (!sessionRes.session) {
        router.push("/login?next=/dashboard/auto");
        return;
      }

      const { data, error } = await supabase
        .from("rentals")
        .select(`
          id,
          status,
          purpose,
          verification_status,
          agreement_signed,
          paid,
          pickup_confirmed_at,
          return_confirmed_at,
          lockbox_code_released_at,
          deposit_refund_status,
          damage_confirmed,
          created_at
        `)
        .order("created_at", { ascending: false });

      if (!error) setRentals(data || []);
      setLoading(false);
    }

    load();
  }, [router]);

  if (loading) {
    return <p style={{ padding: 24 }}>Loading auto dashboard…</p>;
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32 }}>My rentals</h1>
          <p style={{ marginTop: 6, color: "#555" }}>
            Track your rental progress, pickup, return, and deposit status.
          </p>
        </div>

        <Link href="/dashboard" style={btnGhost}>
          Back to dashboards
        </Link>
      </div>

      {rentals.length === 0 && (
        <div style={card}>
          <p>You don’t have any rentals yet.</p>
          <Link href="/auto/vehicles" style={btnPrimary}>
            View available cars
          </Link>
        </div>
      )}

      {rentals.map((r) => {
        const showDamageReview =
          r.return_confirmed_at &&
          !r.damage_confirmed &&
          r.deposit_refund_status === "pending";

        return (
          <div key={r.id} style={card}>
            <strong>Rental ID:</strong> {r.id}
            <br />
            <strong>Status:</strong> {r.status}
            <br />
            <strong>Purpose:</strong> {r.purpose}
            <br />
            <strong>Paid:</strong> {r.paid ? "Yes" : "No"}
            <br />
            <strong>Pickup confirmed:</strong>{" "}
            {r.pickup_confirmed_at ? "Yes" : "No"}
            <br />
            <strong>Return confirmed:</strong>{" "}
            {r.return_confirmed_at ? "Yes" : "No"}
            <br />
            <strong>Deposit status:</strong>{" "}
            <StatusBadge value={r.deposit_refund_status} />

            {showDamageReview && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  borderRadius: 12,
                  background: "#fff7ed",
                  border: "1px solid #fed7aa",
                  color: "#9a3412",
                  fontWeight: 700,
                }}
              >
                🛠 Damage under review — deposit decision pending
              </div>
            )}

            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              Created: {new Date(r.created_at).toLocaleString()}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatusBadge({ value }: { value: string }) {
  const color =
    value === "refunded"
      ? "#16a34a"
      : value === "withheld"
      ? "#dc2626"
      : value === "pending"
      ? "#ca8a04"
      : "#374151";

  return (
    <span
      style={{
        padding: "2px 10px",
        borderRadius: 999,
        background: "#f3f4f6",
        color,
        fontSize: 12,
        fontWeight: 800,
      }}
    >
      {value}
    </span>
  );
}

const card: React.CSSProperties = {
  marginTop: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 16,
  background: "#fff",
};

const btnPrimary: React.CSSProperties = {
  display: "inline-block",
  padding: "10px 16px",
  borderRadius: 10,
  background: "#111827",
  color: "#fff",
  textDecoration: "none",
  fontWeight: 800,
};

const btnGhost: React.CSSProperties = {
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  fontWeight: 800,
  textDecoration: "none",
};