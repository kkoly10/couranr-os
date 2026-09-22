import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generateAccessToken, hashAccessToken, isWellFormedAccessToken } from "@/lib/couranr/accessTokens";
import { createHmac } from "node:crypto";
import { handoffSecret } from "@/lib/couranr/driver/handoffSecret";

assertServerOnly("lib/couranr/consumer/senderAccess.ts");

/**
 * One sender-only capability per immutable notification event. A retry of the
 * same email MUST have byte-identical payload under Resend's idempotency key;
 * minting a fresh random link on every sweep makes that provider return 409.
 * Domain separation keeps this HMAC unrelated to handoff-code digests.
 * The database still stores only SHA-256 of the raw capability.
 */
export async function issueSenderAccessToken(requestId: string, eventId: string): Promise<string | null> {
  let raw: string;
  try {
    raw = createHmac("sha256", handoffSecret())
      .update(`couranr-sender-email-v1\0${requestId}\0${eventId}`)
      .digest("base64url");
  } catch {
    return null;
  }
  const tokenHash = hashAccessToken(raw);
  const { error } = await supabaseAdmin.rpc("couranr_issue_sender_access_token", {
    p_request_id: requestId,
    p_token_hash: tokenHash,
    p_ttl_days: 30,
  });
  if (error) {
    if (error.code !== "23505") return null;
    // A previous attempt inserted this exact event capability. A unique
    // conflict is only an idempotent replay if it belongs to this requester.
    const { data: existing, error: readError } = await supabaseAdmin
      .from("couranr_delivery_access_tokens")
      .select("request_id,audience")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (readError || existing?.request_id !== requestId || existing?.audience !== "sender") return null;
  }
  return raw;
}

export async function recoverSenderGuestSession(rawSenderToken: unknown): Promise<{
  token: string;
  expiresAt: string;
} | null> {
  if (!isWellFormedAccessToken(rawSenderToken)) return null;
  const rawGuest = generateAccessToken();
  const { data, error } = await supabaseAdmin.rpc("couranr_recover_sender_guest_session", {
    p_sender_token_hash: hashAccessToken(rawSenderToken),
    p_new_guest_token_hash: hashAccessToken(rawGuest),
  });
  if (error || !data || typeof data.expires_at !== "string") return null;
  return { token: rawGuest, expiresAt: data.expires_at };
}
