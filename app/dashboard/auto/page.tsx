// app/dashboard/auto/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

// --- TYPES ---
type Rental = {
  id: string;
  status: string | null;
  purpose?: string | null;
  docs_complete?: boolean | null;
  verification_status?: "pending" | "approved" | "denied" | string | null;
  agreement_signed?: boolean | null;
  paid?: boolean | null;
  paid_at?: string | null;
  lockbox_code_released_at?: string | null;
  condition_photos_status?: string | null;
  pickup_confirmed_at?: string | null;
  return_confirmed_at?: string | null;
  deposit_refund_status?: string | null;
  deposit_refund_amount_cents?: number | null;
  damage_confirmed?: boolean | null;
  pickup_at?: string | null;
  return_at?: string | null;
  vehicle_id?: string | null;
  pickup_location?: string | null;
  created_at?: string | null;
  vehicle?: {
    year: number;
    make: string;
    model: string;
  } | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "unauth" }
  | { kind: "ready"; rentals: Rental[] }
  | { kind: "error"; message: string };

function envTrue(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

const TEST_MODE = typeof process !== "undefined" && (envTrue(process.env.NEXT_PUBLIC_AUTO_TEST_MODE) || envTrue(process.env.NEXT_PUBLIC_TEST_MODE));

export default function AutoDashboardRenterHub() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function boot() {
      const { data: { session } } = await supabase.auth.getSession();
      if (!mounted) return;
      if (!session) {
        setState({ kind: "unauth" });
        router.push("/login?next=/dashboard/auto");
        return;
      }
      await refreshData(session.access_token);
    }
    boot();
    return () => { mounted = false; };
  }, [router]);

  async function refreshData(token: string) {
    try {
      // 🚨 THE FIX: Added the timestamp cache-buster here!
      const res = await fetch(`/api/auto/my-rentals?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", // Bypass fetch cache
      });
      if (!res.ok) throw new Error("Failed to load rentals");
      const data = await res.json();
      setState({ kind: "ready", rentals: data?.rentals ?? [] });
      // BUST THE NEXT.JS PAGE CACHE
      router.refresh(); 
    } catch (e: any) {
      setState({ kind: "error", message: e.message });
    }
  }

  async function postAction(url: string, body: any, busyKey: string) {
    setBusy(busyKey);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("Unauthorized");
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Action failed");
      }
      // Instantly refresh the data
      await refreshData(session.access_token);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(null);
    }
  }

  // --- DELETE DRAFT LOGIC ---
  async function deleteDraft(rentalId: string) {
    if (!window.confirm("Are you sure you want to delete this test/draft rental?")) return;
    await postAction("/api/auto/delete-draft", { rentalId }, `delete-${rentalId}`);
  }

  const ui = useMemo(() => {
    if (state.kind !== "ready") return null;

    // 1. Identify the primary rental
    const active = state.rentals.find(r => r.status === 'active' || r.status === 'pending');
    const primary = active || state.rentals[0] || null;
    
    // 2. Filter History
    const allHistory = state.rentals.filter(r => r.id !== primary?.id);
    const pastActives = allHistory.filter(r => r.status !== 'draft');
    const drafts = allHistory.filter(r => r.status === 'draft').slice(0, 5); 
    
    const history = [...pastActives, ...drafts].sort((a, b) => 
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
    );

    if (!primary) return { primary: null, history: [], timeline: null };

    const r = primary;

    // Timeline Progress Logic
    const verificationApproved = r.verification_status === "approved";
    const verificationDenied = r.verification_status === "denied";
    const verificationPending = r.verification_status === "pending";
    const docsDone = !!r.docs_complete;
    const agreementDone = !!r.agreement_signed;
    const paidDone = !!r.paid;
    const lockboxReleased = !!r.lockbox_code_released_at;
    const photoStatus = (r.condition_photos_status || "not_started");
    const pickupPhotosDone = ["pickup_interior_done", "return_exterior_done", "return_interior_done", "complete"].includes(photoStatus);
    const returnPhotosDone = ["return_interior_done", "complete"].includes(photoStatus);
    const pickupConfirmed = !!r.pickup_confirmed_at;
    const returnConfirmed = !!r.return_confirmed_at;
    const depositStatus = (r.deposit_refund_status || "n/a");
    const damageUnderReview = !!r.return_confirmed_at && !!r.damage_confirmed && !["refunded", "withheld"].includes(depositStatus);
    const canConfirmPickup = !!r.id && lockboxReleased && pickupPhotosDone && !pickupConfirmed;
    const canConfirmReturn = !!r.id && pickupConfirmed && returnPhotosDone && !returnConfirmed;

    // Next action suggestion logic
    let nextAction: { label: string; href?: string; note?: string } | null = null;
    if (!docsDone || verificationDenied || verificationPending) {
      nextAction = { label: "Upload ID + selfie", href: "/auto/verify", note: verificationDenied ? "Verification denied. Please re-upload." : "Complete verification so we can approve your pickup." };
    } else if (!agreementDone) {
      nextAction = { label: "Sign agreement", href: `/auto/agreement?rentalId=${r.id}`, note: "Required before payment." };
    } else if (!paidDone) {
      nextAction = { label: "Complete payment", href: `/auto/checkout?rentalId=${r.id}`, note: "Required before lockbox release." };
    } else if (verificationApproved && paidDone && agreementDone && docsDone && !lockboxReleased) {
      nextAction = { label: "Awaiting Lockbox Release", note: "Admin is reviewing your records." };
    } else if (lockboxReleased && !pickupPhotosDone) {
      nextAction = { label: "Upload pickup photos", href: "/auto/photos?phase=pickup_exterior", note: "Required before confirming pickup." };
    } else if (canConfirmPickup) {
      nextAction = { label: "Confirm pickup", note: "Ready to drive." };
    }

    return { primary, history, timeline: { 
        r, docsDone, agreementDone, paidDone, verificationApproved, verificationDenied, verificationPending,
        lockboxReleased, pickupPhotosDone, returnPhotosDone, pickupConfirmed, returnConfirmed,
        depositStatus, damageUnderReview, canConfirmPickup, canConfirmReturn, nextAction, photoStatus
      } 
    };
  }, [state]);

  if (state.kind === "loading") return <p style={{ padding: 24 }}>Loading auto dashboard…</p>;
  if (state.kind === "error") return <p style={{ padding: 24, color: 'red' }}>Error: {state.message}</p>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>Auto Dashboard</h1>
          <p style={styles.sub}>Manage your active rentals and view your history.</p>
        </div>
        <Link href="/auto/vehicles" style={styles.primaryLink}>Book a car</Link>
      </div>

      {TEST_MODE && <div style={styles.notice}><strong>TEST MODE:</strong> Enabled. Location/GPS checks may be bypassed.</div>}

      {/* --- ACTIVE RENTAL SECTION --- */}
      {ui?.primary ? (
        <div style={{ marginBottom: 40 }}>
          <h2 style={{ fontSize: 22, fontWeight: 900, marginBottom: 15 }}>Current Rental</h2>
          
          {ui.timeline?.nextAction && (
            <div style={{ ...styles.card, background: "#fefce8", borderColor: "#fef08a" }}>
               <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 900, color: "#854d0e" }}>Next step: {ui.timeline.nextAction.label}</div>
                  <div style={{ fontSize: 14, color: "#a16207" }}>{ui.timeline.nextAction.note}</div>
                </div>
                {ui.timeline.nextAction.href && (
                  <Link href={ui.timeline.nextAction.href} style={styles.primaryLink}>Go</Link>
                )}
              </div>
            </div>
          )}

          <div style={styles.card}>
            <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 15 }}>Rental Progress</div>
            <TimelineItem n={1} title="Upload ID & selfie" status={ui.timeline?.docsDone ? "done" : ui.timeline?.verificationDenied ? "blocked" : "todo"} actionHref="/auto/verify" actionLabel="Upload" />
            <TimelineItem n={2} title="Sign Agreement" status={ui.timeline?.agreementDone ? "done" : ui.timeline?.docsDone ? "todo" : "disabled"} actionHref={`/auto/agreement?rentalId=${ui.primary.id}`} actionLabel="Sign" />
            <TimelineItem n={3} title="Payment" status={ui.timeline?.paidDone ? "done" : ui.timeline?.agreementDone ? "todo" : "disabled"} actionHref={`/auto/checkout?rentalId=${ui.primary.id}`} actionLabel="Pay" />
            <TimelineItem n={4} title="Admin Approval" status={ui.timeline?.verificationApproved ? "done" : "todo"} />
            <TimelineItem n={5} title="Lockbox Access" status={ui.timeline?.lockboxReleased ? "done" : "disabled"} actionHref="/auto/access" actionLabel="View" />
            <TimelineItem n={6} title="Pickup Photos" status={ui.timeline?.pickupPhotosDone ? "done" : ui.timeline?.lockboxReleased ? "todo" : "disabled"} actionHref="/auto/photos?phase=pickup_exterior" actionLabel="Upload" />
            <TimelineItem n={7} title="Confirm Pickup" status={ui.timeline?.pickupConfirmed ? "done" : ui.timeline?.canConfirmPickup ? "todo" : "disabled"} onAction={() => postAction("/api/auto/confirm-pickup", { rentalId: ui.primary!.id }, "confirm-pickup")} actionLabel="Confirm" busy={busy === "confirm-pickup"} />
            <TimelineItem n={8} title="Return Photos" status={ui.timeline?.returnPhotosDone ? "done" : ui.timeline?.pickupConfirmed ? "todo" : "disabled"} actionHref="/auto/photos?phase=return_exterior" actionLabel="Upload" />
            <TimelineItem n={9} title="Confirm Return" status={ui.timeline?.returnConfirmed ? "done" : ui.timeline?.canConfirmReturn ? "todo" : "disabled"} onAction={() => postAction("/api/auto/confirm-return", { rentalId: ui.primary!.id }, "confirm-return")} actionLabel="Confirm" busy={busy === "confirm-return"} />
            <TimelineItem n={10} title="Deposit Status" status={ui.timeline?.depositStatus === "refunded" ? "done" : ui.timeline?.depositStatus === "withheld" ? "blocked" : ui.timeline?.returnConfirmed ? "todo" : "disabled"} note={ui.timeline?.depositStatus === "refunded" ? "Refunded." : ui.timeline?.depositStatus === "withheld" ? "Withheld." : ui.timeline?.returnConfirmed ? "Pending decision." : ""} />
          </div>

          <div style={styles.card}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Rental summary</div>
            <div style={{ fontSize: 14, color: "#374151", lineHeight: 1.75 }}>
              <div><strong>Vehicle:</strong> {ui.primary.vehicle?.year} {ui.primary.vehicle?.make} {ui.primary.vehicle?.model}</div>
              <div><strong>Status:</strong> <span style={{ textTransform: 'uppercase', fontWeight: 900 }}>{ui.primary.status}</span></div>
              <div><strong>ID:</strong> {ui.primary.id}</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={styles.card}>You don’t have an active rental yet.</div>
      )}

      {/* --- HISTORY SECTION --- */}
      <h2 style={{ fontSize: 20, fontWeight: 900, marginBottom: 15 }}>Rental History & Drafts</h2>
      <div style={{ display: 'grid', gap: 12 }}>
        {ui?.history.length ? ui.history.map(h => (
          <div key={h.id} style={{ ...styles.card, display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 0 }}>
            <div>
              <div style={{ fontWeight: 700 }}>{h.vehicle?.year} {h.vehicle?.make} {h.vehicle?.model || 'Rental Session'}</div>
              <div style={{ fontSize: 12, color: '#888' }}>{new Date(h.created_at!).toLocaleDateString()}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, fontWeight: 900, textTransform: 'uppercase', color: h.status === 'draft' ? '#f59e0b' : '#6b7280' }}>
                {h.status}
              </div>
              
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'flex-end', marginTop: 4 }}>
                {/* Delete Draft Button */}
                {h.status === 'draft' && (
                  <button 
                    onClick={() => deleteDraft(h.id)}
                    disabled={busy === `delete-${h.id}`}
                    style={{ background: 'none', border: 'none', padding: 0, fontSize: 12, color: '#ef4444', cursor: 'pointer', textDecoration: 'underline' }}
                  >
                    {busy === `delete-${h.id}` ? 'Deleting...' : 'Delete'}
                  </button>
                )}
                
                <Link href={h.status === 'draft' ? `/auto/checkout?rentalId=${h.id}` : `/auto/rental/${h.id}`} style={{ fontSize: 12, color: '#111', textDecoration: 'underline' }}>
                  {h.status === 'draft' ? 'Finish Checkout' : 'View Details'}
                </Link>
              </div>

            </div>
          </div>
        )) : (
          <p style={{ color: '#999', fontSize: 14 }}>No past activity found.</p>
        )}
      </div>
    </div>
  );
}

function TimelineItem(props: { n: number; title: string; status: "done" | "todo" | "disabled" | "blocked"; actionHref?: string; actionLabel?: string; onAction?: () => void; busy?: boolean; note?: string; }) {
  const pill = props.status === "done" ? { bg: "#ecfdf5", border: "#bbf7d0", color: "#166534", text: "Done" } : props.status === "blocked" ? { bg: "#fef2f2", border: "#fecaca", color: "#991b1b", text: "Blocked" } : props.status === "disabled" ? { bg: "#f3f4f6", border: "#e5e7eb", color: "#6b7280", text: "Locked" } : { bg: "#eff6ff", border: "#bfdbfe", color: "#1e3a8a", text: "Next" };
  const canClick = (!!props.actionHref || !!props.onAction) && props.status !== "disabled";

  return (
    <div style={{ display: 'flex', gap: 12, padding: '12px 0', borderTop: '1px solid #f3f4f6', alignItems: 'center' }}>
      <div style={{ width: 28, height: 28, borderRadius: 999, background: props.status === 'done' ? '#10b981' : '#111', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 12 }}>{props.n}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 900, fontSize: 14 }}>{props.title} <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 999, fontSize: 10, background: pill.bg, border: `1px solid ${pill.border}`, color: pill.color }}>{pill.text}</span></div>
        {props.note && <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>{props.note}</div>}
      </div>
      <div style={{ minWidth: 80, textAlign: 'right' }}>
        {canClick ? (
          props.actionHref ? (
            <Link href={props.actionHref} style={styles.stepBtn}>{props.actionLabel}</Link>
          ) : (
            <button onClick={props.onAction} style={styles.stepBtn}>{props.busy ? '...' : props.actionLabel}</button>
          )
        ) : <span style={{ color: "#ccc" }}>—</span>}
      </div>
    </div>
  );
}

const styles: Record<string, any> = {
  container: { maxWidth: 1000, margin: "0 auto", padding: 24, fontFamily: 'sans-serif' },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 30, flexWrap: "wrap" },
  h1: { margin: 0, fontSize: 28, fontWeight: 900 },
  sub: { color: "#666", margin: "5px 0 0 0", fontSize: 14 },
  card: { border: "1px solid #e5e7eb", borderRadius: 16, padding: 20, background: "#fff", marginBottom: 15 },
  primaryLink: { background: "#111", color: "#fff", padding: "10px 18px", borderRadius: 10, textDecoration: "none", fontWeight: 900, fontSize: 14 },
  stepBtn: { background: "#fff", border: "1px solid #d1d5db", padding: "6px 12px", borderRadius: 8, color: "#111", fontSize: 12, fontWeight: 900, cursor: "pointer", textDecoration: "none" },
  notice: { background: "#fff7ed", border: "1px solid #fed7aa", padding: 12, borderRadius: 12, marginBottom: 20, fontSize: 13, color: "#9a3412" }
};
