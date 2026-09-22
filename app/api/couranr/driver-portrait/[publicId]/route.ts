import { NextRequest } from "next/server";
import {
  isWellFormedPortraitPublicId,
  redeemDriverPortrait,
} from "@/lib/couranr/driver/publicProfile";
import { routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const missing = () => routeFailure("not_found", "Portrait not found.");

/** A revocable, unguessable portrait reference safe for email image proxies. */
export async function GET(_request: NextRequest, props: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await props.params;
  if (!isWellFormedPortraitPublicId(publicId)) return missing();
  const bytes = await redeemDriverPortrait(publicId);
  if (!bytes) return missing();
  return new Response(bytes, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
