import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  generateAccessToken,
  hashAccessToken,
  isWellFormedAccessToken,
} from "@/lib/couranr/accessTokens";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";

assertServerOnly("lib/couranr/consumer/canary.ts");

export const CONSUMER_CANARY_COOKIE = "couranr-send-canary";
export const CONSUMER_CANARY_GUEST_TTL_MINUTES = 1440;

type CanaryFailure = { ok: false };
type CanaryResult<T> = { ok: true; value: T } | CanaryFailure;

function failed(operation: string, detail?: unknown): CanaryFailure {
  logServerFailure({
    correlationId: newCorrelationId(),
    operation,
    code: "not_found",
    detail,
  });
  return { ok: false };
}

export async function redeemConsumerCanaryAccess(params: {
  rawAccessToken: unknown;
  rawCookieSecret: string;
}): Promise<CanaryResult<{ expiresAt: string }>> {
  const op = "redeemConsumerCanaryAccess";
  if (
    !isWellFormedAccessToken(params.rawAccessToken) ||
    !isWellFormedAccessToken(params.rawCookieSecret)
  ) {
    return failed(op, { reason: "shape" });
  }
  const { data, error } = (await supabaseAdmin.rpc(
    "couranr_redeem_consumer_canary_access",
    {
      p_token_hash: hashAccessToken(params.rawAccessToken),
      p_cookie_hash: hashAccessToken(params.rawCookieSecret),
    }
  )) as { data: any; error: any };
  if (error || !data) return failed(op, error?.message);
  return { ok: true, value: { expiresAt: String(data.expires_at) } };
}

export async function consumerCanaryCookieValid(
  rawCookie: unknown
): Promise<boolean> {
  if (!isWellFormedAccessToken(rawCookie)) return false;
  const { data, error } = (await supabaseAdmin.rpc(
    "couranr_resolve_consumer_canary_cookie",
    { p_cookie_hash: hashAccessToken(rawCookie) }
  )) as { data: any; error: any };
  return !error && Boolean(data);
}

export async function createConsumerCanaryGuestSession(
  rawCookie: unknown
): Promise<CanaryResult<{ token: string; expiresAt: string }>> {
  const op = "createConsumerCanaryGuestSession";
  if (!isWellFormedAccessToken(rawCookie)) {
    return failed(op, { reason: "cookie_shape" });
  }
  const token = generateAccessToken();
  const { data, error } = (await supabaseAdmin.rpc(
    "couranr_create_consumer_canary_guest_session",
    {
      p_cookie_hash: hashAccessToken(rawCookie),
      p_guest_token_hash: hashAccessToken(token),
      p_ttl_minutes: CONSUMER_CANARY_GUEST_TTL_MINUTES,
    }
  )) as { data: any; error: any };
  if (error || !data) return failed(op, error?.message);
  return {
    ok: true,
    value: { token, expiresAt: String(data.expires_at) },
  };
}

export function newConsumerCanaryCookieSecret(): string {
  return generateAccessToken();
}
