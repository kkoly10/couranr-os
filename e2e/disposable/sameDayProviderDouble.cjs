/**
 * Local-only provider boundary for the full Same Day browser journey.
 *
 * Loaded with NODE_OPTIONS=--require by that disposable harness. Production
 * code never imports it. Every Google/Mapbox request is answered here or
 * refused; no test can accidentally spend against a real provider.
 */
if (process.env.COURANR_E2E_PROVIDER_DOUBLE !== "1") {
  throw new Error("sameDayProviderDouble is disposable-test-only");
}

// The harness advances its own server clock after an after-hours browser order
// has created an immutable future plan. PostgreSQL and every canonical row are
// untouched. Only this explicitly preloaded disposable Next process sees it.
const fs = require("node:fs");
const NativeDate = globalThis.Date;
const clockFile = process.env.COURANR_E2E_CLOCK_FILE;
function simulatedNow() {
  if (!clockFile) return NativeDate.now();
  try {
    const value = fs.readFileSync(clockFile, "utf8").trim();
    const parsed = NativeDate.parse(value);
    return Number.isFinite(parsed) ? parsed : NativeDate.now();
  } catch { return NativeDate.now(); }
}
function DisposableDate(...args) {
  if (!new.target) return new NativeDate(simulatedNow()).toString();
  return args.length ? new NativeDate(...args) : new NativeDate(simulatedNow());
}
DisposableDate.now = simulatedNow;
DisposableDate.parse = NativeDate.parse;
DisposableDate.UTC = NativeDate.UTC;
DisposableDate.prototype = NativeDate.prototype;
globalThis.Date = DisposableDate;

const nativeFetch = globalThis.fetch;
const places = {
  "couranr-e2e-pickup": {
    line1: "100 Test Pickup Street", city: "Stafford", region: "VA",
    postalCode: "22554", latitude: 38.422, longitude: -77.408,
  },
  "couranr-e2e-dropoff": {
    line1: "200 Test Dropoff Avenue", city: "Woodbridge", region: "VA",
    postalCode: "22191", latitude: 38.651, longitude: -77.249,
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function details(id, p) {
  const [number, ...street] = p.line1.split(" ");
  return {
    id,
    formattedAddress: `${p.line1}, ${p.city}, ${p.region} ${p.postalCode}, USA`,
    location: { latitude: p.latitude, longitude: p.longitude },
    addressComponents: [
      { types: ["street_number"], longText: number, shortText: number },
      { types: ["route"], longText: street.join(" "), shortText: street.join(" ") },
      { types: ["locality"], longText: p.city, shortText: p.city },
      { types: ["administrative_area_level_1"], longText: "Virginia", shortText: p.region },
      { types: ["postal_code"], longText: p.postalCode, shortText: p.postalCode },
      { types: ["country"], longText: "United States", shortText: "US" },
    ],
  };
}

globalThis.fetch = function couranrDisposableProviderFetch(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url === "https://api.resend.com/emails") {
    const sink = process.env.COURANR_E2E_MAIL_SINK;
    if (!sink?.startsWith("http://127.0.0.1:")) {
      throw new Error("disposable email sink is not configured");
    }
    return nativeFetch(sink, {
      method: "POST",
      // Preserve provider idempotency semantics. Dropping this header made
      // retries look like duplicate deliveries in the disposable mail sink.
      headers: {
        "content-type": "application/json",
        "idempotency-key": new Headers(init?.headers).get("idempotency-key") ?? "",
      },
      body: String(init?.body ?? "{}"),
    });
  }
  if (url.startsWith("https://places.googleapis.com/")) {
    if (url.endsWith("/places:autocomplete")) {
      let query = "";
      try { query = JSON.parse(String(init?.body ?? "{}")).input.toLowerCase(); }
      catch { return Promise.resolve(json({ error: "invalid fixture request" }, 400)); }
      const selected = Object.entries(places).filter(([, p]) =>
        `${p.line1} ${p.city}`.toLowerCase().includes(query)
      );
      return Promise.resolve(json({ suggestions: selected.map(([placeId, p]) => ({
        placePrediction: {
          placeId,
          text: { text: `${p.line1}, ${p.city}, ${p.region} ${p.postalCode}` },
        },
      })) }));
    }
    const id = decodeURIComponent(url.split("/").pop());
    return Promise.resolve(places[id] ? json(details(id, places[id])) : json({ error: "unknown fixture place" }, 404));
  }
  if (url.startsWith("https://api.mapbox.com/")) {
    if (!url.startsWith("https://api.mapbox.com/directions/v5/mapbox/driving-traffic/")) {
      throw new Error(`unexpected Mapbox provider call: ${url.split("?")[0]}`);
    }
    return Promise.resolve(json({ code: "Ok", routes: [
      { distance: 14500, duration: 1500, duration_typical: 1200 },
    ] }));
  }
  if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) {
    return nativeFetch(input, init);
  }
  throw new Error(`unexpected external provider call in disposable journey: ${new URL(url).origin}`);
};
