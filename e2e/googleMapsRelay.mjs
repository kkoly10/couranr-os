/**
 * Same-origin relay for the browser's Google Maps traffic — the Maps
 * JavaScript loader, its module chunks, the Places (New) autocomplete and
 * Place Details RPCs the `PlaceAutocompleteElement` issues, and the static
 * assets on gstatic.
 *
 * Mechanism, limits and what it does NOT prove are exactly those of
 * e2e/supabaseRelay.mjs: Chromium in this container cannot open an outbound
 * connection to any external host (net::ERR_CONNECTION_RESET, direct or via
 * the session proxy — measured), so requests the page makes to Google are
 * intercepted with `page.route` and performed by Node, which does a normal
 * VERIFIED TLS handshake. Nothing here relaxes TLS or unsets HTTPS_PROXY.
 *
 * Two deliberate differences from the Supabase relay:
 *   - `referer` IS forwarded. Google authenticates a browser key against the
 *     page's referrer when the key is referrer-restricted; dropping it would
 *     make a correctly restricted key fail here for a reason that is not the
 *     product's.
 *   - The Maps JS loader itself is a `<script src>` (no CORS), and the RPCs
 *     it makes carry Google's own headers (`x-goog-api-key`, protobuf content
 *     types). All are forwarded verbatim; the permissive CORS headers on the
 *     way back are what let the page read the RPC responses.
 *
 * What it does not prove, to state in every report: real browser egress to
 * Google, CORS as Google would answer it, and the browser key's referrer
 * restriction against the deployed domains. Production is checked separately.
 */

const HOP_BY_HOP = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
  "origin",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
]);

export const GOOGLE_MAPS_HOST_PATTERNS = [
  "**://*.googleapis.com/**",
  "**://*.gstatic.com/**",
  "**://*.google.com/**",
];

/**
 * @param page   Playwright Page
 * @param opts.onCall optional (method, host, pathname, status) observer
 */
export async function relayGoogleMaps(page, opts = {}) {
  const handler = async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();
    const { host, pathname } = new URL(url);

    if (method === "OPTIONS") {
      const askedFor = req.headers()["access-control-request-headers"] ?? "";
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": askedFor || "content-type,x-goog-api-key,x-goog-fieldmask,x-goog-maps-api-salt,x-goog-maps-api-signature",
          "access-control-max-age": "600",
        },
      });
      return;
    }

    const headers = {};
    for (const [k, v] of Object.entries(req.headers())) {
      if (!HOP_BY_HOP.has(k.toLowerCase())) headers[k] = v;
    }
    let body;
    const raw = req.postDataBuffer();
    if (raw && raw.length > 0) body = raw;

    try {
      const upstream = await fetch(url, { method, headers, body, redirect: "manual" });
      const buf = Buffer.from(await upstream.arrayBuffer());
      const outHeaders = {};
      upstream.headers.forEach((v, k) => {
        const lk = k.toLowerCase();
        if (lk === "content-encoding" || lk === "content-length" || lk === "transfer-encoding") return;
        outHeaders[k] = v;
      });
      outHeaders["access-control-allow-origin"] = "*";
      outHeaders["access-control-expose-headers"] = "*";
      opts.onCall?.(method, host, pathname, upstream.status);
      await route.fulfill({ status: upstream.status, headers: outHeaders, body: buf });
    } catch (e) {
      opts.onCall?.(method, host, pathname, -1);
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: "relay_failed", detail: String(e?.message ?? e) }),
      });
    }
  };
  for (const pattern of GOOGLE_MAPS_HOST_PATTERNS) await page.route(pattern, handler);
}
