import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  publicFailure,
  type PublicFailure,
} from "@/lib/couranr/errors";
import type { GuestSession } from "@/lib/couranr/consumer/send";
import type { RequestActor } from "@/lib/couranr/requests/permissions";
import { canActOnDeliveryRequest } from "@/lib/couranr/requests/permissions";
import {
  deriveCanonicalRouteAndQuote,
  isCanonicalAddressResolutionError,
} from "@/lib/couranr/routing/canonicalRoute";
import { quoteArgs, routeArgs, timingArgs } from "@/lib/couranr/requests/commands";
import { factsFromDraft } from "@/lib/couranr/shipment/draftFacts";
import { evaluateShipmentPolicy } from "@/lib/couranr/shipment/policy";
import { applyShipmentPolicyToQuote } from "@/lib/couranr/shipment/quoteStatus";
import { scanRestrictedSignals } from "@/lib/couranr/shipment/restrictedSignals";
import {
  isRestrictedClassDeclaration,
  isWeightBand,
  type RestrictedClassDeclaration,
  type WeightBand,
} from "@/lib/couranr/shipment/facts";

assertServerOnly("lib/couranr/hosted/commands.ts");

export type HostedResult<T> = { ok: true; value: T } | PublicFailure;
export function isHostedFailure(r: { ok: boolean }): r is PublicFailure {
  return r.ok === false;
}

const RPC = {
  create: "couranr_create_hosted_delivery_request",
  validate: "couranr_validate_hosted_delivery_request",
  decline: "couranr_decline_hosted_delivery_request",
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PublicHostedMerchant = {
  name: string;
  slug: string;
  payerDefault: "merchant" | "customer";
};

export type HostedIntakeView = {
  requestId: string;
  hostBusinessAccountId: string;
  orderReference: string;
  dropoffPlaceId: string;
  dropoffDisplayText: string;
  shipmentDescription: string;
  requestedPayerType: "merchant" | "customer";
  intakeState: "awaiting_merchant_confirmation" | "validated" | "declined";
  declineReason: string | null;
  createdAt: string;
  validatedAt: string | null;
  declinedAt: string | null;
};

export type HostedGuestStatus = {
  merchantName: string;
  merchantSlug: string;
  requestState: string;
  intakeState: HostedIntakeView["intakeState"];
  payerType: "merchant" | "customer";
  quoteStatus: string;
  totalCents: number | null;
  declineReason: string | null;
};

function fail(
  operation: string,
  code: Parameters<typeof publicFailure>[0]["code"],
  detail?: unknown,
  message?: string
): PublicFailure {
  return publicFailure({ operation, code, detail, message });
}

async function rpc<T>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<HostedResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as {
    data: T | null;
    error: any;
  };
  if (error) {
    return fail(operation, classifyDatabaseError(error), {
      fn,
      code: error.code,
      message: error.message,
    });
  }
  if (data === null || data === undefined) {
    return fail(operation, "conflict", { fn, reason: "no row returned" });
  }
  return { ok: true, value: data };
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const out = value.trim();
  if (!out || out.length > max) return null;
  return out;
}

function emailOrNull(value: unknown): string | null {
  const text = cleanText(value, 254);
  if (!text) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : null;
}

function phoneOrNull(value: unknown): string | null {
  const text = cleanText(value, 40);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15 ? text : null;
}

function exactOrBand(raw: any):
  | { weightLb: number; weightBand: null }
  | { weightLb: null; weightBand: WeightBand }
  | null {
  const exactRaw = raw?.weightLb;
  const bandRaw = raw?.weightBand;
  const hasExact = exactRaw !== null && exactRaw !== undefined && String(exactRaw).trim() !== "";
  const hasBand = bandRaw !== null && bandRaw !== undefined && String(bandRaw).trim() !== "";
  if (hasExact === hasBand) return null;
  if (hasExact) {
    const n = Number(exactRaw);
    if (!Number.isFinite(n) || n <= 0 || n > 100000) return null;
    return { weightLb: n, weightBand: null };
  }
  if (!isWeightBand(bandRaw)) return null;
  return { weightLb: null, weightBand: bandRaw };
}

