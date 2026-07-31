/**
 * Same-origin relay for the browser's Supabase traffic.
 *
 * WHY THIS EXISTS — and what it does not do.
 *
 * The browser process in this container cannot open an outbound HTTPS
 * connection: Chromium gets `net::ERR_CONNECTION_RESET` for every external
 * host, `example.com` as surely as `*.supabase.co`, whether it goes direct or
 * through the session proxy. That is a network-level restriction on the browser,
 * not a certificate problem — a CA failure would surface as `ERR_CERT_*`.
 *
 * Node in the same container CAN reach Supabase, over ordinary fully-verified
 * TLS. So the harness intercepts requests the page makes to the Supabase origin
 * and satisfies them from Node, faithfully forwarding method, headers and body
 * and returning the real status, headers and body.
 *
 * What this preserves: the real application bundle runs in a real browser, the
 * real `supabase-js` client builds the real requests, the real Supabase
 * responds, and the real session lands in real `localStorage`. Sign-in,
 * sign-out and session persistence are all genuinely exercised.
 *
 * What it does NOT prove: the production network path. A CORS rule or a
 * Supabase-side origin restriction that would bite a real browser is bypassed
 * here, because the request never leaves the harness as a cross-origin fetch.
 * Say so when reporting results — do not claim this covers production egress.
 *
 * TLS verification is NOT weakened anywhere: Node performs a normal verified
 * handshake against Supabase.
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
