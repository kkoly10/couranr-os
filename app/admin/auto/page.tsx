"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Rental = {
  id: string;
  created_at: string;
  status: string;
  purpose: "personal" | "rideshare";
  verification_status: "pending" | "approved" | "denied";
  paid: boolean;
  lockbox_code: string | null;
  vehicles: { year: number; make: string; model: string } | null;
  renters: { full_name: string; phone: string; email: string } | null;
};

export default function AdminAutoApprovalsPage() {
  const [rows, setRows] = useState<Rental[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setMsg(null);

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      setMsg("Not logged in.");
      setLoading(false);
      return;
    }

    const res = await fetch("/api/admin/auto/rentals", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data?.error || "Failed to load rentals");
      setLoading(false);
      return;
    }

    setRows(data.rentals || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function approve(rentalId: string) {
    setMsg(null);
    const code = prompt("Enter lockbox code to assign (or leave blank to auto-generate):") || "";

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) return;

    const res = await fetch("/api/admin/auto/approve-rental", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rentalId, action: "approve", lockboxCode: code.trim() || null }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data?.error || "Approve failed");
      return;
    }

    setMsg("Approved ✅");
    load();
  }

  async function deny(rentalId: string) {
    setMsg(null);
    const reason = prompt("Reason for denial (required):");
    if (!reason?.trim()) return;

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) return;

    const res = await fetch("/api/admin/auto/approve-rental", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rentalId, action: "deny", reason: reason.trim() }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data?.error || "Deny failed");
      return;
    }

    setMsg("Denied ✅");
    load();
  }

  async function markReturned(rentalId: string) {
    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) return;

    const res = await fetch("/api/admin/auto/mark-returned", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rentalId }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data?.error || "Failed to mark returned");
      return;
    }

    setMsg("Return confirmed ✅");
    load();
  }

  async function refundDeposit(rentalId: string) {
    const ok = confirm("Refund deposit now? (Stripe refund + DB update)");
    if (!ok) return;

    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) return;

    const res = await fetch("/api/admin/auto/refund-deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ rentalId }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data?.error || "Refund failed");
      return;
    }

    setMsg("Deposit refunded ✅");
    load();
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <h1>Admin — Auto Approvals</h1>
      <p style={{ color: "#555" }}>Approve/deny verification, confirm returns, refund deposits.</p>

      {msg && <div style={{ marginTop: 10, fontWeight: 800 }}>{msg}</div>}
      {loading && <p>Loading…</p>}

      {!loading && rows.length === 0 && <p>No rentals.</p>}

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {rows.map((r) => (
          <div key={r.id} style={{ border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, background: "#fff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <strong>
                  {r.vehicles ? `${r.vehicles.year} ${r.vehicles.make} ${r.vehicles.model}` : "Vehicle"}
                </strong>
                <div style={{ fontSize: 13, color: "#6b7280" }}>
                  Purpose: {r.purpose} • Verification: {r.verification_status} • Paid: {r.paid ? "Yes" : "No"}
                </div>
                <div style={{ fontSize: 13, color: "#374151", marginTop: 6 }}>
                  Renter: {r.renters?.full_name || "—"} • {r.renters?.phone || "—"} • {r.renters?.email || "—"}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
                  Rental ID: {r.id}
                </div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Lockbox: {r.lockbox_code || "—"}
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                {r.verification_status === "pending" && (
                  <>
                    <button style={btn} onClick={() => approve(r.id)}>Approve</button>
                    <button style={btnDanger} onClick={() => deny(r.id)}>Deny</button>
                  </>
                )}
                <button style={btn} onClick={() => markReturned(r.id)}>Confirm Return</button>
                <button style={btn} onClick={() => refundDeposit(r.id)}>Refund Deposit</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid #e5e7eb",
  background: "#111827",
  color: "#fff",
  fontWeight: 800,
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  ...btn,
  background: "#b91c1c",
};