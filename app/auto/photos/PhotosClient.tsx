"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type Phase =
  | "pickup_exterior"
  | "pickup_interior"
  | "return_exterior"
  | "return_interior";

const PHASE_LABEL: Record<Phase, string> = {
  pickup_exterior: "Pickup — Exterior",
  pickup_interior: "Pickup — Interior",
  return_exterior: "Return — Exterior",
  return_interior: "Return — Interior",
};

const TEST_MODE =
  (process.env.NEXT_PUBLIC_AUTO_TEST_MODE || "").toLowerCase() === "true";

export default function PhotosClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const rentalId = sp.get("rentalId") || "";
  const phase = (sp.get("phase") || "pickup_exterior") as Phase;

  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ✅ Default GPS off in test mode (but you can toggle it on)
  const [skipGps, setSkipGps] = useState<boolean>(TEST_MODE);

  const title = useMemo(() => PHASE_LABEL[phase] || "Photos", [phase]);

  useEffect(() => {
    async function boot() {
      setLoading(true);
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      setLoading(false);

      if (!data.session) {
        router.push(
          `/login?next=/auto/photos?rentalId=${encodeURIComponent(
            rentalId
          )}&phase=${encodeURIComponent(phase)}`
        );
      }
    }
    boot();
  }, [router, rentalId, phase]);

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files || []);
    setFiles(list);
  }

  async function getGps(): Promise<{
    lat: number | null;
    lng: number | null;
    acc: number | null;
  }> {
    if (skipGps) return { lat: null, lng: null, acc: null };
    if (!navigator.geolocation) return { lat: null, lng: null, acc: null };

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            acc: pos.coords.accuracy,
          });
        },
        () => resolve({ lat: null, lng: null, acc: null }),
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
      );
    });
  }

  async function uploadAll() {
    setError(null);

    if (!rentalId) return setError("Missing rentalId in URL.");
    if (!files.length) return setError("Please select at least one photo.");

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return setError("Not logged in.");

    setBusy(true);

    try {
      const gps = await getGps();

      for (const f of files) {
        const fd = new FormData();
        fd.append("rentalId", rentalId);
        fd.append("phase", phase);
        fd.append("file", f);

        if (gps.lat !== null) fd.append("capturedLat", String(gps.lat));
        if (gps.lng !== null) fd.append("capturedLng", String(gps.lng));
        if (gps.acc !== null) fd.append("capturedAccuracyM", String(gps.acc));

        const res = await fetch("/api/auto/upload-condition-photo", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: fd,
        });

        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out?.error || "Upload failed");
      }

      alert("Uploaded!");
      setFiles([]);
    } catch (e: any) {
      setError(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!authed) return <p style={{ padding: 24 }}>Redirecting…</p>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>{title}</h1>
      <p style={{ color: "#555", marginTop: 8 }}>
        Upload clear photos. This protects you and Couranr.
      </p>

      <div
        style={{
          marginTop: 14,
          padding: 14,
          borderRadius: 14,
          border: "1px solid #e5e7eb",
          background: "#fff",
        }}
      >
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <input type="file" accept="image/*" multiple onChange={onPickFiles} />

          <button onClick={uploadAll} disabled={busy} style={btnPrimary}>
            {busy ? "Uploading…" : "Upload"}
          </button>

          <button
            onClick={() => setSkipGps((v) => !v)}
            style={btnGhost}
            type="button"
            title="Use this if you’re testing away from pickup location."
          >
            {skipGps ? "GPS: OFF" : "GPS: ON"}
            {TEST_MODE ? " (Test Mode)" : ""}
          </button>
        </div>

        {files.length > 0 && (
          <p style={{ marginTop: 10, color: "#111" }}>
            Selected: <strong>{files.length}</strong> file(s)
          </p>
        )}

        {error && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              border: "1px solid #fecaca",
            }}
          >
            <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
          </div>
        )}
      </div>

      <div style={{ marginTop: 16 }}>
        <button onClick={() => router.back()} style={btnGhost}>
          Back
        </button>
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid #d1d5db",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  cursor: "pointer",
};