import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generateAccessToken, hashAccessToken, isWellFormedAccessToken } from "@/lib/couranr/accessTokens";

assertServerOnly("lib/couranr/consumer/senderAccess.ts");

/** Distinct from the recipient's tracking/attestation/PIN capability. */
export async function issueSenderAccessToken(requestId: string): Promise<string | null> {
  const raw = generateAccessToken();
  const { error } = await supabaseAdmin.rpc("couranr_issue_sender_access_token", {
    p_request_id: requestId,
    p_token_hash: hashAccessToken(raw),
    p_ttl_days: 30,
  });
  if (error) return null;
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
