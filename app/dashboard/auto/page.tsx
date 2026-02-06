"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

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

  condition_photos_status?:
    | "not_started"
    | "pickup_exterior_done"
    | "pickup_interior_done"
    | "return_exterior_done"
    | "return_interior_done"
    | "complete"
    | string
    | null;

  pickup_confirmed_at?: string | null;
  return_confirmed_at?: string | null;

  deposit_refund_status?: "n/a" | "pending" | "refunded" | "withheld" | string | null;
  deposit_refund_amount_cents?: number | null;

  damage_confirmed?: boolean | null;
  damage_confirmed_at?: string | null;
  damage_notes?: string | null;

  pickup_at?: string | null;
  return_at?: string | null;

  vehicle_id?: string | null;
  pickup_location?: string | null;

  created_at?: string | null;
};

type LoadState =
  | { kind: "loading" }
  | { kind: "unauth" }
  | { kind: "ready"; rental: Rental | null }
  | { kind: "error"; message: string };

function envTrue(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

// ✅ Support your new standard + keep backward compatibility
const TEST_MODE =
  typeof process !== "undefined" &&
  (envTrue(process.env.NEXT_PUBLIC_AUTO_TEST_MODE) || envTrue(process.env.NEXT_PUBLIC_TEST_MODE));

export default function AutoDashboardRenterHub() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      setState({ kind: "loading" });

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session) {
        setState({ kind: "unauth" });
        router.push("/login?next=/dashboard/auto");
        return;
      }

      try {
        const res = await fetch("/api/auto/my-latest-rental", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        if (!res.ok) {
          const msg = await res.text();
          throw new Error(msg || "Failed to load rental");
        }

        const data = await res.json();
        const rental: Rental | null = data?.rental ?? null;

        setState({ kind: "ready", rental });
      } catch (e: any) {
        setState({
          kind: "error",
          message: e?.message || "Failed to load auto dashboard",
        });
      }
    }

    boot();
    return () => {
      mounted = false;
    };
  }, [router]);

  async function postAction(url: string, body: any, busyKey: string) {
    setBusy(busyKey);

    try {
      const { data: sessionRes } = await supabase.auth.getSession();
      const token = sessionRes.session?.access_token;
      if (!token) throw new Error("Unauthorized");

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Request failed");

      // Reload latest rental snapshot
      const reload = await fetch("/api/auto/my-latest-rental", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const reloadData = await reload.json().catch(() => ({}));
      setState({ kind: "ready", rental: reloadData?.rental ?? null });

      return data;
    } finally {
      setBusy(null);
    }
  }

  const ui = useMemo(() => {
    if (state.kind !== "ready") return null;

    const r = state.rental;

    const verificationApproved = r?.verification_status === "approved";
    const verificationDenied = r?.verification_status === "denied";
    const verificationPending = r?.verification_status === "pending";

    const docsDone = !!r?.docs_complete;
    const agreementDone = !!r?.agreement_signed;
    const paidDone = !!r?.paid;

    const lockboxReleased = !!r?.lockbox_code_released_at;

    const photoStatus = (r?.condition_photos_status || "not_started") as string;

    const pickupPhotosDone =
      photoStatus === "pickup_interior_done" ||
      photoStatus === "return_exterior_done" ||
      photoStatus === "return_interior_done" ||
      photoStatus === "complete";

    const returnPhotosDone = photoStatus === "return_interior_done" || photoStatus === "complete";

    const pickupConfirmed = !!r?.pickup_confirmed_at;
    const returnConfirmed = !!r?.return_confirmed_at;

    const depositStatus = (r?.deposit_refund_status || "n/a") as string;

    // Damage under review (renter-facing)
    const damageUnderReview =
      !!r?.return_confirmed_at &&
      !!r?.damage_confirmed &&
      depositStatus !== "refunded" &&
      depositStatus !== "withheld";

    // Confirm pickup button rules (your spec)
    const canConfirmPickup = !!r?.id && lockboxReleased && pickupPhotosDone && !pickupConfirmed;

    // Confirm return button rules
    const canConfirmReturn = !!r?.id && pickupConfirmed && returnPhotosDone && !returnConfirmed;

    // Next action suggestion
    let nextAction: { label: string; href?: string; note?: string } | null = null;

    if (!r) {
      nextAction = {
        label: "Book a car",
        href: "/auto/vehicles",
        note: "You don’t have an active rental yet.",
      };
    } else if (!docsDone || verificationDenied || verificationPending) {
      nextAction = {
        label: "Upload ID + selfie",
        href: "/auto/verify",
        note: verificationDenied
          ? "Your verification was denied. Please re-upload clearly."
          : "Complete verification so we can approve your pickup.",
      };
    } else if (!agreementDone) {
      nextAction = {
        label: "Sign agreement",
        href: `/auto/agreement?rentalId=${encodeURIComponent(r.id)}`,
        note: "Agreement must be signed before payment and pickup.",
      };
    } else if (!paidDone) {
      nextAction = {
        label: "Complete payment",
        href: `/auto/checkout?rentalId=${encodeURIComponent(r.id)}`,
        note: "Payment is required before lockbox code release.",
      };
    } else if (verificationApproved && paidDone && agreementDone && docsDone && !lockboxReleased) {
      nextAction = {
        label: "Wait for approval + lockbox release",
        note: "We’re reviewing your rental. You’ll get instructions when approved.",
      };
    } else if (lockboxReleased && !pickupPhotosDone) {
      nextAction = {
        label: "Upload pickup photos",
        href: "/auto/photos?phase=pickup_exterior",
        note: "Pickup photos are required before confirming pickup.",
      };
    } else if (canConfirmPickup) {
      nextAction = {
        label: "Confirm pickup",
        note: "Confirm pickup after photos are uploaded.",
      };
    } else if (pickupConfirmed && !returnPhotosDone) {
      nextAction = {
        label: "Upload return photos",
        href: "/auto/photos?phase=return_exterior",
        note: "Return photos are required before confirming return.",
      };
    } else if (canConfirmReturn) {
      nextAction = {
        label: "Confirm return",
        note: "Confirm return after return photos are uploaded.",
      };
    } else if (damageUnderReview) {
      nextAction = {
        label: "Damage under review",
        note: "Deposit decision pending — we’ll notify you as soon as it's finalized.",
      };
    } else {
      nextAction = {
        label: "View status",
        note: "You’re all set. We’ll notify you if anything is needed.",
      };
    }

    return {
      r,
      docsDone,
      agreementDone,
      paidDone,
      verificationApproved,
      verificationDenied,
      verificationPending,
      lockboxReleased,
      pickupPhotosDone,
      returnPhotosDone,
      pickupConfirmed,
      returnConfirmed,
      depositStatus,
      damageUnderReview,
      canConfirmPickup,
      canConfirmReturn,
      nextAction,
      photoStatus,
    };
  }, [state]);

  if (state.kind === "loading") {
    return <p style={{ padding: 24 }}>Loading auto dashboard…</p>;
  }

  if (state.kind === "unauth") {
    return <p style={{ padding: 24 }}>Redirecting to login…</p>;
  }

  if (state.kind === "error") {
    return (
      <div style={styles.container}>
        <h1 style={styles.h1}>My rentals</h1>
        <div style={{ ...styles.card, borderColor: "#fecaca" }}>
          <strong>Error:</strong> {state.message}
        </div>
        <div style={{ marginTop: 12 }}>
          <Link href="/dashboard" style={styles.ghostLink}>
            Back to dashboards
          </Link>
        </div>
      </div>
    );
  }

  const rental = ui?.r;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>My rental</h1>
          <p style={styles.sub}>
            Everything you need in one place: verification, agreement, payment, pickup/return, deposit.
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/dashboard" style={styles.ghostLink}>
            Back
          </Link>
          <Link href="/auto/vehicles" style={styles.primaryLink}>
            Book a car
          </Link>
        </div>
      </div>

      {TEST_MODE && (
        <div style={{ ...styles.notice, background: "#fff7ed", borderColor: "#fed7aa", color: "#9a3412" }}>
          <strong>TEST MODE:</strong> Enabled. Location/GPS checks may be bypassed (for testing only).
        </div>
      )}

      {!rental ? (
        <div style={styles.card}>
          <p style={{ margin: 0 }}>You don’t have an active rental yet.</p>
          <div style={{ marginTop: 12 }}>
            <Link href="/auto/vehicles" style={styles.primaryLink}>
              View available cars
            </Link>
          </div>
        </div>
      ) : (
        <>
          {ui?.nextAction && (
            <div style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16 }}>What to do next</div>
                  <div style={{ marginTop: 6, color: "#444", lineHeight: 1.55 }}>
                    <strong>{ui.nextAction.label}</strong>
                    {ui.nextAction.note ? ` — ${ui.nextAction.note}` : ""}
                  </div>
                </div>

                {ui.nextAction.href ? (
                  <Link href={ui.nextAction.href} style={styles.primaryLink}>
                    Go
                  </Link>
                ) : (
                  <span style={{ color: "#6b7280", fontWeight: 800, alignSelf: "center" }}>—</span>
                )}
              </div>
            </div>
          )}

          {ui?.damageUnderReview && (
            <div style={{ ...styles.card, background: "#fff7ed", borderColor: "#fed7aa" }}>
              <strong>Damage under review — deposit decision pending.</strong>
              <div style={{ marginTop: 6, color: "#7c2d12", lineHeight: 1.5 }}>
                We’re reviewing the return photos and condition. You’ll be notified when the deposit is refunded or withheld.
              </div>
            </div>
          )}

          <div style={styles.card}>
            <div style={{ fontWeight: 900, fontSize: 16, marginBottom: 10 }}>Rental Progress</div>

            <TimelineItem
              n={1}
              title="Upload ID & selfie"
              status={ui?.docsDone ? "done" : ui?.verificationDenied ? "blocked" : "todo"}
              actionHref="/auto/verify"
              actionLabel={ui?.docsDone ? "View" : "Upload"}
              note={
                ui?.verificationDenied ? "Denied — re-upload clearly." : ui?.docsDone ? "Submitted." : "Required to proceed."
              }
            />

            <TimelineItem
              n={2}
              title="Agreement pending"
              status={ui?.agreementDone ? "done" : ui?.docsDone ? "todo" : "disabled"}
              actionHref={`/auto/agreement?rentalId=${encodeURIComponent(rental.id)}`}
              actionLabel={ui?.agreementDone ? "View" : "Sign"}
              note={ui?.agreementDone ? "Signed." : ui?.docsDone ? "Sign to proceed." : "Complete verification first."}
            />

            <TimelineItem
              n={3}
              title="Payment pending"
              status={ui?.paidDone ? "done" : ui?.agreementDone ? "todo" : "disabled"}
              actionHref={`/auto/checkout?rentalId=${encodeURIComponent(rental.id)}`}
              actionLabel={ui?.paidDone ? "View" : "Pay"}
              note={ui?.paidDone ? "Paid." : ui?.agreementDone ? "Pay to proceed." : "Sign agreement first."}
            />

            <TimelineItem
              n={4}
              title="Admin approval"
              status={ui?.verificationApproved ? "done" : ui?.verificationPending ? "todo" : ui?.verificationDenied ? "blocked" : "todo"}
              note={ui?.verificationApproved ? "Approved." : ui?.verificationDenied ? "Denied — re-upload." : "Under review."}
            />

            <TimelineItem
              n={5}
              title="Lockbox code available"
              status={ui?.lockboxReleased ? "done" : ui?.paidDone && ui?.agreementDone && ui?.docsDone ? "todo" : "disabled"}
              actionHref="/auto/access"
              actionLabel={ui?.lockboxReleased ? "View" : "—"}
              note={
                ui?.lockboxReleased
                  ? "Ready."
                  : ui?.paidDone && ui?.agreementDone && ui?.docsDone
                  ? "Will be released after approval."
                  : "Complete prior steps first."
              }
            />

            <TimelineItem
              n={6}
              title="Pickup photos required"
              status={ui?.pickupPhotosDone ? "done" : ui?.lockboxReleased ? "todo" : "disabled"}
              actionHref="/auto/photos?phase=pickup_exterior"
              actionLabel={ui?.pickupPhotosDone ? "View" : "Upload"}
              note={
                ui?.pickupPhotosDone
                  ? "Completed."
                  : ui?.lockboxReleased
                  ? "Upload before pickup confirmation."
                  : "Lockbox required first."
              }
            />

            <TimelineItem
              n={7}
              title="Confirm pickup"
              status={ui?.pickupConfirmed ? "done" : ui?.canConfirmPickup ? "todo" : "disabled"}
              actionLabel="Confirm"
              onAction={
                ui?.canConfirmPickup
                  ? () => postAction("/api/auto/confirm-pickup", { rentalId: rental.id }, "confirm-pickup")
                  : undefined
              }
              actionDisabled={!ui?.canConfirmPickup || busy === "confirm-pickup"}
              note={
                ui?.pickupConfirmed
                  ? "Pickup confirmed."
                  : ui?.canConfirmPickup
                  ? "Confirm after pickup photos."
                  : ui?.lockboxReleased
                  ? "Upload pickup photos first."
                  : "Lockbox must be released first."
              }
              busy={busy === "confirm-pickup"}
            />

            <TimelineItem
              n={8}
              title="Return photos"
              status={ui?.returnPhotosDone ? "done" : ui?.pickupConfirmed ? "todo" : "disabled"}
              actionHref="/auto/photos?phase=return_exterior"
              actionLabel={ui?.returnPhotosDone ? "View" : "Upload"}
              note={ui?.returnPhotosDone ? "Completed." : ui?.pickupConfirmed ? "Upload before return confirmation." : "Confirm pickup first."}
            />

            <TimelineItem
              n={9}
              title="Confirm return"
              status={ui?.returnConfirmed ? "done" : ui?.canConfirmReturn ? "todo" : "disabled"}
              actionLabel="Confirm"
              onAction={
                ui?.canConfirmReturn
                  ? () => postAction("/api/auto/confirm-return", { rentalId: rental.id }, "confirm-return")
                  : undefined
              }
              actionDisabled={!ui?.canConfirmReturn || busy === "confirm-return"}
              note={
                ui?.returnConfirmed
                  ? "Return confirmed."
                  : ui?.canConfirmReturn
                  ? "Confirm after return photos."
                  : ui?.pickupConfirmed
                  ? "Upload return photos first."
                  : "Confirm pickup first."
              }
              busy={busy === "confirm-return"}
            />

            <TimelineItem
              n={10}
              title="Deposit refunded / withheld"
              status={
                ui?.depositStatus === "refunded"
                  ? "done"
                  : ui?.depositStatus === "withheld"
                  ? "blocked"
                  : ui?.returnConfirmed
                  ? "todo"
                  : "disabled"
              }
              note={
                ui?.depositStatus === "refunded"
                  ? "Refunded."
                  : ui?.depositStatus === "withheld"
                  ? `Withheld. ${
                      rental.deposit_refund_amount_cents
                        ? `($${(Number(rental.deposit_refund_amount_cents) / 100).toFixed(2)})`
                        : ""
                    }`
                  : ui?.returnConfirmed
                  ? "Pending decision."
                  : "Return confirmation required first."
              }
            />
          </div>

          <div style={styles.card}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Rental summary</div>
            <div style={{ color: "#374151", lineHeight: 1.75 }}>
              <div>
                <strong>Rental ID:</strong> {rental.id}
              </div>
              <div>
                <strong>Status:</strong> {rental.status || "—"}
              </div>
              <div>
                <strong>Pickup location:</strong> {rental.pickup_location || "—"}
              </div>
              <div>
                <strong>Pickup time:</strong> {rental.pickup_at ? new Date(rental.pickup_at).toLocaleString() : "—"}
              </div>
              <div>
                <strong>Return time:</strong> {rental.return_at ? new Date(rental.return_at).toLocaleString() : "—"}
              </div>
              <div>
                <strong>Photo status:</strong> {ui?.photoStatus || "—"}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function TimelineItem(props: {
  n: number;
  title: string;
  status: "done" | "todo" | "disabled" | "blocked";
  note?: string;

  actionHref?: string;
  actionLabel?: string;

  onAction?: () => void;
  actionDisabled?: boolean;
  busy?: boolean;
}) {
  const pill =
    props.status === "done"
      ? { bg: "#ecfdf5", border: "#bbf7d0", color: "#166534", text: "Done" }
      : props.status === "blocked"
      ? { bg: "#fef2f2", border: "#fecaca", color: "#991b1b", text: "Blocked" }
      : props.status === "disabled"
      ? { bg: "#f3f4f6", border: "#e5e7eb", color: "#6b7280", text: "Locked" }
      : { bg: "#eff6ff", border: "#bfdbfe", color: "#1e3a8a", text: "Next" };

  const canClick = !!props.actionHref || !!props.onAction;

  return (
    <div style={styles.stepRow}>
      <div style={styles.stepNum}>{props.n}</div>

      <div style={{ flex: 1, minWidth: 220 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ fontWeight: 900 }}>{props.title}</div>
          <span
            style={{
              padding: "2px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 900,
              background: pill.bg,
              border: `1px solid ${pill.border}`,
              color: pill.color,
            }}
          >
            {pill.text}
          </span>
        </div>
        {props.note && <div style={{ marginTop: 6, color: "#4b5563", lineHeight: 1.5 }}>{props.note}</div>}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", minWidth: 120 }}>
        {!canClick ? (
          <span style={{ color: "#9ca3af", fontWeight: 800 }}>—</span>
        ) : props.actionHref ? (
          <Link
            href={props.actionHref}
            style={{
              ...styles.stepBtn,
              opacity: props.status === "disabled" ? 0.55 : 1,
              pointerEvents: props.status === "disabled" ? "none" : "auto",
            }}
          >
            {props.actionLabel || "Open"}
          </Link>
        ) : (
          <button
            onClick={props.onAction}
            disabled={!!props.actionDisabled || props.status === "disabled"}
            style={{
              ...styles.stepBtn,
              border: "none",
              cursor: props.actionDisabled || props.status === "disabled" ? "not-allowed" : "pointer",
              opacity: props.actionDisabled || props.status === "disabled" ? 0.55 : 1,
            }}
          >
            {props.busy ? "Working…" : props.actionLabel || "Run"}
          </button>
        )}
      </div>
    </div>
  );
}

const styles: Record<string, any> = {
  container: { maxWidth: 1100, margin: "0 auto", padding: 24 },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 18,
    flexWrap: "wrap",
  },
  h1: { margin: 0, fontSize: 32, letterSpacing: "-0.02em" },
  sub: { marginTop: 8, color: "#555", lineHeight: 1.5, maxWidth: 720 },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 18,
    background: "#fff",
    marginBottom: 14,
  },
  primaryLink: {
    display: "inline-block",
    padding: "10px 14px",
    borderRadius: 10,
    background: "#111827",
    color: "#fff",
    textDecoration: "none",
    fontWeight: 900,
  },
  ghostLink: {
    display: "inline-block",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontWeight: 900,
    textDecoration: "none",
    color: "#111",
  },
  notice: {
    marginBottom: 14,
    borderRadius: 14,
    padding: 12,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
  },
  stepRow: {
    display: "flex",
    gap: 12,
    padding: "12px 0",
    borderTop: "1px solid #f3f4f6",
    alignItems: "flex-start",
  },
  stepNum: {
    width: 30,
    height: 30,
    borderRadius: 999,
    background: "#111827",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 900,
    fontSize: 13,
    flexShrink: 0,
    marginTop: 2,
  },
  stepBtn: {
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    fontWeight: 900,
    textDecoration: "none",
    color: "#111",
  },
};