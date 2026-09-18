import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { isCustodyFailure, readCustodyBundle } from "@/lib/couranr/operations/custodyBundle";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

/**
 * Forces dynamic rendering AND is not, by itself, enough.
 *
 * Every PostgREST read is a GET with its filters in the query string, so the
 * Data Cache key is stable per query and a custody bundle could be answered
 * from a response cached before the seal was recorded. `lib/supabaseAdmin.ts`
 * passes `global: { fetch }` forcing `cache: "no-store"`, which is what
 * actually closes it; this line keeps the route itself out of static
 * rendering, matching every sibling under `operations/deliveries/[id]`.
 */
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * GET — the whole custody chain for one delivery, for an investigator.
 *
 * Operations only, gated exactly like `operations/proof/[proofId]/url`: no
 * ownership walk, because reviewing custody across every business IS the
 * Operations capability and there is no narrower answer this route could give.
 *
 * It returns NO media and NO link. Evidence is identified by proof id and by
 * problem-evidence id; the browser exchanges those at the existing signed-URL
 * endpoints, where the TTL is chosen by viewer role rather than by a caller.
 *
 * It is also a pure read: nothing here opens an incident, resolves a claim,
 * captures, refunds or credits anything. Assembling the evidence is not a
 * finding, and a finding is not a payment.
 */
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID_RE.test(params.id)) return routeFailure("not_found", "Delivery not found.");

  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const r = await readCustodyBundle({ actor: actor.actor, deliveryId: params.id });
  if (isCustodyFailure(r)) return failureResponse(r);
  return NextResponse.json({ custody: r.value });
}
