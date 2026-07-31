/**
 * Same-origin relay for the browser's Supabase traffic.
 *
 * ---------------------------------------------------------------------------
 * EXACTLY WHAT THIS DOES, AND EXACTLY WHAT IT DOES NOT PROVE
 * ---------------------------------------------------------------------------
 *
 * Mechanism
 *   - Chromium is launched with `--no-proxy-server`, so it talks to
 *     `localhost:3000` directly and never through the session egress proxy.
 *   - Requests the page makes to the Supabase origin are INTERCEPTED by
 *     Playwright (`page.route`) and FORWARDED BY NODE, which performs the real
 *     HTTPS call. Method, headers and body are forwarded as the page built
 *     them; the real status, headers and body come back.
 *   - TLS REMAINS VERIFIED. Node does a normal verified handshake against
 *     Supabase. Nothing here sets `ignoreHTTPSErrors`,
 *     `--ignore-certificate-errors`, or `NODE_TLS_REJECT_UNAUTHORIZED=0`, and
 *     `HTTPS_PROXY` is never unset.
 *   - The relay carries NO credential of its own. It forwards the page's own
 *     headers, which contain the PUBLISHABLE key. The harness's secret key
 *     never enters Chromium, `page.evaluate`, a URL, a log line or
 *     `.state.json`.
 *
 * Why it is needed
 *   The browser process in this container cannot open an outbound connection to
 *   ANY external host: Chromium gets `net::ERR_CONNECTION_RESET` for
 *   `example.com` exactly as for `*.supabase.co`, direct or proxied. That is a
 *   network-level restriction, not a certificate problem — a CA failure
 *   surfaces as `ERR_CERT_*`.
 *
 * What it genuinely exercises
 *   The real application bundle in a real browser, the real `supabase-js`
 *   client building real requests, the real Supabase answering them, and the
 *   real auth-helpers session cookie. Sign-in, sign-out, session persistence
 *   and every authenticated screen are properly tested.
 *
 * What it does NOT prove — state this in every report
 *   - THE RELAY OVERRIDES THE CROSS-ORIGIN PATH. The request never leaves the
 *     harness as a browser-issued cross-origin fetch.
 *   - CORS behaviour is therefore NOT proven. The relay supplies its own
 *     permissive CORS headers on the way back.
 *   - Supabase origin allowlists / URL configuration are NOT proven.
 *   - Real production browser egress is NOT proven.
 *   A misconfiguration in any of those would pass here and fail for a real
 *   user. Production must be checked separately (curl, or the deployed site).
 */

/** Headers that must not be forwarded upstream — they describe the hop, not the request. */
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
  "referer",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-dest",
]);

/**
 * @param page       Playwright Page
 * @param supabaseUrl e.g. https://abc.supabase.co
 * @param opts.onCall optional (method, pathname, status) observer, for assertions
 */
export async function relaySupabase(page, supabaseUrl, opts = {}) {
  const host = new URL(supabaseUrl).host;

  await page.route(`**://${host}/**`, async (route) => {
    const req = route.request();
    const url = req.url();
    const method = req.method();

    // supabase-js issues a CORS preflight for most calls. Answer it locally —
    // upstream would answer it identically and it costs a round trip.
    if (method === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers":
            "authorization,apikey,content-type,x-client-info,prefer,accept-profile,content-profile,range",
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
        // Drop encoding/length: the body is already decoded by fetch, so
        // forwarding the original values would make the browser mis-parse it.
        if (lk === "content-encoding" || lk === "content-length" || lk === "transfer-encoding") return;
        outHeaders[k] = v;
      });
      // The page's origin is http://localhost:3000; the request is cross-origin,
      // so the browser still applies CORS to whatever we hand back.
      outHeaders["access-control-allow-origin"] = "*";
      outHeaders["access-control-expose-headers"] = "content-range,x-supabase-api-version";

      opts.onCall?.(method, new URL(url).pathname, upstream.status);

      await route.fulfill({ status: upstream.status, headers: outHeaders, body: buf });
    } catch (e) {
      opts.onCall?.(method, new URL(url).pathname, -1);
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({ error: "relay_failed", detail: String(e?.message ?? e) }),
      });
    }
  });
}
