// app/auto/access/AccessClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RentalLite = {
  id: string;
  status: string | null;
  created_at?: string | null;
};

export default function AccessClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const rentalIdFromQuery = sp.get("rentalId") || "";

  const [resolvedRentalId, setResolvedRentalId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rentalId = useMemo(
    () => rentalIdFromQuery || resolvedRentalId,
    [rentalIdFromQuery, resolvedRentalId]
  );

  async function getTokenOrRedirect(): Promise<string | null> {
    const { data: sessionRes } = await supabase.auth.getSession();
    const token = sessionRes.session?.access_token;
    if (!token) {
      router.push(
        `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`
      );
      return null;
    }
    return token;
  }

  async function resolveRentalIdFromMyRentals(token: string): Promise<string | null> {
    const res = await fetch(`/api/auto/my-rentals?t=${Date.now()}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || "Failed to load rentals");
    }

    const rentals: RentalLite[] = data?.rentals ?? [];
    if (!rentals.length) return null;

    const active = rentals.find((r) => r.status === "active");
    const pending = rentals.find((r) => r.status === "pending");
    const primary = active || pending || rentals[0] || null;

    return primary?.id ?? null;
  }

  async function load(targetRentalId: string, token?: string) {
    setLoading(true);
    setError(null);

    const accessToken = token || (await getTokenOrRedirect());
    if (!accessToken) {
      setLoading(false);
      return;
    }

    const res = await fetch(
      `/api/auto/get-lockbox-code?rentalId=${encodeURIComponent(targetRentalId)}&t=${Date.now()}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      }
    );

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCode(null);
      setError(data?.error || "Not available yet.");
      setLoading(false);
      return;
    }

    setCode(data.code ?? null);
    setError(null);
    setLoading(false);
  }

  useEffect(() => {
    let active = true;

    async function boot() {
      try {
        const token = await getTokenOrRedirect();
        if (!token || !active) {
          if (active) setLoading(false);
          return;
        }

        let id = rentalIdFromQuery;

        if (!id) {
          const inferred = await resolveRentalIdFromMyRentals(token);
          if (!active) return;

          if (!inferred) {
            setCode(null);
            setError("No active rental found.");
            setLoading(false);
            return;
          }

          setResolvedRentalId(inferred);

          // Keep the URL clean/useful for refreshes
          router.replace(`/auto/access?rentalId=${encodeURIComponent(inferred)}`);

          id = inferred;
        }

        if (!active) return;
        await load(id, token);
      } catch (e: any) {
        if (!active) return;
        setCode(null);
        setError(e?.message || "Unable to load vehicle access.");
        setLoading(false);
      }
    }

    boot();

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentalIdFromQuery]);

  // Auto refresh while user waits for admin release
  useEffect(() => {
    if (!rentalId) return;

    let mounted = true;

    const refreshQuietly = async () => {
      if (!mounted) return;
      const token = await getTokenOrRedirect();
      if (!token || !mounted) return;
      await load(rentalId, token);
    };

    const onFocus = () => {
      refreshQuietly();
    };

    const onVisibility = () => {
      if (!document.hidden) refreshQuietly();
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === "couranr:auto-lockbox-release") {
        refreshQuietly();
      }
    };

    const intervalId = window.setInterval(() => {
      if (!document.hidden) refreshQuietly();
    }, 5000);

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("storage", onStorage);

    return () => {
      mounted = false;
      window.clearInterval(intervalId);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentalId]);

  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 24 }}>
      <h1>Vehicle Access</h1>
      <p style={{ color: "#555" }}>
        Your lockbox code appears after verification is approved, the agreement is signed, payment is completed, and an admin releases the code.
      </p>

      {loading && <p>Loading…</p>}

      {!loading && error && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 12,
            border: "1px solid #fecaca",
            background: "#fff",
          }}
        >
          <strong style={{ color: "#b91c1c" }}>Not ready:</strong> {error}
          <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
            Tip: This page auto-refreshes while you wait. Once the code is released, it will appear here.
          </div>
        </div>
      )}

      {!loading && code && (
        <div
          style={{
            marginTop: 14,
            padding: 16,
            borderRadius: 14,
            border: "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          <div style={{ fontSize: 12, color: "#6b7280" }}>Lockbox code</div>
          <div style={{ fontSize: 36, fontWeight: 900, letterSpacing: 2 }}>{code}</div>

          <div style={{ marginTop: 12, fontSize: 13, color: "#374151", lineHeight: 1.6 }}>
            After unlocking the vehicle, continue to pickup photos (required) before confirming pickup.
          </div>

          <button
            style={{
              marginTop: 14,
              width: "100%",
              padding: "14px 18px",
              borderRadius: 12,
              border: "none",
              background: "#111827",
              color: "#fff",
              fontWeight: 900,
              cursor: "pointer",
            }}
            onClick={() =>
              router.push(
                `/auto/photos?phase=pickup_exterior&rentalId=${encodeURIComponent(rentalId)}`
              )
            }
          >
            Upload pickup photos
          </button>
        </div>
      )}
    </div>
  );
}