import { NextRequest, NextResponse } from "next/server";
import { isDriverFailure } from "@/lib/couranr/driver/commands";
import { signedProofUrl } from "@/lib/couranr/driver/proof";
import { authorizeProofForToken, isTrackingFailure } from "@/lib/couranr/tracking/commands";
import { isWellFormedTrackingToken } from "@/lib/couranr/tracking/tokens";
import { failureResponse } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * CUS-006 — the proof image, behind a short-lived signed URL.
 *
 * PHO-001 names the owning customer as an authorized viewer and fixes their
 * TTL at 600 seconds, with `persist_signed_urls: false`. So the URL is minted
 * on demand, once per view, and nothing stores it: not the projection, not the
 * page, not a notification, not an analytics payload.
 *
 * TWO CHECKS, BOTH REQUIRED. `signedProofUrl` looks a proof up BY ID AND SIGNS
 * IT — it performs no authorization of its own, by design, because its three
 * callers scope differently. So this route scopes first:
 * `authorizeProofForToken` proves the proof belongs to the delivery THIS token
 * names and is a dropoff proof, and only then is anything minted. Dropping
 * either half would make any proof id in the system signable by anyone holding
 * any tracking link.
 *
 * Every refusal is the same 404 with no body detail — an unauthorized caller
 * receives the same response as for a missing delivery.
 */

function refusal() {
  return NextResponse.json({ resolved: false }, { status: 404 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string; proofId: string } }
) {
  if (!isWellFormedTrackingToken(params.token)) return refusal();
  if (!UUID_RE.test(params.proofId ?? "")) return refusal();

  const authorized = await authorizeProofForToken({
    rawToken: params.token,
    proofId: params.proofId,
  });
  if (isTrackingFailure(authorized)) return failureResponse(authorized as any);
  // Not this token's proof, not a dropoff proof, or a PIN record with no image.
  if (!authorized.value) return refusal();

  const signed = await signedProofUrl({
    proofId: authorized.value.proofId,
    // Never from the request. The viewer decides the TTL and the caller is not
    // the viewer's authority — a `?viewer=operations` would otherwise buy 900s.
    viewer: "customer",
  });
  if (isDriverFailure(signed)) return failureResponse(signed as any);

  return NextResponse.json({ proofUrl: signed.value });
}
