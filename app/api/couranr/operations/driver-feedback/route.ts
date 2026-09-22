import { NextRequest, NextResponse } from "next/server";
import { resolveRequestActor, isActorDenied } from "@/lib/couranr/requests/actor";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { routeFailure, routeInternalFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/** Read-only Operations visibility. These are outstanding ledger liabilities,
 * not a payroll execution or an assertion that a driver has been paid. */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);
  const tips: Array<any> = [];
  for (let from = 0; ; from += 500) {
    const page = await supabaseAdmin.from("couranr_driver_tips")
      .select("id,driver_id,delivery_id,audience,amount_cents,captured_amount_cents,refunded_amount_cents,payment_state,disputed_at,captured_at")
      .order("created_at", { ascending: true }).range(from, from + 499);
    if (page.error) return routeInternalFailure({ operation: "driverFeedbackReport.tips",
      detail: page.error, message: "Driver tips could not be loaded." });
    tips.push(...(page.data ?? []));
    if (!page.data || page.data.length < 500) break;
  }
  const reviews = await supabaseAdmin.from("couranr_driver_reviews")
    .select("driver_id,delivery_id,audience,rating,comment,created_at")
    .order("created_at", { ascending: false }).limit(100);
  if (reviews.error) return routeInternalFailure({ operation: "driverFeedbackReport.reviews",
    detail: reviews.error, message: "Driver reviews could not be loaded." });
  const driverIds = [...new Set([
    ...tips.map((t) => String(t.driver_id)),
    ...(reviews.data ?? []).map((r) => String(r.driver_id)),
  ])];
  const drivers = driverIds.length ? await supabaseAdmin.from("couranr_drivers")
    .select("id,display_name").in("id", driverIds) : { data: [], error: null };
  if (drivers.error) return routeInternalFailure({ operation: "driverFeedbackReport.drivers",
    detail: drivers.error, message: "Driver profiles could not be loaded." });
  const names = new Map((drivers.data ?? []).map((d) => [String(d.id), String(d.display_name)]));
  const byDriver = new Map<string, { driverId: string; driverName: string; capturedCents: number;
    refundedCents: number; netCents: number; disputedHoldCents: number; tipCount: number }>();
  for (const tip of tips) {
    const id = String(tip.driver_id);
    const row = byDriver.get(id) ?? { driverId: id, driverName: names.get(id) ?? "Driver",
      capturedCents: 0, refundedCents: 0, netCents: 0, disputedHoldCents: 0, tipCount: 0 };
    const gross = Number(tip.captured_amount_cents ?? 0);
    const refunded = Number(tip.refunded_amount_cents ?? 0);
    row.capturedCents += gross;
    row.refundedCents += refunded;
    row.netCents += gross - refunded;
    if (tip.disputed_at) row.disputedHoldCents += gross - refunded;
    if (gross > 0) row.tipCount += 1;
    byDriver.set(id, row);
  }
  return NextResponse.json({
    asOf: new Date().toISOString(),
    drivers: [...byDriver.values()].sort((a, b) => a.driverName.localeCompare(b.driverName)),
    recentReviews: (reviews.data ?? []).map((review) => ({ ...review,
      driverName: names.get(String(review.driver_id)) ?? "Driver" })),
    note: "Couranr receives tips; driver payment occurs outside this system. Reconcile with payroll before disbursement. Disputed tips are on hold.",
  }, { headers: { "Cache-Control": "no-store" } });
}
