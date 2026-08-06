import { NextRequest, NextResponse } from "next/server";
import { isTrackingFailure, loadTrackingView } from "@/lib/couranr/tracking/commands";
import { isWellFormedTrackingToken } from "@/lib/couranr/tracking/tokens";
import { failureResponse } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * The customer tracking link (PUB-006, with CUS-006 and CUS-008 as sections).
 *
 * UNAUTHENTICATED BY DESIGN: the token IS the authorization, which is why it
 * carries 256 bits of entropy, is stored only as a SHA-256 hash, is scoped to
 * one request and one audience, expires within 30 days, and grants a read and
 * nothing else.
 *
 * ONE REFUSAL, ALWAYS. A link that never existed, one that was revoked and one
 * that expired all return the same body and the same status. The SQL knows
 * which; the server log knows which; the caller never does. PHO-001's
 * acceptance criterion is that an unauthorized caller receives the same
 * response as for a missing delivery, and a 410-for-expired against a
 * 404-for-unknown would confirm that a delivery exists to anyone probing.
 *
 * GET ONLY. There is no POST, PATCH or DELETE on this route and there must
 * never be one: a token that travels by SMS into group chats must not be able
 * to change anything. CUS-008's edit surface, when it lands, authenticates the
 * save separately.
 */

/** The single refusal. Not parameterized — there is nothing to parameterize. */
function refusal() {
  return NextResponse.json({ resolved: false }, { status: 404 });
}

export async function GET(_req: NextRequest, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  // Shape-checked before a hash is computed, so a lookup is never attempted for
  // attacker-shaped input. Same answer as any other refusal.
  if (!isWellFormedTrackingToken(params.token)) return refusal();

  const r = await loadTrackingView({ rawToken: params.token });
  // An infrastructure failure is NOT a refusal. Returning `resolved: false` for
  // a database outage would tell a waiting customer their link is dead when it
  // is fine, and `failureResponse` carries a correlation id support can trace.
  if (isTrackingFailure(r)) return failureResponse(r as any);
  if (!r.value.resolved) return refusal();

  // Nested under a named key, like every other canonical route.
  return NextResponse.json({ tracking: r.value.projection });
}
