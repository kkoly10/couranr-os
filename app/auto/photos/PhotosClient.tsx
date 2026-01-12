"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const PHASE_LABELS: Record<string, string> = {
  pickup_exterior: "Pickup — Exterior Photos",
  pickup_interior: "Pickup — Interior Photos",
  return_exterior: "Return — Exterior Photos",
  return_interior: "Return — Interior Photos",
};

export default function PhotosClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const rentalId = searchParams.get("rentalId") || "";
  const phase = searchParams.get("phase") || "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    async function guard() {
      if (!rentalId || !phase || !PHASE_LABELS[phase]) {
        setError("Invalid photo upload request.");
        setLoading(false);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.push(`/login?next=${encodeURIComponent(window.location.href)}`);
        return;
      }

      setLoading(false);
    }

    guard();
  }, [rentalId, phase, router]);

  async function uploadPhoto(file: File) {
    setError(null);
    setUploading(true);

    try {
      // 1️⃣ Get GPS
      const position = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        })
      );

      const path = `rentals/${rentalId}/${phase}/${Date.now()}-${file.name}`;

      // 2️⃣ Upload to Supabase Storage
      const { error: uploadErr } = await supabase.storage
        .from("renter-verifications")
        .upload(path, file, { upsert: false });

      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage
        .from("renter-verifications")
        .getPublicUrl(path);

      // 3️⃣ Save record
      const { error: insertErr } = await supabase
        .from("rental_condition_photos")
        .insert({
          rental_id: rentalId,
          user_id: (await supabase.auth.getUser()).data.user?.id,
          phase,
          photo_url: urlData.publicUrl,
          captured_lat: position.coords.latitude,
          captured_lng: position.coords.longitude,
          captured_accuracy_m: position.coords.accuracy,
        });

      if (insertErr) throw insertErr;

      router.push("/dashboard/auto");
    } catch (e: any) {
      setError(e?.message || "Photo upload failed");
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return <p style={{ padding: 24 }}>Preparing upload…</p>;
  }

  return (
    <div style={{ maxWidth: 720, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28 }}>{PHASE_LABELS[phase]}</h1>
      <p style={{ color: "#555", marginTop: 6 }}>
        Please take clear photos. GPS location and timestamp are recorded.
      </p>

      {error && (
        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 12,
            border: "1px solid #fecaca",
            background: "#fff",
            color: "#b91c1c",
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadPhoto(file);
          }}
        />
      </div>

      <p style={{ marginTop: 12, fontSize: 13, color: "#6b7280" }}>
        Uploading confirms the condition of the vehicle at this step.
      </p>
    </div>
  );
}