export async function getPublicHostedMerchant(
  rawSlug: unknown
): Promise<HostedResult<PublicHostedMerchant>> {
  const operation = "getPublicHostedMerchant";
  const slug = cleanText(rawSlug, 100);
  if (!slug) return fail(operation, "not_found");

  const { data, error } = (await supabaseAdmin
    .from("business_accounts")
    .select(
      "name,slug,couranr_website_tool_configs!inner(status)," +
        "couranr_workspace_activations!inner(activation_state)," +
        "couranr_merchant_workspaces!inner(payer_default)"
    )
    .ilike("slug", slug)
    .eq("status", "active")
    .eq("couranr_website_tool_configs.status", "published")
    .eq("couranr_workspace_activations.activation_state", "live")
    .limit(1)
    .maybeSingle()) as { data: any; error: any };

  if (error) return fail(operation, "internal", error);
  if (!data) return fail(operation, "not_found");

  const workspace = Array.isArray(data.couranr_merchant_workspaces)
    ? data.couranr_merchant_workspaces[0]
    : data.couranr_merchant_workspaces;
  const payerDefault =
    workspace?.payer_default === "merchant" ? "merchant" : "customer";

  return {
    ok: true,
    value: {
      name: String(data.name),
      slug: String(data.slug),
      payerDefault,
    },
  };
}

export async function createHostedRequest(params: {
  session: GuestSession;
  merchantSlug: string;
  rawInput: unknown;
}): Promise<HostedResult<{ requestId: string; requestState: string }>> {
  const operation = "createHostedRequest";
  if (!params.session?.id || params.session.requestId) {
    return fail(operation, "conflict", { reason: "session_already_bound" });
  }

  const body = params.rawInput && typeof params.rawInput === "object" ? (params.rawInput as any) : {};
  const orderReference = cleanText(body.orderReference, 120);
  const dropoffPlaceId = cleanText(body.dropoffPlaceId, 512);
  const dropoffDisplayText = cleanText(body.dropoffDisplayText, 500);
  const shipmentDescription = cleanText(body.shipmentDescription, 2000);
  const name = cleanText(body?.contact?.name, 160);
  const phone = phoneOrNull(body?.contact?.phone);
  const email = emailOrNull(body?.contact?.email);
  const weight = exactOrBand(body);
  const restrictedClass = body.restrictedClass;
  const payerType = body.payerType;
  const signatureRequired = body.signatureRequired;

  if (
    !orderReference ||
    !dropoffPlaceId ||
    !dropoffDisplayText ||
    !shipmentDescription ||
    (!phone && !email) ||
    !weight ||
    !isRestrictedClassDeclaration(restrictedClass) ||
    (payerType !== "merchant" && payerType !== "customer") ||
    typeof signatureRequired !== "boolean"
  ) {
    return fail(
      operation,
      "invalid_input",
      { reason: "hosted_request_input_invalid" },
      "Check the order, delivery address, contact, package details and payer choice."
    );
  }

  const result = await rpc<Record<string, any>>(operation, RPC.create, {
    p_guest_session_id: params.session.id,
    p_merchant_slug: params.merchantSlug,
    p_idempotency_key: "hosted-request-v1",
    p_order_reference: orderReference,
    p_contact: { name, phone, email },
    p_dropoff_place_id: dropoffPlaceId,
    p_dropoff_display_text: dropoffDisplayText,
    p_shipment_description: shipmentDescription,
    p_weight_lb: weight.weightLb,
    p_weight_band: weight.weightBand,
    p_restricted_class: restrictedClass,
    p_signature_required: signatureRequired,
    p_requested_payer_type: payerType,
  });
  if (isHostedFailure(result)) return result;

  return {
    ok: true,
    value: {
      requestId: String(result.value.id),
      requestState: String(result.value.request_state),
    },
  };
}

