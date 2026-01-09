"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

export default function AutoDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setAuthed(false);
        setLoading(false);
        router.push("/login?next=/dashboard/auto");
        return;
      }
      setAuthed(true);
      setLoading(false);
    }
    boot();
  }, [router]);

  if (loading) return <p style={{ padding: 24 }}>Loading auto dashboard…</p>;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 32 }}>My rentals</h1>
          <p style={{ marginTop: 8, color: "#555" }}>
            Manage your car rentals, payments, agreements, and condition photos.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/auto/vehicles" style={btnPrimary}>
            Book a car
          </Link>
          <Link href="/dashboard" style={btnGhost}>
            Back to dashboards
          </Link>
        </div>
      </div>

      <div style={card}>
        <strong>Coming next (Step C + Admin):</strong>
        <ul style={{ marginTop: 10, paddingLeft: 18, color: "#444", lineHeight: 1.7 }}>
          <li>Your active rentals list</li>
          <li>Reservation details (pickup/return time)</li>
          <li>Agreement signature history</li>
          <li>Online payments + deposit tracking</li>
          <li>Pre-pickup / post-return car photos</li>
        </ul>

        <div style={{ marginTop: 14 }}>
          <Link href="/auto/vehicles" style={btnPrimary}>
            View available cars
          </Link>
        </div>
      </div>

      {authed && (
        <div style={notice}>
          <strong>Pickup location:</strong> 1090 Stafford Marketplace, VA 22556 • <strong>Hours:</strong> 9am–6pm
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  marginTop: 18,
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 18,
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
  display: "inline-block",
  padding: "10px 16px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  textDecoration: "none",
  fontWeight: 800,
};

const notice: React.CSSProperties = {
  marginTop: 18,
  borderRadius: 14,
  padding: 12,
  background: "#eff6ff",
  border: "1px solid #bfdbfe",
  color: "#1e3a8a",
};