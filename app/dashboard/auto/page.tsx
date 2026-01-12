"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

type RentalRow = {
  id: string;
  status: string;
  created_at: string;

  purpose: "personal" | "rideshare" | null;

  docs_complete: boolean;
  agreement_signed: boolean;
  paid: boolean;
  paid_at: string | null;

  verification_status: "pending" | "approved" | "denied" | null;
  verification_denial_reason: string | null;

  lockbox_code: string | null;
  lockbox_code_released_at: string | null;

  condition_photos_status:
    | "not_started"
    | "pickup_exterior_done"
    | "pickup_interior_done"
    | "return_exterior_done"
    | "return_interior_done"
    | "complete"
    | null;

  pickup_confirmed_at: string | null;
  return_confirmed_at: string | null;

  deposit_refund_status: "n/a" | "pending" | "refunded" | "withheld" | null;
  deposit_refund_amount_cents: number | null;

  start_date?: string | null;
  end_date?: string | null;
  pickup_location?: string | null;

  vehicles?: {
    year?: number | null;
    make?: string | null;
    model?: string | null;
    trim?: string | null;
    color?: string | null;
  } | null;
};

function formatDateTime(dt: string | null | undefined) {
  if (!dt) return "—";
  try {
    const d = new Date(dt);
    if (Number.isNaN(d.getTime())) return dt;
    return d.toLocaleString();
  } catch {
    return String(dt);
  }
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    // if date is YYYY-MM-DD
    const parts = d.split("-");
    if (parts.length === 3) {
      const asDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      return asDate.toLocaleDateString();
    }
    const asDate = new Date(d);
    return Number.isNaN(asDate.getTime()) ? d : asDate.toLocaleDateString();
  } catch {
    return String(d);
  }
}

function money(cents: number | null | undefined) {
  const n = Number(cents || 0);
  return `$${(n / 100).toFixed(2)}`;
}

type StepStatus = "done" | "next" | "locked";

type TimelineStep = {
  key: string;
  label: string;
  description: string;
  status: StepStatus;
  actionLabel?: string;
  actionHref?: string;
};

