import { NextRequest, NextResponse } from "next/server";
import {
  issueRecipientDropoffCode,
  isTrackingFailure,
} from "@/lib/couranr/tracking/commands";
import { isWellFormedTrackingToken } from "@/lib/couranr/tracking/tokens";
import { failureResponse } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/**
 * Mint the recipient's drop-off PIN.
 *
 * UNAUTHENTICATED BY DESIGN, on the same terms as the adult-attestation route:
 * the recipient tracking token IS the authorization. It is shape-checked here,
 * hashed by the server command, and re-resolved in SQL as a live, unexpired,
 * recipient-audience credential against a governed consumer request.
 *
 * POST, not GET, for two reasons that both matter: it MINTS a credential and
 * supersedes the previous one, so it is not safe to replay from a prefetch, a
 * link preview or a browser's back-forward cache; and a GET would put the
 * response — which contains the PIN exactly once — into caches this codebase
 * has already been bitten by (a PostgREST GET answered from Next's Data Cache
 * for an assignment that did not exist yet).
 *
 * The body carries nothing. Everything the command needs it derives from the
 * token, so there is no field a caller could use to aim this at another
 * delivery.
 */
export async function POST(
  _req: NextRequest,
  props: { params: Promise<{ token: string }> }
) {
  const { token } = await props.params;
  if (!isWellFormedTrackingToken(token)) {
    return NextResponse.json({ issued: false }, { status: 404 });
  }

  const result = await issueRecipientDropoffCode({ rawToken: token });
  if (isTrackingFailure(result)) return failureResponse(result as any);

  /* Nested under a named key, like every other canonical route. Typing this
     flat is invisible to tsc — the routes return untyped JSON — and it is how
     proof upload stayed dead for its entire life. */
  return NextResponse.json({ dropoffCode: result.value });
}
