"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Phase =
  | "pickup_exterior"
  | "pickup_interior"
  | "return_exterior"
  | "return_interior";

const PHASE_LABELS: Record<Phase, string> = {
  pickup_exterior: "Pickup — Exterior photos",
  pickup_interior: "Pickup — Interior photos",
  return_exterior: "Return — Exterior photos",
  return_interior: "Return — Interior photos",
};

export default function PhotoUploadPage() {
  const router = useRouter();
  const sp = useSearchParams();

  const rentalId = sp.get("rentalId") || "";
  const phase = sp.get("phase") as Phase;

  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!rentalId || !phase) {
      setMsg("Missing rental or phase.");
    }
  }, [rentalId, phase]);

  async function getLocation() {
    return new Promise<{
      lat?: number;
      lng?: number;
      accuracy?: number;
    }>((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          }),
        () => resolve({}),
        { enableHighAccuracy: true, timeout: 8000 }
      );
    });
  }

  async function upload() {
    setMsg(null);

    if (!file) {
      setMsg("Please take a photo first.");
      return;
    }

    setBusy(true);

    const { data: session } = await supabase.auth.getSession();
    const token = session.session?.access_token;
    if (!token) {
      router.push(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
      return;
    }

    const gps = await getLocation();

    try {
      const form = new FormData();
      form.append("rentalId", rentalId);
      form.append("phase", phase);
      form.append("photo", file);

      if (gps.lat) {
        form.append("lat", String(gps.lat));
        form.append("lng", String(gps.lng));
        form.append("accuracy", String(gps.accuracy || ""));
      }

      const res = await fetch("/api/auto/upload-condition-photo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed");

      setMsg("Photo uploaded successfully.");

      setTimeout(() => {
        router.push("/dashboard/auto");
      }, 700);
    } catch (e: any) {
      setMsg(e.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1>{PHASE_LABELS[phase]}</h1>
      <p style={{ color: "#555" }}>
        Use your camera to capture clear photos. GPS & time will be recorded.
      </p>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => setFile(e.target.files?.[0] || null)}
      />

      {msg && <p style={{ marginTop: 12, fontWeight: 700 }}>{msg}</p>}

      <button
        onClick={upload}
        disabled={busy}
        style={{
          marginTop: 16,
          padding: "12px 16px",
          borderRadius: 10,
          border: "none",
          background: "#111827",
          color: "#fff",
          fontWeight: 800,
        }}
      >
        {busy ? "Uploading…" : "Upload photo"}
      </button>
    </div>
  );
}