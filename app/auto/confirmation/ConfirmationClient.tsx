"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RentalSummary = {
  id: string;
  status: string;
  purpose: "personal" | "rideshare";
  docs_complete: boolean;
  condition_photos_complete: boolean;
  agreement_signed: boolean; // if your schema has it; if not, we just ignore
  pickup_at: string | null;
  vehicles: { year: number; make: string; model: string } | null;
};

type Geo = { lat: number; lng: number; accuracyM: number; capturedAt: string };

const PICKUP_LOCATION = {
  label: "1090 Stafford Marketplace, VA 22556",
  lat: 38.4149, // replace with your exact lat/lng later (still works now)
  lng: -77.4089,
};

const GPS_RADIUS_M = 150; // ~500 ft
const GPS_MAX_ACCURACY_M = 50;

function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371000;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLng / 2);
  const aa =
    s1 * s1 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

async function getGeo(): Promise<Geo> {
  const capturedAt = new Date().toISOString();

  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not supported on this device/browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: Math.round(pos.coords.accuracy || 9999),
          capturedAt,
        });
      },
      (err) => reject(new Error(err?.message || "Location permission denied.")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

export default function ConfirmationClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const rentalId = sp.get("rentalId") || "";

  const [token, setToken] = useState<string | null>(null);
  const [rental, setRental] = useState<RentalSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // verification files
  const [licenseFront, setLicenseFront] = useState<File | null>(null);
  const [licenseBack, setLicenseBack] = useState<File | null>(null);
  const [selfie, setSelfie] = useState<File | null>(null);

  // pickup exterior photos
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [left, setLeft] = useState<File | null>(null);
  const [right, setRight] = useState<File | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const t = data.session?.access_token || null;
      setToken(t);

      if (!t) {
        router.push(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
        return;
      }

      if (!rentalId) {
        setMsg("Missing rentalId.");
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/auto/rental?rentalId=${encodeURIComponent(rentalId)}`, {
          headers: { Authorization: `Bearer ${t}` },
        });
        const data2 = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data2?.error || "Failed to load rental");
        setRental(data2.rental);
      } catch (e: any) {
        setMsg(e?.message || "Failed to load rental");
      } finally {
        setLoading(false);
      }
    })();
  }, [router, rentalId]);

  const carTitle = useMemo(() => {
    const v = rental?.vehicles;
    if (!v) return "Your rental";
    return `${v.year} ${v.make} ${v.model}`.trim();
  }, [rental]);

  const docsReady = useMemo(() => {
    return !!licenseFront && !!licenseBack && !!selfie;
  }, [licenseFront, licenseBack, selfie]);

  const photosReady = useMemo(() => {
    return !!front && !!back && !!left && !!right;
  }, [front, back, left, right]);

  async function uploadVerification(kind: "license_front" | "license_back" | "selfie", file: File) {
    if (!token) throw new Error("Not authenticated");
    const form = new FormData();
    form.append("rentalId", rentalId);
    form.append("kind", kind);
    form.append("file", file);

    const res = await fetch("/api/auto/upload-verification", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Upload failed");
  }

  async function uploadPickupExterior(view: "front" | "back" | "left" | "right", file: File) {
    if (!token) throw new Error("Not authenticated");

    // GPS + timestamp capture
    const geo = await getGeo();

    // client-side precheck (server also checks)
    if (geo.accuracyM > GPS_MAX_ACCURACY_M) {
      throw new Error(`Location accuracy too low (${geo.accuracyM}m). Move outdoors and try again.`);
    }

    const dist = haversineMeters(geo.lat, geo.lng, PICKUP_LOCATION.lat, PICKUP_LOCATION.lng);
    if (dist > GPS_RADIUS_M) {
      throw new Error(`You appear too far from pickup location (${Math.round(dist)}m). Upload must be on-site.`);
    }

    const form = new FormData();
    form.append("rentalId", rentalId);
    form.append("stage", "pickup_exterior");
    form.append("view", view);
    form.append("file", file);
    form.append("lat", String(geo.lat));
    form.append("lng", String(geo.lng));
    form.append("accuracyM", String(geo.accuracyM));
    form.append("capturedAt", geo.capturedAt);

    const res = await fetch("/api/auto/upload-condition-photo", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error || "Upload failed");
  }

  async function doUploads() {
    setMsg(null);

    if (!rentalId) return setMsg("Missing rentalId.");
    if (!docsReady) return setMsg("Upload license front/back and a selfie first.");
    if (!photosReady) return setMsg("Upload all 4 pickup exterior photos (front/back/left/right).");

    setBusy(true);
    try {
      // 1) verification docs
      await uploadVerification("license_front", licenseFront!);
      await uploadVerification("license_back", licenseBack!);
      await uploadVerification("selfie", selfie!);

      // 2) pickup exterior photos (GPS/time verified)
      await uploadPickupExterior("front", front!);
      await uploadPickupExterior("back", back!);
      await uploadPickupExterior("left", left!);
      await uploadPickupExterior("right", right!);

      // reload rental flags
      const res = await fetch(`/api/auto/rental?rentalId=${encodeURIComponent(rentalId)}`, {
        headers: { Authorization: `Bearer ${token!}` },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) setRental(data.rental);

      setMsg("Uploads complete ✅ You can now proceed to payment.");
    } catch (e: any) {
      setMsg(e?.message || "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function goToPayment() {
    setMsg(null);
    if (!token) return;

    setBusy(true);
    try {
      const res = await fetch("/api/auto/start-checkout", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rentalId }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Failed to start checkout");

      window.location.href = data.url;
    } catch (e: any) {
      setMsg(e?.message || "Server error");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!rental) return <p style={{ padding: 24 }}>{msg || "Rental not found."}</p>;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: 24 }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Step 3: Verification + Pickup Photos</h1>
      <p style={{ color: "#555", marginTop: 8 }}>
        {carTitle} • Purpose: <strong>{rental.purpose === "rideshare" ? "Rideshare" : "Personal"}</strong>
      </p>

      <div style={card}>
        <h2 style={h2}>Required before payment</h2>

        <div style={grid}>
          <div style={panel}>
            <h3 style={h3}>1) Identity verification</h3>
            <p style={p}>
              Upload your driver license and a selfie. These are used for fraud prevention and dispute resolution.
            </p>

            <Label>License front (required)</Label>
            <input type="file" accept="image/*" onChange={(e) => setLicenseFront(e.target.files?.[0] || null)} />

            <Label>License back (required)</Label>
            <input type="file" accept="image/*" onChange={(e) => setLicenseBack(e.target.files?.[0] || null)} />

            <Label>Selfie (required)</Label>
            <input type="file" accept="image/*" onChange={(e) => setSelfie(e.target.files?.[0] || null)} />

            <div style={hint}>
              Bucket is private. Files are stored securely and linked only to your rental.
            </div>
          </div>

          <div style={panel}>
            <h3 style={h3}>2) Pickup exterior photos (GPS + time verified)</h3>
            <p style={p}>
              You must be near the pickup location to upload these. Location is captured only at upload time.
            </p>

            <div style={notice}>
              <strong>Pickup location:</strong> {PICKUP_LOCATION.label}<br />
              <strong>GPS rule:</strong> within {GPS_RADIUS_M}m and accuracy ≤ {GPS_MAX_ACCURACY_M}m.
            </div>

            <Label>Front</Label>
            <input type="file" accept="image/*" onChange={(e) => setFront(e.target.files?.[0] || null)} />

            <Label>Back</Label>
            <input type="file" accept="image/*" onChange={(e) => setBack(e.target.files?.[0] || null)} />

            <Label>Left</Label>
            <input type="file" accept="image/*" onChange={(e) => setLeft(e.target.files?.[0] || null)} />

            <Label>Right</Label>
            <input type="file" accept="image/*" onChange={(e) => setRight(e.target.files?.[0] || null)} />

            <div style={hint}>
              Interior photos are not allowed before access. They will be required after unlock.
            </div>
          </div>
        </div>

        {msg && (
          <div style={{ marginTop: 14, fontWeight: 800, color: msg.includes("✅") ? "#166534" : "#b91c1c" }}>
            {msg}
          </div>
        )}

        <div style={{ display: "flex", gap: 12, marginTop: 18, flexWrap: "wrap" }}>
          <button onClick={doUploads} disabled={busy} style={primaryBtn}>
            {busy ? "Working…" : "Upload required items"}
          </button>

          <button
            onClick={goToPayment}
            disabled={busy || !(rental.docs_complete && rental.condition_photos_complete)}
            style={{
              ...secondaryBtn,
              opacity: busy || !(rental.docs_complete && rental.condition_photos_complete) ? 0.6 : 1,
            }}
          >
            Continue to payment
          </button>
        </div>

        <div style={{ marginTop: 14, color: "#6b7280", fontSize: 12 }}>
          Manual approval: your rental will require review before lockbox access is released.
        </div>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ marginTop: 10, fontSize: 13, fontWeight: 800 }}>{children}</div>;
}

const card: React.CSSProperties = {
  marginTop: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  padding: 18,
  background: "#fff",
};

const grid: React.CSSProperties = {
  display: "grid",
  gap: 16,
  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
  marginTop: 12,
};

const panel: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  padding: 14,
  background: "#f9fafb",
};

const notice: React.CSSProperties = {
  marginTop: 10,
  padding: 10,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#fff",
  fontSize: 13,
  color: "#374151",
  lineHeight: 1.4,
};

const h2: React.CSSProperties = { margin: 0, fontSize: 18 };
const h3: React.CSSProperties = { margin: 0, fontSize: 16 };
const p: React.CSSProperties = { marginTop: 8, color: "#555", lineHeight: 1.5 };
const hint: React.CSSProperties = { marginTop: 10, fontSize: 12, color: "#6b7280" };

const primaryBtn: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "none",
  background: "#111827",
  color: "#fff",
  fontWeight: 900,
  cursor: "pointer",
};

const secondaryBtn: React.CSSProperties = {
  padding: "12px 16px",
  borderRadius: 12,
  border: "1px solid #111827",
  background: "#fff",
  color: "#111827",
  fontWeight: 900,
  cursor: "pointer",
};