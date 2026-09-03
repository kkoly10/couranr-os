import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Cross-browser email confirmation.
 *
 * WHY THIS EXISTS: the default `{{ .ConfirmationURL }}` email link uses the
 * PKCE `code` flow, whose `exchangeCodeForSession` step requires the
 * `code_verifier` that was stored in the browser that STARTED the flow. Open
 * that link in a different browser or on a phone and the exchange fails — the
 * "confirmation only works in the same browser" bug.
 *
 * This route instead consumes the emailed OTP `token_hash` via `verifyOtp`,
 * which validates the token server-side and issues the session in WHATEVER
 * browser clicked the link — no verifier needed. The Couranr auth email
 * templates (lib/couranr/email/templates/supabaseAuth.ts) link here:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>&next=<path>
 *
 * Docs: https://supabase.com/docs/guides/auth/auth-email-templates
 *       https://supabase.com/docs/guides/auth/server-side/nextjs
 */

const ALLOWED_TYPES: readonly EmailOtpType[] = [
  "email",
  "signup",
  "magiclink",
  "recovery",
  "invite",
  "email_change",
] as const;

/** Only ever redirect to a same-site path — never an attacker-supplied URL. */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/app/business";
  return raw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  if (tokenHash && type && ALLOWED_TYPES.includes(type)) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      // Session cookies are now set on this response for THIS browser.
      return NextResponse.redirect(new URL(next, origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth-link-invalid", origin));
}
