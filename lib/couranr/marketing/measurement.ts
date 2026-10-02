/**
 * Same Day marketing measurement is intentionally narrower than product analytics.
 * No delivery address, contact, quote, amount, request UUID, or capability token
 * is sent to either provider. A canonical request ID is used only for local
 * duplicate suppression after the server confirms submission.
 */

export const MARKETING_CONSENT_KEY = "couranr-marketing-measurement-v1";
const REPORTED_LEAD_PREFIX = "couranr-marketing-lead-v1:";
const SAFE_CAMPAIGN_VALUE = /^[a-zA-Z0-9_.-]{1,100}$/;
const SAFE_CLICK_ID = /^[a-zA-Z0-9_-]{1,500}$/;
const SAFE_QUERY_KEYS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "fbclid",
]);

type MarketingWindow = Window & {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
  fbq?: ((...args: unknown[]) => void) & {
    callMethod?: (...args: unknown[]) => void;
    queue?: unknown[][];
    loaded?: boolean;
    version?: string;
  };
  _fbq?: (...args: unknown[]) => void;
};

let initializedFor: string | null = null;
const memoryReported = new Set<string>();

export function isSafeMarketingLocation(location: Pick<Location, "origin" | "pathname" | "search">): boolean {
  if (location.pathname !== "/sameday" && location.pathname !== "/send") return false;
  const params = new URLSearchParams(location.search);
  for (const [key, value] of params) {
    if (key === "intent" && location.pathname === "/send") {
      if (value !== "send" && value !== "pickup") return false;
      continue;
    }
    if (!SAFE_QUERY_KEYS.has(key)) return false;
    if (!(key === "fbclid" ? SAFE_CLICK_ID : SAFE_CAMPAIGN_VALUE).test(value)) return false;
  }
  return true;
}

/** Retain only known-safe campaign labels; never report the raw browser URL. */
export function safeMarketingPageLocation(location: Pick<Location, "origin" | "pathname" | "search">): string | null {
  if (!isSafeMarketingLocation(location)) return null;
  const out = new URL(location.pathname, location.origin);
  const params = new URLSearchParams(location.search);
  for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    const value = params.get(key);
    if (value) out.searchParams.set(key, value);
  }
  return out.toString();
}

export function marketingConsentAccepted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MARKETING_CONSENT_KEY) === "accepted";
  } catch {
    return false;
  }
}

export function initializeMarketingMeasurement(gaId: string | null, pixelId: string | null): void {
  if (!marketingConsentAccepted() || !isSafeMarketingLocation(window.location)) return;
  const key = `${gaId ?? ""}:${pixelId ?? ""}`;
  if (initializedFor === key) return;
  initializedFor = key;
  const browser = window as MarketingWindow;

  if (gaId) {
    browser.dataLayer = browser.dataLayer ?? [];
    browser.gtag = browser.gtag ?? ((...args: unknown[]) => { browser.dataLayer?.push(args); });
    // Basic consent mode: the Google script is not loaded before opt-in.
    browser.gtag("consent", "default", {
      analytics_storage: "denied", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied",
    });
    browser.gtag("consent", "update", {
      analytics_storage: "granted", ad_storage: "denied",
      ad_user_data: "denied", ad_personalization: "denied",
    });
    browser.gtag("js", new Date());
    browser.gtag("config", gaId, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
  }

  if (pixelId) {
    if (!browser.fbq) {
      const pixel = ((...args: unknown[]) => {
        if (pixel.callMethod) pixel.callMethod(...args);
        else pixel.queue?.push(args);
      }) as NonNullable<MarketingWindow["fbq"]>;
      pixel.queue = [];
      pixel.loaded = true;
      pixel.version = "2.0";
      browser.fbq = pixel;
      browser._fbq = pixel;
    }
    // Do not infer personal identifiers from the /send contact/payment form.
    browser.fbq("set", "autoConfig", false, pixelId);
    browser.fbq("init", pixelId);
  }
}

export function trackMarketingPageView(): void {
  if (!marketingConsentAccepted()) return;
  const location = safeMarketingPageLocation(window.location);
  if (!location) return;
  const browser = window as MarketingWindow;
  browser.gtag?.("event", "page_view", {
    page_location: location,
    page_path: window.location.pathname,
  });
  browser.fbq?.("track", "PageView");
}

export function trackSubmittedSameDayLead(requestId: string | null): void {
  if (!marketingConsentAccepted() || !isSafeMarketingLocation(window.location)) return;
  // Fail closed if the server result lacks a canonical request identity.
  if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return;
  const browser = window as MarketingWindow;
  if (!browser.gtag && !browser.fbq) return;
  if (memoryReported.has(requestId)) return;
  try {
    if (window.sessionStorage.getItem(`${REPORTED_LEAD_PREFIX}${requestId}`)) return;
    window.sessionStorage.setItem(`${REPORTED_LEAD_PREFIX}${requestId}`, "1");
  } catch {
    // Private browsing may disable storage. The in-memory guard still applies.
  }
  memoryReported.add(requestId);
  // Third-party measurement must never change the canonical request outcome.
  try {
    browser.gtag?.("event", "generate_lead", { lead_source: "sameday" });
    browser.fbq?.("track", "Lead", { content_name: "Couranr Same Day" });
  } catch {
    // Keep the local dedupe marker: a provider error is not authority to retry
    // and potentially double-count the other provider's successful event.
  }
}
