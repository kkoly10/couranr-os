import { assertServerOnly } from "@/lib/couranr/serverOnly";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";
import type { RenderedEmail } from "./types";

assertServerOnly("lib/couranr/email/send.ts");

/**
 * The one place Couranr hands a rendered email to a provider.
 *
 * WHY THIS FILE EXISTS AT ALL. `lib/couranr/email/` shipped 13 bulletproof
 * templates, a preview harness and 11 passing tests, and its own index.ts said
 * the subsystem "can be wired to a sender (Resend) later". Nothing ever wired
 * it: a grep for importers outside the module returned one comment and one test
 * file. Every Couranr transactional email was unsendable from the day the
 * templates landed, and the green suite said nothing, because a renderer that
 * is never called still renders correctly.
 *
 * WHAT THIS DELIBERATELY DOES NOT COPY FROM `lib/notify.ts`, the legacy mailer:
 *
 *  - notify.ts wraps its send in `try { ... } catch (err) { console.error(err) }`
 *    and returns void. The caller cannot tell a delivered email from a rejected
 *    one, so a broken sender looks exactly like a working one forever. This
 *    function returns a discriminated result AND logs through
 *    `logServerFailure`, which emits structured JSON with a correlation id that
 *    a log drain can alert on — not a bare console line.
 *  - notify.ts hardcodes `from: "Couranr <no-reply@couranr.com>"`. The apex
 *    `couranr.com` is NOT a verified Resend domain; only `mail.couranr.com` is
 *    (checked against the account's domain list). Every one of its sends is
 *    rejected by the provider and swallowed by the catch. The `from` here comes
 *    from the rendered email, which derives it from `defaultEmailConfig`, which
 *    is pinned to the verified subdomain and commented as such.
 *  - notify.ts builds `new Resend(...)` at module scope. This calls the REST
 *    API through an injectable `fetch`, so no client is constructed at import
 *    time and a test can drive the real code path without a network.
 *
 * IT NEVER THROWS. An email is downstream of work that already happened — the
 * delivery is delivered, the payment is captured. Throwing here would turn a
 * mail outage into a 500 on an operation that succeeded, or worse, roll one
 * back. Callers get a result they can record and move on.
 */

/** Why a send did not happen. Every value is actionable, never "unknown". */
export type EmailSkipReason =
  | "no_api_key"
  | "disabled_outside_production"
  | "invalid_recipient"
  | "provider_rejected"
  | "provider_unreachable";

export type EmailSendResult =
  | { sent: true; id: string; to: string; redirected: boolean }
  | {
      sent: false;
      reason: EmailSkipReason;
      correlationId?: string;
      detail?: string;
    };

