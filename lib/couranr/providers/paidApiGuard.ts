import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";

assertServerOnly("lib/couranr/providers/paidApiGuard.ts");

export type PaidApiKey =
  | "google_routes_compute_routes"
  | "mapbox_directions"
  | "google_places_autocomplete"
  | "google_places_details";

export type PaidApiClaim =
  | { allowed: true; requestCount?: number; dailyLimit?: number }
  | { allowed: false; reason: string; requestCount?: number; dailyLimit?: number };

/**
 * Real provider calls are disabled outside Vercel production by default.
 * Local/preview testing must opt in explicitly. Injected fetch implementations
 * are test doubles and never consume the production budget.
 */
export async function claimPaidApiCall(
  apiKey: PaidApiKey,
  fetchImpl: unknown = fetch
): Promise<PaidApiClaim> {
  if (fetchImpl !== fetch) return { allowed: true };

  const production = process.env.VERCEL_ENV === "production";
  const explicitOverride = process.env.COURANR_ALLOW_PAID_PROVIDER_CALLS === "true";
  if (!production && !explicitOverride) {
    return { allowed: false, reason: "paid_provider_calls_disabled_outside_production" };
  }

  const { data, error } = (await supabaseAdmin.rpc("couranr_claim_external_api_call", {
    p_api_key: apiKey,
    p_now: new Date().toISOString(),
  })) as { data: any; error: any };

  if (error || !data) {
    const correlationId = newCorrelationId();
    logServerFailure({
      operation: "claimPaidApiCall",
      correlationId,
      code: "internal",
      detail: {
        apiKey,
        code: error?.code,
        message: error?.message ?? "no budget result",
      },
    });
    return { allowed: false, reason: "paid_api_budget_guard_unavailable" };
  }

  return data.allowed
    ? {
        allowed: true,
        requestCount: Number(data.requestCount ?? 0),
        dailyLimit: Number(data.dailyLimit ?? 0),
      }
    : {
        allowed: false,
        reason: String(data.reason ?? "paid_api_budget_denied"),
        requestCount: Number(data.requestCount ?? 0),
        dailyLimit: Number(data.dailyLimit ?? 0),
      };
}
