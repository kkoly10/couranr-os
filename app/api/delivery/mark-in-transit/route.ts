import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isAdminUser } from "@/lib/delivery/deliveryAccess";
import { canTransition } from "@/lib/delivery/transitions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Named server command: start the delivery run (assigned -> in_transit).
 *
 * Previously this route took a deliveryId from an unauthenticated request body
 * and wrote `status: "in_transit"` with the service-role key onto ANY delivery.
 * It is now a verified command:
 *   1. the actor is resolved from a Bearer token via getUser()
 *   2. the actor must be the ASSIGNED driver, or a Couranr Operations admin
 *   3. the current state must be one the transition allows
 *   4. the write is guarded on that state, so two concurrent taps cannot both win
 *   5. the transition is recorded in delivery_admin_events
 *
 * The target status is fixed by this route. It is never read from the body.
 */
export async function POST(req: NextRequest) {
  let user;
  try {
    user = await getUserFromRequest(req);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let deliveryId = "";
  try {
    const body = await req.json();
    deliveryId = String(body?.deliveryId || "").trim();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!deliveryId) {
    return NextResponse.json(
      { error: "deliveryId is required" },
      { status: 400 }
    );
  }

  const { data: delivery, error: loadErr } = await supabaseAdmin
    .from("deliveries")
    .select("id, status, driver_id")
    .eq("id", deliveryId)
    .maybeSingle();

  if (loadErr || !delivery) {
    return NextResponse.json({ error: "Delivery not found" }, { status: 404 });
  }

  const isAdmin = await isAdminUser(user.id);
  const driverId = (delivery as any).driver_id;
  const isAssignedDriver =
    typeof driverId === "string" &&
    driverId.trim().length > 0 &&
    driverId.trim() === user.id;

  if (!isAdmin && !isAssignedDriver) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fromStatus = (delivery as any).status;
  const decision = canTransition(fromStatus, "in_transit", {
    role: isAdmin ? "admin" : "driver",
    isAssignedDriver,
  });

  if (!decision.allowed) {
    return NextResponse.json(
      {
        error: "Transition not allowed",
        from: fromStatus,
        to: "in_transit",
        reason: decision.reason,
      },
      { status: 409 }
    );
  }

  // Guarded on the observed status: if another actor moved the delivery between
  // the read above and this write, zero rows match and we report the conflict
  // instead of silently overwriting their transition.
  const { data: updated, error: upErr } = await supabaseAdmin
    .from("deliveries")
    .update({ status: "in_transit" })
    .eq("id", deliveryId)
    .eq("status", fromStatus)
    .select("id, status")
    .maybeSingle();

  if (upErr) {
    return NextResponse.json({ error: upErr.message }, { status: 500 });
  }

  if (!updated) {
    return NextResponse.json(
      { error: "Delivery changed while starting; reload and try again" },
      { status: 409 }
    );
  }

  await supabaseAdmin.from("delivery_admin_events").insert({
    delivery_id: deliveryId,
    admin_user_id: isAdmin ? user.id : null,
    event_type: "delivery_marked_in_transit",
    before_json: { status: fromStatus },
    after_json: {
      status: "in_transit",
      actor_role: isAdmin ? "admin" : "driver",
      actor_user_id: user.id,
    },
  });

  return NextResponse.json({ success: true, id: deliveryId, status: "in_transit" });
}
