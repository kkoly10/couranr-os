/**
 * Supabase Auth error → stable Couranr copy.
 *
 * Supabase's auth messages are user-facing by design and carry no schema
 * detail, unlike a PostgREST error. They are still not OUR copy: they change
 * between releases, they are sentence-cased inconsistently, and a few are
 * jargon ("Email not confirmed"). Translating them gives stable strings the UI
 * and the tests can both rely on.
 *
 * Anything unrecognised falls back to a neutral message rather than being shown
 * raw, so a future Supabase release cannot surface unreviewed text to a
 * merchant.
 */

export type AuthFailureKind =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "network"
  | "unknown";

export type AuthFailure = { kind: AuthFailureKind; title: string; body: string };

const COPY: Record<AuthFailureKind, { title: string; body: string }> = {
  invalid_credentials: {
    title: "That email and password did not match",
    // Deliberately does not say whether the account exists.
    body: "Check both and try again. If you have never signed in before, create an account first.",
  },
  email_not_confirmed: {
    title: "Confirm your email first",
    body: "Couranr sent you a confirmation link when you signed up. Open it, then sign in here.",
  },
  rate_limited: {
    title: "Too many attempts",
    body: "Wait a minute before trying again.",
  },
  network: {
    title: "Could not reach Couranr",
    body: "Check your connection and try again.",
  },
  unknown: {
    title: "Sign in did not complete",
    body: "Something went wrong on our side. Try again, and contact Couranr Support if it keeps happening.",
  },
};

/**
 * Classifies a Supabase auth error WITHOUT forwarding its message.
 *
 * Matched on `code` first — supabase-js v2.90 sets a stable `code` on
 * `AuthApiError` — and on the message only as a fallback, because older
 * releases set only `status` and a human string.
 */
export function classifyAuthError(err: unknown): AuthFailure {
  const e = err as { code?: string; status?: number; message?: string } | null;
  const code = typeof e?.code === "string" ? e.code : "";
  const message = typeof e?.message === "string" ? e.message.toLowerCase() : "";

  let kind: AuthFailureKind = "unknown";

  if (code === "invalid_credentials" || /invalid login credentials/.test(message)) {
    kind = "invalid_credentials";
  } else if (code === "email_not_confirmed" || /email not confirmed/.test(message)) {
    kind = "email_not_confirmed";
  } else if (code === "over_request_rate_limit" || e?.status === 429 || /rate limit/.test(message)) {
    kind = "rate_limited";
  } else if (/failed to fetch|network|load failed/.test(message)) {
    kind = "network";
  }

  return { kind, ...COPY[kind] };
}

export const AUTH_COPY = COPY;
