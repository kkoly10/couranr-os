"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Phase = "pickup_exterior" | "pickup_interior" | "return_exterior" | "return_interior";

const TEST_MODE =
  typeof process !== "undefined" &&
  (process.env.NEXT_PUBLIC_AUTO_TEST_MODE === "1" ||
    process.env.NEXT_PUBLIC_AUTO_TEST_MODE === "true" ||
    process.env.NEXT_PUBLIC_TEST_MODE === "1" ||
    process.env.NEXT_PUBLIC_TEST_MODE === "true");

export default function ConditionClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";
  const step = (sp.get("step") || "pickup_exterior") as Phase;

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const title = useMemo(() => {
    switch (step) {
      case "pickup_exterior":
        return "Pickup — Exterior Photos";
      case "pickup_interior":
        return "Pickup — Interior Photos";
      case "return_exterior":
        return "Return — Exterior Photos";
      case "return_interior":
        return "Return — Interior Photos";
    }
  }, [step]);

  async function getGeo(): Promise<{ lat: number; lng: number; acc: number } | null> {
    if (!("geolocation" in navigator)) return null;

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  async function upload() {
    setMsg(null);
    if (!rentalId) return setMsg("Missing rentalId.");
    if (!file) return setMsg("Choose a photo first.");

    setBusy(true);

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) throw new Error("Not authenticated");

      const geo = TEST_MODE ? null : await getGeo();

      const form = new FormData();
      form.append("rentalId", rentalId);
      form.append("phase", step);
      form.append("file", file);

      if (geo) {
        form.append("capturedLat", String(geo.lat));
        form.append("capturedLng", String(geo.lng));
        form.append("capturedAccuracyM", String(Math.round(geo.acc)));
      }

      const res = await fetch("/api/auto/upload-condition-photo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Upload failed");

      setMsg("Uploaded ✅");

      setTimeout(() => {
        router.push("/dashboard/auto");
      }, 600);
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <h1>{title}</h1>
      <p style={{ color: "#555" }}>
        Upload clear photos. GPS/time may be captured for protection and dispute resolution.
        {TEST_MODE ? " (TEST MODE: GPS bypass)" : ""}
      </p>

      <div style={{ marginTop: 14, border: "1px solid #e5e7eb", borderRadius: 14, padding: 16, background: "#fff" }}>
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] || null)} />

        {msg && <div style={{ marginTop: 12, fontWeight: 800 }}>{msg}</div>}

        <button
          onClick={upload}
          disabled={busy || !file}
          style={{
            marginTop: 14,
            width: "100%",
            padding: "14px 18px",
            borderRadius: 12,
            border: "none",
            background: "#111827",
            color: "#fff",
            fontWeight: 900,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.75 : 1,
          }}
        >
          {busy ? "Uploading…" : "Upload photo"}
        </button>
      </div>
    </div>
  );
}