function buildTimeline(r: RentalRow): TimelineStep[] {
  const docsDone = !!r.docs_complete;
  const agreementDone = !!r.agreement_signed;
  const paidDone = !!r.paid;
  const approved = r.verification_status === "approved";
  const denied = r.verification_status === "denied";

  // Photos state machine (we keep it simple here; your C4–C7 SQL supports this)
  const photoStatus = r.condition_photos_status || "not_started";
  const pickupExteriorDone =
    photoStatus === "pickup_exterior_done" ||
    photoStatus === "pickup_interior_done" ||
    photoStatus === "return_exterior_done" ||
    photoStatus === "return_interior_done" ||
    photoStatus === "complete";

  const pickupInteriorDone =
    photoStatus === "pickup_interior_done" ||
    photoStatus === "return_exterior_done" ||
    photoStatus === "return_interior_done" ||
    photoStatus === "complete";

  const returnExteriorDone =
    photoStatus === "return_exterior_done" ||
    photoStatus === "return_interior_done" ||
    photoStatus === "complete";

  const returnInteriorDone =
    photoStatus === "return_interior_done" ||
    photoStatus === "complete";

  const depositDone =
    r.deposit_refund_status === "refunded" || r.deposit_refund_status === "withheld";

  // Determine "next actionable" based on strict order:
  // 1) docs -> 2) agreement -> 3) payment -> 4) admin approval -> 5) lockbox -> 6) pickup photos -> 7) active -> 8) return photos -> 9) deposit
  // (some steps are informational, not clickable yet)
  const steps: TimelineStep[] = [];

  // 1) Upload ID & Selfie
  steps.push({
    key: "docs",
    label: "Upload ID, Selfie & Insurance",
    description: "License front/back + selfie + license state/expiry + insurance confirmation (GPS/time stamped).",
    status: docsDone ? "done" : "next",
    actionLabel: docsDone ? undefined : "Upload verification",
    actionHref: docsDone ? undefined : `/auto/verify?rentalId=${encodeURIComponent(r.id)}`,
  });

  // 2) Agreement
  const agreementStatus: StepStatus = docsDone ? (agreementDone ? "done" : "next") : "locked";
  steps.push({
    key: "agreement",
    label: "Review & sign agreement",
    description: "You must accept the correct policy (Personal vs Rideshare) before payment.",
    status: agreementStatus,
    actionLabel: agreementStatus === "next" ? "Open agreement" : undefined,
    actionHref:
      agreementStatus === "next"
        ? `/auto/agreement?rentalId=${encodeURIComponent(r.id)}`
        : undefined,
  });

  // 3) Payment
  const payStatus: StepStatus = docsDone && agreementDone ? (paidDone ? "done" : "next") : "locked";
  steps.push({
    key: "payment",
    label: "Pay to reserve",
    description: "Payment confirms the reservation. Deposit (if any) is collected here too.",
    status: payStatus,
    actionLabel: payStatus === "next" ? "Pay now" : undefined,
    actionHref:
      payStatus === "next"
        ? `/auto/checkout?rentalId=${encodeURIComponent(r.id)}`
        : undefined,
  });

  // 4) Admin approval
  let approvalStatus: StepStatus = "locked";
  if (docsDone && agreementDone && paidDone) {
    approvalStatus = approved ? "done" : "next";
  }
  steps.push({
    key: "approval",
    label: "Manual approval",
    description: denied
      ? `Denied: ${r.verification_denial_reason || "Contact support."}`
      : "We review your verification and reservation. Approval is required before key access.",
    status: approved ? "done" : approvalStatus,
    actionLabel: approvalStatus === "next" && !approved ? "Awaiting approval" : undefined,
  });

  // 5) Lockbox code
  const lockboxReady = approved && paidDone && !!r.lockbox_code;
  const lockboxStatus: StepStatus = approved && paidDone ? (lockboxReady ? "done" : "next") : "locked";
  steps.push({
    key: "lockbox",
    label: "Lockbox access",
    description: lockboxReady
      ? "Lockbox code released. Keep it private."
      : "Lockbox code will appear here after approval.",
    status: lockboxReady ? "done" : lockboxStatus,
  });

  // 6) Pickup photos (exterior before unlock, interior after unlock)
  // We show them as informational steps; you can wire actionHref once the photo UI is added.
  const pickupExteriorStatus: StepStatus =
    lockboxReady ? (pickupExteriorDone ? "done" : "next") : "locked";
  steps.push({
    key: "pickup_exterior",
    label: "Pickup photos (exterior)",
    description: "Before taking the keys: walk-around photos (GPS/time stamped).",
    status: pickupExteriorDone ? "done" : pickupExteriorStatus,
  });

  const pickupInteriorStatus: StepStatus =
    lockboxReady && pickupExteriorDone ? (pickupInteriorDone ? "done" : "next") : "locked";
  steps.push({
    key: "pickup_interior",
    label: "Pickup photos (interior)",
    description: "After unlock: interior photos (GPS/time stamped).",
    status: pickupInteriorDone ? "done" : pickupInteriorStatus,
  });

  // 7) Active rental
  const activeStatus: StepStatus =
    lockboxReady && pickupExteriorDone ? "next" : "locked";
  steps.push({
    key: "active",
    label: "Active rental",
    description: "Drive safely. Keep receipts and follow mileage + policy rules.",
    status:
      r.status === "active" || r.pickup_confirmed_at
        ? "done"
        : activeStatus,
  });

  // 8) Return photos
  const returnExteriorStatus: StepStatus =
    r.status === "active" || r.pickup_confirmed_at ? (returnExteriorDone ? "done" : "next") : "locked";
  steps.push({
    key: "return_exterior",
    label: "Return photos (exterior)",
    description: "At return: exterior photos at the return location/time window.",
    status: returnExteriorDone ? "done" : returnExteriorStatus,
  });

  const returnInteriorStatus: StepStatus =
    returnExteriorDone ? (returnInteriorDone ? "done" : "next") : "locked";
  steps.push({
    key: "return_interior",
    label: "Return photos (interior)",
    description: "Interior photos at return (required for deposit decision).",
    status: returnInteriorDone ? "done" : returnInteriorStatus,
  });

  // 9) Deposit outcome
  const depositStatus: StepStatus =
    returnInteriorDone ? (depositDone ? "done" : "next") : "locked";
  steps.push({
    key: "deposit",
    label: "Deposit decision",
    description:
      r.deposit_refund_status === "refunded"
        ? `Deposit refunded (${money(r.deposit_refund_amount_cents || 0)}).`
        : r.deposit_refund_status === "withheld"
        ? `Deposit withheld (${money(r.deposit_refund_amount_cents || 0)}).`
        : "After return photos, we finalize deposit refund/withhold.",
    status: depositDone ? "done" : depositStatus,
  });

  // Mark only the FIRST "next" as next, all later "next" become locked (so customer has 1 clear action)
  let foundNext = false;
  return steps.map((s) => {
    if (s.status !== "next") return s;
    if (!foundNext) {
      foundNext = true;
      return s;
    }
    return { ...s, status: "locked", actionHref: undefined, actionLabel: undefined };
  });
}

