/**
 * Google Places (New) address shapes shared by the browser selector and the
 * canonical server command. A browser selection is only a Place reference plus
 * user-authored access details. The complete snapshot becomes authority only
 * after the server resolves that Place ID with Place Details (New).
 */
export type GoogleAddressSnapshot = {
  googlePlaceId: string;
  formattedAddress: string;
  line1: string;
  line2: string | null;
  city: string;
  region: string;
  postalCode: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  addressSource: "google_places_new";
  /** Free-text access notes. Never a credential or authentication secret. */
  instructions: string | null;
};

export type GooglePlaceSelection = Pick<
  GoogleAddressSnapshot,
  "googlePlaceId" | "line2" | "instructions"
>;

export type GoogleAddressComponentLike = {
  types?: string[];
  longText?: string;
  shortText?: string;
  long_name?: string;
  short_name?: string;
};

export type GooglePlaceLike = {
  id?: string | null;
  placeId?: string | null;
  formattedAddress?: string | null;
  formatted_address?: string | null;
  displayName?: string | { text?: string | null } | null;
  addressComponents?: GoogleAddressComponentLike[] | null;
  address_components?: GoogleAddressComponentLike[] | null;
  location?:
    | {
        lat?: number | (() => number);
        lng?: number | (() => number);
        latitude?: number;
        longitude?: number;
      }
    | null;
};

function text(component: GoogleAddressComponentLike | undefined, short = false): string {
  if (!component) return "";
  const value = short
    ? component.shortText ?? component.short_name
    : component.longText ?? component.long_name;
  return typeof value === "string" ? value.trim() : "";
}

function component(
  components: GoogleAddressComponentLike[],
  ...types: string[]
): GoogleAddressComponentLike | undefined {
  return components.find((item) => item.types?.some((type) => types.includes(type)));
}

function coordinate(value: number | (() => number) | undefined): number | null {
  const resolved = typeof value === "function" ? value() : value;
  return typeof resolved === "number" && Number.isFinite(resolved) ? resolved : null;
}

function displayName(place: GooglePlaceLike): string {
  if (typeof place.displayName === "string") return place.displayName.trim();
  if (place.displayName && typeof place.displayName.text === "string") {
    return place.displayName.text.trim();
  }
  return "";
}

/**
 * Converts a selected Places API (New) Place into the only address shape the
 * Business request command accepts. It does not geocode user-entered text.
 */
export function normalizeGooglePlaceSelection(
  place: GooglePlaceLike,
  previous?: Pick<GoogleAddressSnapshot, "line2" | "instructions"> | null
): GoogleAddressSnapshot | null {
  const googlePlaceId = String(place.id ?? place.placeId ?? "").trim();
  const formattedAddress = String(
    place.formattedAddress ?? place.formatted_address ?? ""
  ).trim();
  const components = place.addressComponents ?? place.address_components ?? [];
  const latitude = coordinate(place.location?.lat ?? place.location?.latitude);
  const longitude = coordinate(place.location?.lng ?? place.location?.longitude);

  const streetNumber = text(component(components, "street_number"), true);
  const route = text(component(components, "route"));
  const premise = text(component(components, "premise", "point_of_interest"));
  const line1 = [streetNumber, route].filter(Boolean).join(" ") || premise || displayName(place);
  const city = text(
    component(
      components,
      "locality",
      "postal_town",
      "sublocality_level_1",
      "administrative_area_level_2"
    )
  );
  const region = text(component(components, "administrative_area_level_1"), true);
  const postalCode = text(component(components, "postal_code"), true);
  const countryCode = text(component(components, "country"), true).toUpperCase();

  if (
    !googlePlaceId ||
    !formattedAddress ||
    !line1 ||
    !city ||
    !region ||
    !postalCode ||
    !countryCode ||
    latitude === null ||
    longitude === null
  ) {
    return null;
  }

  return {
    googlePlaceId,
    formattedAddress,
    line1,
    line2: previous?.line2?.trim() || null,
    city,
    region,
    postalCode,
    countryCode,
    latitude,
    longitude,
    addressSource: "google_places_new",
    instructions: previous?.instructions?.trim() || null,
  };
}

export function googlePlaceIdFromAddress(address: unknown): string | null {
  return googlePlaceSelectionFromAddress(address)?.googlePlaceId ?? null;
}

/** Drops every browser-supplied address fact except Place ID and access text. */
export function googlePlaceSelectionFromAddress(
  address: unknown
): GooglePlaceSelection | null {
  if (address === null || typeof address !== "object" || Array.isArray(address)) return null;
  const raw = address as Record<string, unknown>;
  const value = raw.googlePlaceId;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const optionalText = (candidate: unknown) => {
    if (typeof candidate !== "string") return null;
    const text = candidate.trim();
    return text === "" ? null : text;
  };
  return {
    googlePlaceId: trimmed,
    line2: optionalText(raw.line2),
    instructions: optionalText(raw.instructions),
  };
}
