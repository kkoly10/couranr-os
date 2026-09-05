import { NextRequest, NextResponse } from "next/server";
import {
  isConsumerFailure,
  issueConsumerPickupCredential,
  redeemGuestSessionToken,
} from "@/lib/couranr/consumer/send";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic="force-dynamic";

/**
 * Anonymous by login, not by scope: the guest token resolves exactly one
 * consumer request and SQL proves the resulting delivery belongs to it.
 * The raw pickup code is returned exactly once and never logged/stored.
 */
export async function POST(req:NextRequest) {
  const session=await redeemGuestSessionToken(req);
  if(isConsumerFailure(session)) return routeFailure("not_found");
  const issued=await issueConsumerPickupCredential({session:session.value});
  if(isConsumerFailure(issued)) return failureResponse(issued);
  return NextResponse.json({pickupCredential:issued.value});
}
