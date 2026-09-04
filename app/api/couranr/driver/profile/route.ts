import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  getMyDriverProfile,
  isDriverProfileFailure,
} from "@/lib/couranr/driver/profile";

export const dynamic = "force-dynamic";

/** GET — the calling driver's own operating profile and associated vehicles. */
export async function GET(req: NextRequest) {
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  const result = await getMyDriverProfile(auth.userId);
  if (isDriverProfileFailure(result)) return failureResponse(result);
  return NextResponse.json(result.value);
}
