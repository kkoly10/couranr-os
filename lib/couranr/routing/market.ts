import { assertServerOnly } from "@/lib/couranr/serverOnly";
import type { GoogleAddressSnapshot } from "./address";

assertServerOnly("lib/couranr/routing/market.ts");

export const COURANR_AUTO_APPROVED_MARKETS = [
  { city: "Washington", region: "DC", countryCode: "US" },
  { city: "Stafford", region: "VA", countryCode: "US" },
  { city: "Woodbridge", region: "VA", countryCode: "US" },
  { city: "Fredericksburg", region: "VA", countryCode: "US" },
] as const;

const MARKET_KEYS = new Set(
  COURANR_AUTO_APPROVED_MARKETS.map(
    ({ city, region, countryCode }) =>
      `${countryCode.toUpperCase()}|${region.toUpperCase()}|${city.toLowerCase()}`
  )
);

function marketKey(
  address: Pick<GoogleAddressSnapshot, "city" | "region" | "countryCode">
): string {
  return `${address.countryCode.trim().toUpperCase()}|${address.region
    .trim()
    .toUpperCase()}|${address.city.trim().toLowerCase()}`;
}

export function isCouranrAutoApprovedMarket(
  address: Pick<GoogleAddressSnapshot, "city" | "region" | "countryCode">
): boolean {
  return MARKET_KEYS.has(marketKey(address));
}

/** Both verified endpoints must be in an exact named launch market. */
export function isCouranrAutoApprovedRouteMarket(
  pickup: Pick<GoogleAddressSnapshot, "city" | "region" | "countryCode">,
  dropoff: Pick<GoogleAddressSnapshot, "city" | "region" | "countryCode">
): boolean {
  return isCouranrAutoApprovedMarket(pickup) && isCouranrAutoApprovedMarket(dropoff);
}
