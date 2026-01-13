"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  status: string;
  verification_status: string;
  paid: boolean;
  lockbox_code: string | null;
  pickup_confirmed_at: string | null;
  return_confirmed_at: string | null;
};

export default function AutoDashboard() {
  const router = useRouter();
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const { data: session } = await supabase.auth.getSession();
    if (!session?.session) {
      router.push("/login?next=/dashboard/auto");
      return;
    }

    const { data } = await supabase
      .from("rentals")
      .select("*")
      .order("created_at", { ascending: false });

    setRentals(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function confirm(endpoint: string, rentalId: string) {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) return;

    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ rentalId }),
    });

    load();
  }

  if (loading) return <p>Loading auto dashboard…</p>;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 32 }}>My Rentals</h1>

      {rentals.length === 0 && <p>You have no rentals.</p>}

      {rentals.map((r) => (
        <div key={r.id} style={card}>
          <strong>Rental ID:</strong> {r.id}
          <br />
          <strong>Status:</strong> {r.status}
          <br />

          {!r.pickup_confirmed_at &&
            r.verification_status === "approved" &&
            r.paid &&
            r.lockbox_code && (
              <button
                style={btnPrimary}
                onClick={() =>
                  confirm("/api/auto/confirm-pickup", r.id)
                }
              >
                Confirm Pickup
              </button>
            )}

          {r.pickup_confirmed_at && !r.return_confirmed_at && (
            <button
              style={btnDanger}
              onClick={() =>
                confirm("/api/auto/confirm-return", r.id)
              }
            >
              Confirm Return
            </button>
          )}

          {r.return_confirmed_at && (
            <p style={{ marginTop: 10, color: "#166534" }}>
              Return confirmed — awaiting deposit decision
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 16,
  marginTop: 12,
  background: "#fff",
};

const btnPrimary: React.CSSProperties = {
  marginTop: 12,
  padding: "10px 14px",
  borderRadius: 10,
  background: "#111827",
  color: "#fff",
  border: "none",
  fontWeight: 800,
};

const btnDanger: React.CSSProperties = {
  marginTop: 12,
  padding: "10px 14px",
  borderRadius: 10,
  background: "#dc2626",
  color: "#fff",
  border: "none",
  fontWeight: 800,
};