function badge(status: StepStatus) {
  if (status === "done") return { text: "Done", style: styles.badgeDone };
  if (status === "next") return { text: "Next", style: styles.badgeNext };
  return { text: "Locked", style: styles.badgeLocked };
}

export default function AutoDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function boot() {
      setLoading(true);
      setError(null);

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;

      if (!token) {
        router.push("/login?next=/dashboard/auto");
        return;
      }

      try {
        const res = await fetch("/api/auto/my-rentals", {
          headers: { Authorization: `Bearer ${token}` },
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json?.error || "Failed to load rentals");

        setRentals(json.rentals || []);
      } catch (e: any) {
        setError(e?.message || "Failed to load rentals");
      } finally {
        setLoading(false);
      }
    }

    boot();
  }, [router]);

  const pickupLocationLocked = "1090 Stafford Marketplace, VA 22556";
  const hoursLocked = "9:00 AM – 6:00 PM";

  if (loading) return <p style={{ padding: 24 }}>Loading auto dashboard…</p>;

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <h1 style={styles.h1}>My rentals</h1>
          <p style={styles.sub}>
            One place to complete verification, agreement, payment, approval, lockbox access, and photos.
          </p>
        </div>

        <div style={styles.headerBtns}>
          <Link href="/auto/vehicles" style={styles.primaryLink}>
            Book a car
          </Link>
          <Link href="/dashboard" style={styles.ghostLink}>
            Back to dashboards
          </Link>
        </div>
      </div>

      <div style={styles.notice}>
        <strong>Pickup/Return:</strong> {pickupLocationLocked} • <strong>Hours:</strong> {hoursLocked} •{" "}
        <strong>Lead time:</strong> 50 minutes (rounded to next 30-minute block)
      </div>

      {error && (
        <div style={{ ...styles.card, borderColor: "#fecaca" }}>
          <strong style={{ color: "#b91c1c" }}>Error:</strong> {error}
        </div>
      )}

      {rentals.length === 0 ? (
        <div style={styles.card}>
          <p style={{ margin: 0 }}>
            You don’t have any rentals yet.{" "}
            <Link href="/auto/vehicles" style={{ fontWeight: 800 }}>
              View available cars
            </Link>
            .
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {rentals.map((r) => {
            const car = r.vehicles;
            const label =
              `${car?.year ?? ""} ${car?.make ?? ""} ${car?.model ?? ""}`.trim() || "Vehicle";

            const timeline = buildTimeline(r);

            const nextStep = timeline.find((s) => s.status === "next") || null;

            return (
              <div key={r.id} style={styles.card}>
                <div style={styles.cardTop}>
                  <div>
                    <div style={styles.carTitle}>{label}</div>
                    <div style={styles.meta}>
                      <span>
                        <strong>Purpose:</strong>{" "}
                        {r.purpose === "rideshare" ? "Rideshare (Uber/Lyft)" : "Personal / Leisure"}
                      </span>
                      <span style={styles.dot}>•</span>
                      <span>
                        <strong>Start:</strong> {formatDate(r.start_date)}
                      </span>
                      <span style={styles.dot}>•</span>
                      <span>
                        <strong>End:</strong> {formatDate(r.end_date)}
                      </span>
                    </div>

                    <div style={styles.meta2}>
                      <span>
                        <strong>Status:</strong> {r.status || "—"}
                      </span>
                      <span style={styles.dot}>•</span>
                      <span>
                        <strong>Created:</strong> {formatDateTime(r.created_at)}
                      </span>
                      {r.paid && (
                        <>
                          <span style={styles.dot}>•</span>
                          <span>
                            <strong>Paid:</strong> {formatDateTime(r.paid_at)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={styles.smallLabel}>Rental ID</div>
                    <div style={styles.mono}>{r.id}</div>

                    {r.lockbox_code && r.verification_status === "approved" && r.paid ? (
                      <div style={styles.lockboxBox}>
                        <div style={{ fontWeight: 900 }}>🔓 Lockbox code</div>
                        <div style={{ fontSize: 20, letterSpacing: "0.12em", fontWeight: 900 }}>
                          {r.lockbox_code}
                        </div>
                        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                          Released: {formatDateTime(r.lockbox_code_released_at)}
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: "#6b7280", marginTop: 10 }}>
                        Lockbox code appears after <strong>approval + payment</strong>.
                      </div>
                    )}
                  </div>
                </div>

                {/* Next action */}
                <div style={styles.nextActionRow}>
                  <div>
                    <div style={{ fontWeight: 900, marginBottom: 4 }}>What to do next</div>
                    <div style={{ color: "#4b5563" }}>
                      {nextStep ? nextStep.label : "No action required right now."}
                    </div>
                    {r.verification_status === "denied" && (
                      <div style={{ marginTop: 8, color: "#b91c1c", fontWeight: 800 }}>
                        Verification denied: {r.verification_denial_reason || "Please re-upload documents."}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {nextStep?.actionHref ? (
                      <Link href={nextStep.actionHref} style={styles.primaryLink}>
                        {nextStep.actionLabel || "Continue"}
                      </Link>
                    ) : (
                      <button style={styles.disabledBtn} disabled>
                        {nextStep ? "Complete prior steps" : "All set"}
                      </button>
                    )}

                    <Link href="/auto/vehicles" style={styles.ghostLink}>
                      Browse cars
                    </Link>
                  </div>
                </div>

                {/* Timeline */}
                <div style={styles.timeline}>
                  {timeline.map((s) => {
                    const b = badge(s.status);
                    return (
                      <div key={s.key} style={styles.step}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={b.style}>{b.text}</span>
                          <div style={{ fontWeight: 900 }}>{s.label}</div>
                        </div>
                        <div style={{ marginTop: 6, color: "#4b5563", lineHeight: 1.55 }}>
                          {s.description}
                        </div>

                        {s.actionHref && s.status === "next" && (
                          <div style={{ marginTop: 10 }}>
                            <Link href={s.actionHref} style={styles.secondaryLink}>
                              {s.actionLabel || "Continue"}
                            </Link>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ marginTop: 18, ...styles.notice }}>
        <strong>Note:</strong> This dashboard is auto-only. Deliveries are managed separately in{" "}
        <Link href="/dashboard/delivery" style={{ fontWeight: 900 }}>
          Delivery Dashboard
        </Link>
        .
      </div>
    </div>
  );
}

const styles: Record<string, any> = {
  container: {
    maxWidth: 1100,
    margin: "0 auto",
    padding: 24,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
    flexWrap: "wrap",
  },
  h1: {
    margin: 0,
    fontSize: 34,
    letterSpacing: "-0.02em",
  },
  sub: {
    marginTop: 8,
    color: "#555",
    lineHeight: 1.6,
    maxWidth: 760,
  },
  headerBtns: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
  },
  notice: {
    borderRadius: 14,
    padding: 12,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1e3a8a",
    marginBottom: 16,
  },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    padding: 18,
    background: "#fff",
  },
  cardTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 18,
    flexWrap: "wrap",
  },
  carTitle: {
    fontSize: 20,
    fontWeight: 900,
  },
  meta: {
    marginTop: 8,
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    color: "#374151",
    lineHeight: 1.6,
  },
  meta2: {
    marginTop: 6,
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    color: "#6b7280",
    lineHeight: 1.6,
    fontSize: 13,
  },
  dot: { color: "#d1d5db" },
  smallLabel: { fontSize: 12, color: "#6b7280", fontWeight: 800 },
  mono: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12 },
  lockboxBox: {
    marginTop: 10,
    borderRadius: 14,
    padding: 12,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    minWidth: 220,
  },
  nextActionRow: {
    marginTop: 16,
    borderTop: "1px solid #f3f4f6",
    paddingTop: 14,
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
  },
  timeline: {
    marginTop: 16,
    display: "grid",
    gap: 12,
  },
  step: {
    border: "1px solid #f3f4f6",
    background: "#fcfcfd",
    borderRadius: 14,
    padding: 14,
  },
  badgeDone: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    background: "#dcfce7",
    border: "1px solid #86efac",
    color: "#166534",
    fontSize: 12,
    fontWeight: 900,
  },
  badgeNext: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    background: "#fff7ed",
    border: "1px solid #fdba74",
    color: "#9a3412",
    fontSize: 12,
    fontWeight: 900,
  },
  badgeLocked: {
    display: "inline-block",
    padding: "4px 8px",
    borderRadius: 999,
    background: "#f3f4f6",
    border: "1px solid #e5e7eb",
    color: "#6b7280",
    fontSize: 12,
    fontWeight: 900,
  },
  primaryLink: {
    display: "inline-block",
    padding: "10px 16px",
    borderRadius: 10,
    background: "#111827",
    color: "#fff",
    textDecoration: "none",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  secondaryLink: {
    display: "inline-block",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111",
    textDecoration: "none",
    fontWeight: 900,
  },
  ghostLink: {
    display: "inline-block",
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#111",
    textDecoration: "none",
    fontWeight: 900,
    whiteSpace: "nowrap",
  },
  disabledBtn: {
    padding: "10px 16px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    color: "#9ca3af",
    fontWeight: 900,
    cursor: "not-allowed",
  },
};