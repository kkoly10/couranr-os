import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveUserId } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  isDriverProfileFailure,
  setMyAvailability,
} from "@/lib/couranr/driver/profile";

export const dynamic = "force-dynamic";

/**
 * PATCH — set the calling driver's NEXT-IDLE intent.
 *
 * No driver id and no target lifecycle state are accepted. While assigned, the
 * database keeps availability_state=on_delivery and only records whether the
 * driver wants to return online or offline when the assignment releases.
 */
export async function PATCH(req: NextRequest) {
  const auth = await resolveUserId(req);
  if (isActorDenied(auth)) return routeFailure(auth.code, auth.error);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Expected a JSON body.");
  }

  const expectedVersion = Number(body?.expectedVersion);
  const preference = body?.preference;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return routeFailure("invalid_input", "A current driver version is required.");
  }
  if (preference !== "available" && preference !== "unavailable") {
    return routeFailure("invalid_input", "Choose online or offline.");
  }

  const result = await setMyAvailability({
    userId: auth.userId,
    expectedVersion,
    preference,
  });
  if (isDriverProfileFailure(result)) return failureResponse(result);
  return NextResponse.json({ driver: result.value });
}
