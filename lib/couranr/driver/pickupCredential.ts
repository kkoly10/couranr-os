const PREFIX = "couranr-pickup-v1";
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE_RE=/^\d{6}$/;

/**
 * QR payload deliberately carries only delivery identity + the same ephemeral
 * six-digit handoff credential the manual fallback uses. No PII, tracking
 * bearer, tenant id, price, or lifecycle state.
 */
export function formatPickupCredentialPayload(deliveryId:string,code:string):string {
  if(!UUID_RE.test(deliveryId)||!CODE_RE.test(code)) {
    throw new Error("Invalid pickup credential payload.");
  }
  return `${PREFIX}|${deliveryId.toLowerCase()}|${code}`;
}

export function parsePickupCredentialPayload(
  raw:unknown,
  expectedDeliveryId?:string,
):{deliveryId:string;code:string}|null {
  if(typeof raw!=="string") return null;
  const [prefix,deliveryId,code,...extra]=raw.trim().split("|");
  if(extra.length||prefix!==PREFIX||!UUID_RE.test(deliveryId??"")||!CODE_RE.test(code??"")) {
    return null;
  }
  if(expectedDeliveryId&&deliveryId.toLowerCase()!==expectedDeliveryId.toLowerCase()) {
    return null;
  }
  return {deliveryId:deliveryId.toLowerCase(),code};
}
