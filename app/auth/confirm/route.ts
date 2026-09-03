import { type EmailOtpType } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Cross-browser email confirmation.
 *
 * WHY THIS EXISTS: the default `{{ .ConfirmationURL }}` email link uses the
 * PKCE `code` flow, whose `exchangeCodeForSession` step requires the
 * `code_verifier` stored in the browser that STARTED the flow. Open that link
 * in a different browser or on a phone and it fails — the "confirmation only
 * works in the same browser" bug.
 *
 * This route instead consumes the emailed OTP `token_hash` via `verifyOtp`,
 * which validates the token server-side and issues the session in WHATEVER
 * browser clicked the link. The Couranr auth email templates
 * (lib/couranr/email/templates/supabaseAuth.ts) link here:
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

/**
 * Only ever redirect to a same-site path. Rejects absolute URLs,
 * protocol-relative `//host`, and the `/\host` backslash trick (the WHATWG URL
 * parser treats `\` as `/` for http(s), so `/\evil.com` would resolve to an
 * external host). Requires a leading `/` followed by a normal path char.
 */
function safeNext(raw: string | null): string {
  if (!raw || !/^\/[^/\\]/.test(raw)) return "/app/business";
  return raw;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(searchParams.get("next"));

  const invalid = NextResponse.redirect(new URL("/login?error=auth-link-invalid", origin));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !tokenHash || !type || !ALLOWED_TYPES.includes(type)) {
    return invalid;
  }

  // The session cookies verifyOtp sets MUST be written onto the response we
  // actually return, or a successful verify would redirect without logging the
  // user in. This mirrors the response-scoped cookie adapter in proxy.ts and
  // Supabase's own callback-route docs.
  const success = NextResponse.redirect(new URL(next, origin));
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) =>
          success.cookies.set(name, value, options),
        );
      },
    },
  });

  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  return error ? invalid : success;
}
