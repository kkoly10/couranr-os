import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

describe("Business address autocomplete pilot path", () => {
  it("uses the authenticated server Places endpoint instead of the browser Maps widget", () => {
    const flow = read("components/couranr/requests/NewDeliveryFlow.tsx");
    const component = read("components/couranr/requests/BusinessPlaceAutocomplete.tsx");

    expect(flow).toContain("BusinessPlaceAutocomplete");
    expect(flow).not.toContain("next/script");
    expect(flow).not.toContain("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY");
    expect(flow).not.toContain("GooglePlaceAutocomplete");
    const client = read("components/couranr/requests/client.ts");
    expect(client).toContain("/api/couranr/merchant/places");
    expect(component).toContain('role="combobox"');
    expect(component).toContain('role="listbox"');
  });

  it("keeps Place Details and the server key on the server", () => {
    const route = read("app/api/couranr/merchant/places/route.ts");
    const component = read("components/couranr/requests/BusinessPlaceAutocomplete.tsx");

    expect(route).toContain("GOOGLE_MAPS_SERVER_API_KEY");
    expect(route).toContain("resolveCanonicalGooglePlace");
    expect(route).toContain("resolveRequestActor");
    expect(route).toContain('includedRegionCodes: ["US"]');
    expect(component).not.toContain("GOOGLE_MAPS_SERVER_API_KEY");
  });
});
