import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import {
  getReturnForDelivery,
  isReturnFailure,
  isReturnReason,
  requireReturn,
} from "@/lib/couranr/fulfillment/returns";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOTE_MAX=2000;

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID_RE.test(id)) return routeFailure("not_found","Delivery not found.");
  const actor=await resolveRequestActor(req,null);
  if (isActorDenied(actor)) return routeFailure(actor.code,actor.error);
  const r=await getReturnForDelivery(id);
  if (isReturnFailure(r)) return failureResponse(r);
  return NextResponse.json({ return: r.value });
}

/**
 * Operations chooses the custody outcome; the body carries no price, route
 * distance, target state or payer amount. REF-003 pricing stays server-owned
 * and pending until a new physical route is governed.
 */
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID_RE.test(id)) return routeFailure("not_found","Delivery not found.");
  const actor=await resolveRequestActor(req,null);
  if (isActorDenied(actor)) return routeFailure(actor.code,actor.error);
  let body:any;
  try { body=await req.json(); }
  catch { return routeFailure("invalid_input","Choose why the shipment must return."); }
  const expectedVersion=Number(body?.expectedVersion);
  const reason=body?.reason;
  const note=typeof body?.note==="string" ? body.note.trim() : "";
  if (!Number.isInteger(expectedVersion) || expectedVersion<1) {
    return routeFailure("invalid_input","Reload this delivery before deciding the return.");
  }
  if (!isReturnReason(reason)) return routeFailure("invalid_input","Choose a governed return reason.");
  if (note.length>NOTE_MAX) return routeFailure("invalid_input","That return note is too long.");
  const r=await requireReturn({
    actor:actor.actor,deliveryId:id,expectedVersion,reason,note:note||null,
  });
  if (isReturnFailure(r)) return failureResponse(r);
  return NextResponse.json({ return:r.value });
}
