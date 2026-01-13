"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  purpose: string;
  verification_status: string;
  agreement_signed: boolean;
  paid: boolean;
  pickup_confirmed_at: string | null;
  return_confirmed_at: string | null;
  lockbox_code_released_at: string | null;
  deposit_refund_status: string;
  created_at: string;
};

export default function AdminAutoDashboard() {
  const [rentals, setRentals] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);

    const { data } = await supabase
      .from("rentals")
      .select(`
        id,
        purpose,
        verification_status,
        agreement_signed,
        paid,
        pickup_confirmed_at,
        return_confirmed_at,
        lockbox_code_released_at,
        deposit_refund_status,
        created_at
      `)
      .order("created_at", { ascending: false });

    setRentals(data || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function adminAction(endpoint: string, body: any = {}) {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) return alert("Unauthorized");

    await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    load();
  }

  if (loading) return <p style={{ padding: 24 }}>Loading auto rentals…</p>;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <h1>Admin — Auto Rentals</h1>

      {rentals.map((r) => (
        <div
          key={r.id}
          style={{
            marginTop: 14,
            padding: 16,
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            background: "#fff",
          }}
        >
          <strong>ID:</strong> {r.id}
          <br />
          <strong>Purpose:</strong> {r.purpose}
          <br />
          <strong>Verification:</strong> {r.verification_status}
          <br />
          <strong>Paid:</strong> {r.paid ? "Yes" : "No"}
          <br />
          <strong>Lockbox:</strong>{" "}
          {r.lockbox_code_released_at ? "Released" : "Not released"}
          <br />
          <strong>Pickup:</strong>{" "}
          {r.pickup_confirmed_at ? "Confirmed" : "Not confirmed"}
          <br />
          <strong>Return:</strong>{" "}
          {r.return_confirmed_at ? "Confirmed" : "Not confirmed"}
          <br />
          <strong>Deposit:</strong> {r.deposit_refund_status}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            {r.verification_status === "pending" && (
              <>
                <button
                  onClick={() =>
                    adminAction("/api/admin/auto/verify", {
                      rentalId: r.id,
                      decision: "approved",
                    })
                  }
                >
                  Approve
                </button>
                <button
                  onClick={() =>
                    adminAction("/api/admin/auto/verify", {
                      rentalId: r.id,
                      decision: "denied",
                      reason: prompt("Reason for denial") || "Denied",
                    })
                  }
                >
                  Deny
                </button>
              </>
            )}

            {r.verification_status === "approved" &&
              r.paid &&
              !r.lockbox_code_released_at && (
                <button
                  onClick={() =>
                    adminAction("/api/admin/auto/release-lockbox", {
                      rentalId: r.id,
                    })
                  }
                >
                  Release Lockbox
                </button>
              )}

            {!r.pickup_confirmed_at && (
              <button
                onClick={() =>
                  adminAction("/api/admin/auto/confirm-pickup", {
                    rentalId: r.id,
                  })
                }
              >
                Confirm Pickup
              </button>
            )}

            {r.pickup_confirmed_at && !r.return_confirmed_at && (
              <button
                onClick={() =>
                  adminAction("/api/admin/auto/confirm-return", {
                    rentalId: r.id,
                  })
                }
              >
                Confirm Return
              </button>
            )}

            <a href={`/admin/auto/deposits?rentalId=${r.id}`}>
              <button>Deposit</button>
            </a>
          </div>
        </div>
      ))}
    </div>
  );
}