export interface SendOptions {
  /** The recipient. Deliberately NOT part of `RenderedEmail` — a template must
      never be able to carry or leak an address. */
  to: string;
  /**
   * Stable key for this logical email. Resend deduplicates on it for 24 hours,
   * so a retried webhook or a re-run cron cannot double-send. Build it from the
   * event, not the clock: `delivery-delivered:<deliveryId>`, never a timestamp.
   * Max 256 characters (provider limit).
   */
  idempotencyKey?: string;
  /** Test seam. Production passes nothing and uses global fetch. */
  fetchImpl?: typeof fetch;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const IDEMPOTENCY_KEY_MAX = 256;

/**
 * Deliberately permissive: this is a shape check to catch an empty string, a
 * name that never got substituted, or a template placeholder — NOT an attempt
 * to validate deliverability, which only the provider can do.
 */
function looksLikeAnAddress(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 320) return false;
  if (/\s/.test(trimmed)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(trimmed);
}

/**
 * A plain-text alternative, derived from the HTML.
 *
 * Not cosmetic: a multipart message scores materially better with spam filters
 * than an HTML-only one, and this is transactional mail that must reach an
 * inbox. The hidden preheader block is stripped FIRST — it is padded with
 * dozens of `&zwnj;&nbsp;` pairs to control the inbox preview line, and left in
 * place it would open the text part with a wall of whitespace.
 *
 * This is a derivation, not a hand-written text version. It reads as prose
 * because the templates put real sentences in block elements; it is not going
 * to be beautiful for the line-item tables.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<div[^>]*display:none[\s\S]*?<\/div>/i, "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(p|div|tr|h1|h2|h3|li|table)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&zwnj;/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * Whether this environment is allowed to put mail on the wire, and to whom.
 *
 * Mirrors `claimPaidApiCall`'s posture in lib/couranr/providers/paidApiGuard.ts:
 * a real outbound call is a production act, and every other environment has to
 * opt in by name. The difference is that a wrong paid-API call costs money,
 * while a wrong email reaches a real person and cannot be recalled — so the
 * non-production path additionally supports a REDIRECT, which is what makes it
 * safe to exercise the live path from preview or a laptop.
 */
type Dispatch =
  /* A STRING discriminant, not `allowed: true | false`. This repo's tsconfig
     sets "strict": false, and a boolean literal discriminant does not narrow
     reliably without strictNullChecks — the first cut of this function failed
     to compile for exactly that reason. */
  | { kind: "blocked"; reason: EmailSkipReason }
  | { kind: "send"; recipient: string; redirected: boolean };

function resolveDispatch(to: string): Dispatch {
  const production = process.env.VERCEL_ENV === "production";
  if (production) return { kind: "send", recipient: to, redirected: false };

  if (process.env.COURANR_EMAIL_SEND !== "live") {
    return { kind: "blocked", reason: "disabled_outside_production" };
  }

  /* Armed outside production. If a redirect inbox is configured, EVERY message
     goes there instead of the real recipient — the way to test the live path
     without mailing a customer from a laptop. Without it, an armed
     non-production environment mails the real address, which is a deliberate
     choice the operator has to make twice. */
  const redirect = process.env.COURANR_EMAIL_REDIRECT_TO?.trim();
  if (redirect && looksLikeAnAddress(redirect)) {
    return { kind: "send", recipient: redirect, redirected: true };
  }
  return { kind: "send", recipient: to, redirected: false };
}

/**
 * Send one rendered email. Never throws; always returns a result.
 *
 * `rendered` carries subject, html, from and replyTo. `to` is supplied here so
 * a template can never hardcode or leak a recipient.
 */
export async function sendRenderedEmail(
  rendered: RenderedEmail,
  options: SendOptions
): Promise<EmailSendResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    /* Logged, not silent. An unset key in production is a misconfiguration that
       stops every customer email, and it must not read as "nothing to send". */
    const correlationId = newCorrelationId();
    logServerFailure({
      correlationId,
      operation: "sendRenderedEmail",
      code: "internal",
      detail: { reason: "no_api_key", subject: rendered.subject },
    });
    return { sent: false, reason: "no_api_key", correlationId };
  }

  if (!looksLikeAnAddress(options.to)) {
    const correlationId = newCorrelationId();
    logServerFailure({
      correlationId,
      operation: "sendRenderedEmail",
      code: "invalid_input",
      /* The address is the thing that is wrong, so it has to be in the log to
         be fixable. It is a recipient, not a secret. */
      detail: { reason: "invalid_recipient", to: options.to },
    });
    return { sent: false, reason: "invalid_recipient", correlationId };
  }

  const dispatch = resolveDispatch(options.to);
  if (dispatch.kind === "blocked") {
    return { sent: false, reason: dispatch.reason };
  }

  const doFetch = options.fetchImpl ?? fetch;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey.slice(
      0,
      IDEMPOTENCY_KEY_MAX
    );
  }

  /* snake_case, per the Resend REST reference — `reply_to`, not `replyTo`. The
     SDK accepts camelCase and converts; this endpoint does not. */
  const body = JSON.stringify({
    from: rendered.from,
    to: dispatch.recipient,
    subject: dispatch.redirected
      ? `[to: ${options.to}] ${rendered.subject}`
      : rendered.subject,
    html: rendered.html,
    text: htmlToPlainText(rendered.html),
    reply_to: rendered.replyTo,
  });

  let response: Response;
  try {
    response = await doFetch(RESEND_ENDPOINT, {
      method: "POST",
      headers,
      body,
    });
  } catch (err) {
    const correlationId = newCorrelationId();
    logServerFailure({
      correlationId,
      operation: "sendRenderedEmail",
      code: "internal",
      detail: {
        reason: "provider_unreachable",
        subject: rendered.subject,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return { sent: false, reason: "provider_unreachable", correlationId };
  }

  const payload = (await response.json().catch(() => null)) as
    | { id?: string; message?: string; name?: string }
    | null;

  if (!response.ok || !payload?.id) {
    const correlationId = newCorrelationId();
    logServerFailure({
      correlationId,
      operation: "sendRenderedEmail",
      code: "internal",
      detail: {
        reason: "provider_rejected",
        status: response.status,
        /* The provider's own message is the whole diagnostic value here — it is
           what says "domain not verified" or "invalid from". Carrying it is the
           difference between this and notify.ts's silent catch. It contains no
           credential; the key travels in a header that is never logged. */
        providerMessage: payload?.message ?? payload?.name ?? null,
        subject: rendered.subject,
      },
    });
    return {
      sent: false,
      reason: "provider_rejected",
      correlationId,
      detail: payload?.message ?? `HTTP ${response.status}`,
    };
  }

  return {
    sent: true,
    id: payload.id,
    to: dispatch.recipient,
    redirected: dispatch.redirected,
  };
}
