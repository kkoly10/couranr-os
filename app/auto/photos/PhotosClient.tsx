// app/auto/photos/PhotosClient.tsx
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

function isValidPhase(v: string): v is Phase {
  return (
    v === "pickup_exterior" ||
    v === "pickup_interior" ||
    v === "return_exterior" ||
    v === "return_interior"
  );
}

function envTrue(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

const TEST_MODE =
  typeof process !== "undefined" &&
  (envTrue(process.env.NEXT_PUBLIC_AUTO_TEST_MODE) || envTrue(process.env.NEXT_PUBLIC_TEST_MODE));

type UploadState =
  | { kind: "idle" }
  | { kind: "success"; phase: Phase; uploadedCount: number }
  | { kind: "error"; message: string };

export default function PhotosClient() {
  const router = useRouter();
  const sp = useSearchParams();

  const rentalId = sp.get("rentalId") || "";
  const phaseParam = sp.get("phase") || "pickup_exterior";
  const phase: Phase = isValidPhase(phaseParam) ? phaseParam : "pickup_exterior";

  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState<"pickup" | "return" | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({ kind: "idle" });

  // Default GPS off in test mode
  const [skipGps, setSkipGps] = useState<boolean>(TEST_MODE);

  const title = useMemo(() => PHASE_LABEL[phase] || "Photos", [phase]);

  useEffect(() => {
    async function boot() {
      setLoading(true);
      const { data } = await supabase.auth.getSession();
      setAuthed(!!data.session);
      setLoading(false);

      if (!data.session) {
        const next = `/auto/photos?rentalId=${encodeURIComponent(rentalId)}&phase=${encodeURIComponent(phase)}`;
        router.push(`/login?next=${encodeURIComponent(next)}`);
      }
    }
    boot();
  }, [router, rentalId, phase]);

  // Reset step-success box when phase changes
  useEffect(() => {
    setUploadState({ kind: "idle" });
    setError(null);
    setFiles([]);
  }, [phase, rentalId]);

  function onPickFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files || []);
    setFiles(list);
    setError(null);
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

  async function getToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }

  async function uploadAll() {
    setError(null);
    setUploadState({ kind: "idle" });

    if (!rentalId) {
      setError("Missing rentalId in URL.");
      return;
    }

    if (!files.length) {
      setError("Please select at least one photo.");
      return;
    }

    const token = await getToken();
    if (!token) {
      setError("Not logged in.");
      return;
    }

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
          cache: "no-store",
        });

        const out = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(out?.error || "Upload failed");
        }
      }

      setFiles([]);
      setUploadState({ kind: "success", phase, uploadedCount: files.length });
    } catch (e: any) {
      const msg = e?.message || "Upload failed";
      setError(msg);
      setUploadState({ kind: "error", message: msg });
    } finally {
      setBusy(false);
    }
  }

  async function postFlowAction(url: string, kind: "pickup" | "return") {
    setError(null);
    setActionBusy(kind);

    try {
      const token = await getToken();
      if (!token) throw new Error("Not logged in.");

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rentalId }),
        cache: "no-store",
      });

      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out?.error || "Action failed");

      if (kind === "pickup") {
        alert("Pickup confirmed.");
      } else {
        alert("Return confirmed.");
      }

      router.push("/dashboard/auto");
    } catch (e: any) {
      setError(e?.message || "Action failed");
    } finally {
      setActionBusy(null);
    }
  }

  function goToPhase(nextPhase: Phase) {
    router.push(
      `/auto/photos?rentalId=${encodeURIComponent(rentalId)}&phase=${encodeURIComponent(nextPhase)}`
    );
  }

  function renderStepGuide() {
    const isPickup = phase.startsWith("pickup");
    const isReturn = phase.startsWith("return");

    let steps: string[] = [];
    if (isPickup) {
      steps = [
        "1) Pickup exterior photos",
        "2) Pickup interior photos",
        "3) Confirm pickup",
      ];
    } else if (isReturn) {
      steps = [
        "1) Return exterior photos",
        "2) Return interior photos",
        "3) Confirm return",
      ];
    }

    return (
      <div style={infoCard}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Flow</div>
        <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.7 }}>
          {steps.map((s, i) => (
            <div key={i}>{s}</div>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
          Admin can view your uploaded photos, but pickup/return confirmation is done by the renter in this flow.
        </div>
      </div>
    );
  }

  function renderSuccessBox() {
    if (uploadState.kind !== "success") return null;

    const uploadedLabel = uploadState.uploadedCount === 1 ? "photo" : "photos";

    // Pickup exterior -> next is pickup interior
    if (uploadState.phase === "pickup_exterior") {
      return (
        <div style={successCard}>
          <div style={successTitle}>Pickup exterior uploaded ✅</div>
          <div style={successText}>
            Uploaded {uploadState.uploadedCount} {uploadedLabel}. Next, upload interior pickup photos.
          </div>
          <div style={rowBtns}>
            <button
              type="button"
              style={btnPrimary}
              onClick={() => goToPhase("pickup_interior")}
            >
              Next: Pickup Interior Photos
            </button>
            <button
              type="button"
              style={btnGhost}
              onClick={() => router.push("/dashboard/auto")}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      );
    }

    // Pickup interior -> next is confirm pickup
    if (uploadState.phase === "pickup_interior") {
      return (
        <div style={successCard}>
          <div style={successTitle}>Pickup interior uploaded ✅</div>
          <div style={successText}>
            Uploaded {uploadState.uploadedCount} {uploadedLabel}. You can now confirm pickup and continue the rental flow.
          </div>
          <div style={rowBtns}>
            <button
              type="button"
              style={btnPrimary}
              disabled={actionBusy === "pickup"}
              onClick={() => postFlowAction("/api/auto/confirm-pickup", "pickup")}
            >
              {actionBusy === "pickup" ? "Confirming…" : "Confirm Pickup Now"}
            </button>
            <button
              type="button"
              style={btnGhost}
              onClick={() => router.push("/dashboard/auto")}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      );
    }

    // Return exterior -> next is return interior
    if (uploadState.phase === "return_exterior") {
      return (
        <div style={successCard}>
          <div style={successTitle}>Return exterior uploaded ✅</div>
          <div style={successText}>
            Uploaded {uploadState.uploadedCount} {uploadedLabel}. Next, upload interior return photos.
          </div>
          <div style={rowBtns}>
            <button
              type="button"
              style={btnPrimary}
              onClick={() => goToPhase("return_interior")}
            >
              Next: Return Interior Photos
            </button>
            <button
              type="button"
              style={btnGhost}
              onClick={() => router.push("/dashboard/auto")}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      );
    }

    // Return interior -> next is confirm return
    if (uploadState.phase === "return_interior") {
      return (
        <div style={successCard}>
          <div style={successTitle}>Return interior uploaded ✅</div>
          <div style={successText}>
            Uploaded {uploadState.uploadedCount} {uploadedLabel}. You can now confirm return.
          </div>
          <div style={rowBtns}>
            <button
              type="button"
              style={btnPrimary}
              disabled={actionBusy === "return"}
              onClick={() => postFlowAction("/api/auto/confirm-return", "return")}
            >
              {actionBusy === "return" ? "Confirming…" : "Confirm Return Now"}
            </button>
            <button
              type="button"
              style={btnGhost}
              onClick={() => router.push("/dashboard/auto")}
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      );
    }

    return null;
  }

  if (loading) return <p style={{ padding: 24 }}>Loading…</p>;
  if (!authed) return <p style={{ padding: 24 }}>Redirecting…</p>;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, margin: 0 }}>{title}</h1>

      <p style={{ color: "#555", marginTop: 8 }}>
        Upload clear photos. This protects you and Couranr.
      </p>

      {!rentalId && (
        <div style={errorCard}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> Missing rentalId in URL.
          <div style={{ marginTop: 8 }}>
            <button onClick={() => router.push("/dashboard/auto")} style={btnGhost}>
              Back to Dashboard
            </button>
          </div>
        </div>
      )}

      {rentalId && renderStepGuide()}

      {rentalId && (
        <div style={panel}>
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
            <div style={errorCard}>
              <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
            </div>
          )}
        </div>
      )}

      {rentalId && renderSuccessBox()}

      <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => router.back()} style={btnGhost} type="button">
          Back
        </button>

        <button
          onClick={() => router.push("/dashboard/auto")}
          style={btnGhost}
          type="button"
        >
          Dashboard
        </button>
      </div>
    </div>
  );
}

const panel: React.CSSProperties = {
  marginTop: 14,
  padding: 14,
  borderRadius: 14,
  border: "1px solid #e5e7eb",
  background: "#fff",
};

const infoCard: React.CSSProperties = {
  marginTop: 14,
  padding: 14,
  borderRadius: 14,
  border: "1px solid #dbeafe",
  background: "#eff6ff",
};

const successCard: React.CSSProperties = {
  marginTop: 14,
  padding: 14,
  borderRadius: 14,
  border: "1px solid #bbf7d0",
  background: "#ecfdf5",
};

const successTitle: React.CSSProperties = {
  fontWeight: 900,
  color: "#166534",
};

const successText: React.CSSProperties = {
  marginTop: 6,
  fontSize: 13,
  color: "#166534",
};

const errorCard: React.CSSProperties = {
  marginTop: 12,
  padding: 12,
  borderRadius: 12,
  border: "1px solid #fecaca",
  background: "#fff",
};

const rowBtns: React.CSSProperties = {
  marginTop: 12,
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
};

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