export async function getHostedGuestStatus(params: {
  session: GuestSession;
  merchantSlug?: string | null;
}): Promise<HostedResult<HostedGuestStatus>> {
  const operation = "getHostedGuestStatus";
  if (!params.session.requestId) return fail(operation, "not_found");

  const { data, error } = (await supabaseAdmin
    .from("couranr_hosted_request_intakes")
    .select(
      "request_id,intake_state,requested_payer_type,decline_reason," +
        "business_accounts!couranr_hosted_request_intakes_host_business_account_id_fkey(name,slug)," +
        "couranr_delivery_requests!inner(request_state,payer_type,quote_status,delivery_subtotal_cents)"
    )
    .eq("request_id", params.session.requestId)
    .eq("guest_session_id", params.session.id)
    .maybeSingle()) as { data: any; error: any };
  if (error) return fail(operation, "internal", error);
  if (!data) return fail(operation, "not_found");

  const business = Array.isArray(data.business_accounts)
    ? data.business_accounts[0]
    : data.business_accounts;
  const request = Array.isArray(data.couranr_delivery_requests)
    ? data.couranr_delivery_requests[0]
    : data.couranr_delivery_requests;
  if (
    params.merchantSlug &&
    String(business?.slug ?? "").toLowerCase() !== params.merchantSlug.toLowerCase()
  ) {
    return fail(operation, "not_found");
  }

  return {
    ok: true,
    value: {
      merchantName: String(business?.name ?? ""),
      merchantSlug: String(business?.slug ?? ""),
      requestState: String(request?.request_state ?? ""),
      intakeState: data.intake_state,
      payerType: request?.payer_type === "merchant" ? "merchant" : "customer",
      quoteStatus: String(request?.quote_status ?? "not_quoted"),
      totalCents:
        request?.delivery_subtotal_cents === null ||
        request?.delivery_subtotal_cents === undefined
          ? null
          : Number(request.delivery_subtotal_cents),
      declineReason: data.decline_reason ?? null,
    },
  };
}

export async function getHostedIntakeForMerchant(params: {
  actor: RequestActor;
  hostBusinessAccountId: string;
  requestId: string;
}): Promise<HostedResult<HostedIntakeView | null>> {
  const operation = "getHostedIntakeForMerchant";
  const permission = canActOnDeliveryRequest(
    params.actor,
    "read",
    params.hostBusinessAccountId
  );
  if (!permission.allowed) {
    return fail(operation, "not_permitted", { reason: permission.reason });
  }

  const { data, error } = (await supabaseAdmin
    .from("couranr_hosted_request_intakes")
    .select(
      "request_id,host_business_account_id,order_reference,dropoff_place_id," +
        "dropoff_display_text,shipment_description,requested_payer_type,intake_state," +
        "decline_reason,created_at,validated_at,declined_at"
    )
    .eq("request_id", params.requestId)
    .eq("host_business_account_id", params.hostBusinessAccountId)
    .maybeSingle()) as { data: any; error: any };
  if (error) return fail(operation, "internal", error);
  if (!data) return { ok: true, value: null };

  return {
    ok: true,
    value: {
      requestId: String(data.request_id),
      hostBusinessAccountId: String(data.host_business_account_id),
      orderReference: String(data.order_reference),
      dropoffPlaceId: String(data.dropoff_place_id),
      dropoffDisplayText: String(data.dropoff_display_text),
      shipmentDescription: String(data.shipment_description),
      requestedPayerType:
        data.requested_payer_type === "merchant" ? "merchant" : "customer",
      intakeState: data.intake_state,
      declineReason: data.decline_reason ?? null,
      createdAt: String(data.created_at),
      validatedAt: data.validated_at ? String(data.validated_at) : null,
      declinedAt: data.declined_at ? String(data.declined_at) : null,
    },
  };
}

