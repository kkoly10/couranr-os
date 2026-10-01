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

/** Browser-safe RR-003 projection. Provider IDs and saved-card secrets stay server-side. */
export type RouteSettlementView = {
  settlementId: string;
  routeRunId: string;
  state: string;
  version: number;
  referenceTotalCents: number;
  currency: "usd";
  card: { brand: string; last4: string };
  pickupReadyConfirmed: boolean;
  uncertainObligationId: string | null;
  items: {
    sequence: number;
    requestId: string;
    quoteVersionId: string;
    obligationId: string;
    amountCents: number;
    paymentState: string;
    deliveryId: string | null;
    obligationVersion: number;
  }[];
};

export type RouteProgress = {
  settlement: RouteSettlementView;
  next: "continue" | "confirm_pickup_ready" | "authenticate_card" | "operations_review" | "ready";
  execution?: {
    state: string;
    currentSequence: number;
    resourceState: string;
    stops: Array<{ sequence: number; fulfillmentState: string }>;
  };
  actionClientSecret?: string;
};

/** No billing, provider, obligation, card, quote or settlement identity. */
export type RouteOperationalStatus =
  "payment_pending" | "ready_for_execution" | "operations_review";
export type RouteOperationalProgress = {
  kind: "operational";
  status: RouteOperationalStatus;
  execution?: { state: string; currentSequence: number; resourceState: string };
};
export type RouteCheckoutProgress = (RouteProgress & { kind: "billing" }) | RouteOperationalProgress;
export type RouteCheckoutAccess = { billingRead: boolean; authorizeRoute: boolean };
