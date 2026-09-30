export type RouteRunState = "draft" | "accepted" | "abandoned" | "cancelled";

export type RouteRunStopView = {
  sequence: number;
  requestId: string;
  quoteVersionId: string;
  requestVersion: number;
  pickupManifestVersion: number;
  stale: boolean;
  claimed: boolean;
};

export type RouteRunView = {
  routeRunId: string;
  businessAccountId: string;
  state: RouteRunState;
  version: number;
  currentVersion: number;
  title: string;
  draftOnly: boolean;
  bookingAvailable: false;
  executionAvailable: false;
  stopCount: number;
  referenceQuoteTotalCents: number;
  quoteBasis: "independent_delivery_quotes_not_a_route_offer";
  acceptedVersion: number | null;
  acceptedAt: string | null;
  abandonedAt: string | null;
  cancelledAt: string | null;
  stops: RouteRunStopView[];
};

export type BusinessDeclaredValueView = {
  requestId: string;
  version: number;
  declaredValueCents: number;
  protectionLevel: "standard" | "secure_pickup" | "protected_handoff";
};
