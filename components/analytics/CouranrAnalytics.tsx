"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * Vercel Web Analytics, with the customer access tokens redacted out of the URL
 * before any event leaves the browser.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS WRAPPER EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * Three customer-facing routes carry a token IN THE PATH:
 *
 *     /help/[token]     the Delivery Help thread and problem reporting
 *     /track/[token]    tracking and proof of delivery
 *     /pay/[token]      the payment surface
 *
 * That token is not an identifier — it is the ENTIRE authority behind the link.
 * `lib/couranr/conversations/help.ts` says so in as many words: "this value is
 * the entire authority behind a Delivery Help link, and a predictable one would
 * let anyone reach a stranger's thread by guessing." A bare `<Analytics />`
 * reports the resolved URL, so every customer page view would have shipped a
 * live credential to a third-party analytics endpoint.
 *
 * Vercel's own documentation opens on exactly this case — "URLs and query
 * parameters may contain sensitive data. This could be a user ID, a token, an
 * order ID" — and puts the remedy on the application, via `beforeSend`:
 * https://vercel.com/docs/analytics/redacting-sensitive-data
 *
 * CLAUDE.md states the same rule for this repository: never put secrets in
 * analytics, logs or notification copy.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES
 * ---------------------------------------------------------------------------
 *
 * The token segment is replaced with a literal `[token]`, so the analytics view
 * still distinguishes `/help` from `/track` from `/pay` — the thing anyone
 * actually wants to measure — while carrying nothing that grants access. Query
 * strings are dropped wholesale for the same reason and because nothing on
 * these surfaces needs them measured.
 *
 * It is a REDACTION, not a suppression: the page view is still counted. An
 * earlier instinct was to return `null` for token routes, which would have made
 * the busiest customer surfaces invisible in analytics — a worse answer than
 * the one that keeps the shape and drops the secret.
 *
 * `"use client"` is required. `beforeSend` is a function, and a function prop
 * cannot cross from the server root layout into a client component, so the
 * wrapper has to own it.
 */

/** Path segments that are opaque credentials rather than identifiers. */
const TOKEN_ROUTES = ["/help/", "/track/", "/pay/"];

export function redactAnalyticsUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // An unparseable URL is not worth guessing at. Reporting nothing is safe;
    // reporting an unredacted string is not.
    return "";
  }

  for (const prefix of TOKEN_ROUTES) {
    if (!url.pathname.startsWith(prefix)) continue;
    // Everything after `/help/` up to the next slash is the token. Anything
    // beyond it (a nested segment) is kept, since it is route shape rather than
    // credential.
    const rest = url.pathname.slice(prefix.length);
    const cut = rest.indexOf("/");
    url.pathname = cut === -1 ? `${prefix}[token]` : `${prefix}[token]${rest.slice(cut)}`;
    break;
  }

  // Query strings go regardless of route. Nothing here needs them measured, and
  // a future `?token=` or `?email=` would otherwise ship silently.
  url.search = "";
  return url.toString();
}

export function CouranrAnalytics() {
  return (
    <Analytics
      beforeSend={(event: BeforeSendEvent) => {
        const url = redactAnalyticsUrl(event.url);
        if (!url) return null;
        return { ...event, url };
      }}
    />
  );
}
