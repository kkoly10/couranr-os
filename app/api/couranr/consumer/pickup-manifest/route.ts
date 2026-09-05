import { NextRequest, NextResponse } from "next/server";
import {
  isConsumerFailure,
  redeemGuestSessionToken,
} from "@/lib/couranr/consumer/send";
import {
  isPickupManifestFailure,
  setConsumerPickupManifest,
} from "@/lib/couranr/pickup/manifest";
import { normalizePickupManifestInput } from "@/lib/couranr/pickup/types";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

export async function POST(req:NextRequest) {
  const session=await redeemGuestSessionToken(req);
  if(isConsumerFailure(session)) return routeFailure("not_found");
  let body:any;
  try{body=await req.json();}catch{return routeFailure("invalid_input","Expected a JSON body.");}
  const expectedManifestVersion=Number(body?.expectedManifestVersion);
  if(!Number.isInteger(expectedManifestVersion)||expectedManifestVersion<0) {
    return routeFailure("invalid_input","A current pickup-details version is required.");
  }
  const manifest=normalizePickupManifestInput(body);
  if(manifest.ok === false) return routeFailure("invalid_input",manifest.message);
  const result=await setConsumerPickupManifest({
    guestSessionId:session.value.id,expectedManifestVersion,manifest:manifest.value,
  });
  if(isPickupManifestFailure(result)) return failureResponse(result);
  return NextResponse.json({pickupManifest:result.value});
}