export async function validateHostedRequest(params: {
  actor: RequestActor;
  hostBusinessAccountId: string;
  requestId: string;
  expectedVersion: number;
  rawInput: unknown;
}): Promise<HostedResult<Record<string, any>>> {
  const operation = "validateHostedRequest";
  const permission = canActOnDeliveryRequest(
    params.actor,
    "submit",
    params.hostBusinessAccountId
  );
  if (!permission.allowed || params.actor.kind !== "member") {
    return fail(operation, "not_permitted", { reason: permission.reason });
  }
  if (!UUID_RE.test(params.requestId) || !Number.isInteger(params.expectedVersion)) {
    return fail(operation, "invalid_input");
  }

  const body = params.rawInput && typeof params.rawInput === "object" ? (params.rawInput as any) : {};
  const pickupPlaceId = cleanText(body.pickupPlaceId, 512);
  const payerType = body.payerType;
  const restrictedClass = body.restrictedClass;
  const signatureRequired = body.signatureRequired;
  const weight = exactOrBand(body);
  if (
    !pickupPlaceId ||
    !weight ||
    !isRestrictedClassDeclaration(restrictedClass) ||
    (payerType !== "merchant" && payerType !== "customer") ||
    typeof signatureRequired !== "boolean"
  ) {
    return fail(
      operation,
      "invalid_input",
      { reason: "merchant_validation_input_invalid" },
      "Confirm the pickup, destination, payer, weight and shipment declaration."
    );
  }

  const intake = await getHostedIntakeForMerchant({
    actor: params.actor,
    hostBusinessAccountId: params.hostBusinessAccountId,
    requestId: params.requestId,
  });
  if (isHostedFailure(intake)) return intake;
  if (!intake.value) return fail(operation, "not_found");
  if (intake.value.intakeState === "declined") {
    return fail(operation, "conflict", { reason: "already_declined" });
  }

  let routed: Awaited<ReturnType<typeof deriveCanonicalRouteAndQuote>>;
  try {
    routed = await deriveCanonicalRouteAndQuote({
      pickupAddress: { googlePlaceId: pickupPlaceId },
      // The customer-selected destination is durable intake evidence.
      // Validation confirms it; a browser cannot replace it while validating.
      dropoffAddress: { googlePlaceId: intake.value.dropoffPlaceId },
      weightLb: weight.weightLb,
      weightBand: weight.weightBand,
      additionalStops: 0,
      serviceLevel: "standard",
      signatureRequired,
      overnightRequested: false,
      timingIntent: "asap",
      requestedPickupLocal: null,
    });
  } catch (error) {
    if (isCanonicalAddressResolutionError(error)) {
      return fail(
        operation,
        "invalid_input",
        { field: error.field, reason: error.reason },
        "Couranr could not verify one of the selected addresses."
      );
    }
    return fail(operation, "internal", error);
  }

  const textSignals = scanRestrictedSignals(intake.value.shipmentDescription);
  const policy = evaluateShipmentPolicy(
    factsFromDraft({
      weightLb: weight.weightLb,
      weightBand: weight.weightBand,
      restrictedClass: restrictedClass as RestrictedClassDeclaration,
      serviceLevel: "standard",
      timingIntent: "asap",
      requestedPickupLocal: null,
    }),
    { textSignals }
  );
  const quote = applyShipmentPolicyToQuote(routed.quote, policy);

  if (quote.quoteStatus === "invalid") {
    return fail(
      operation,
      "invalid_input",
      { reason: "shipment_prohibited" },
      "Couranr cannot carry this shipment."
    );
  }

  return rpc<Record<string, any>>(operation, RPC.validate, {
    p_request_id: params.requestId,
    p_host_business_account_id: params.hostBusinessAccountId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actor.userId,
    p_payer_type: payerType,
    p_weight_lb: weight.weightLb,
    p_weight_band: weight.weightBand,
    p_restricted_class: restrictedClass,
    p_signature_required: signatureRequired,
    p_pickup_address: routed.pickupAddress,
    p_dropoff_address: routed.dropoffAddress,
    ...routeArgs(routed.route),
    ...quoteArgs(quote),
    ...timingArgs(routed.timing),
  });
}

export async function declineHostedRequest(params: {
  actor: RequestActor;
  hostBusinessAccountId: string;
  requestId: string;
  expectedVersion: number;
  reason: unknown;
}): Promise<HostedResult<Record<string, any>>> {
  const operation = "declineHostedRequest";
  const permission = canActOnDeliveryRequest(
    params.actor,
    "submit",
    params.hostBusinessAccountId
  );
  if (!permission.allowed || params.actor.kind !== "member") {
    return fail(operation, "not_permitted", { reason: permission.reason });
  }
  const reason = cleanText(params.reason, 64);
  if (
    !reason ||
    !["order_not_found", "details_do_not_match", "merchant_cannot_fulfill"].includes(reason)
  ) {
    return fail(operation, "invalid_input", { reason: "decline_reason_invalid" });
  }
  return rpc<Record<string, any>>(operation, RPC.decline, {
    p_request_id: params.requestId,
    p_host_business_account_id: params.hostBusinessAccountId,
    p_expected_version: params.expectedVersion,
    p_actor_user_id: params.actor.userId,
    p_reason: reason,
  });
}
