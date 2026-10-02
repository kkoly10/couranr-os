import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initializeMarketingMeasurement,
  isSafeMarketingLocation,
  MARKETING_CONSENT_KEY,
  safeMarketingPageLocation,
  trackMarketingPageView,
  trackSubmittedSameDayLead,
} from "@/lib/couranr/marketing/measurement";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function browser(url: string, consent = true) {
  const location = new URL(url);
  const fake = {
    location,
    localStorage: storage(consent ? { [MARKETING_CONSENT_KEY]: "accepted" } : {}),
    sessionStorage: storage(),
  };
  vi.stubGlobal("window", fake);
  return fake;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe("Same Day acquisition measurement", () => {
  it("never sends capability, address, email, or arbitrary query data in page locations", () => {
    expect(isSafeMarketingLocation(new URL("https://couranr.com/send?token=secret"))).toBe(false);
    expect(isSafeMarketingLocation(new URL("https://couranr.com/send?email=person@example.com"))).toBe(false);
    expect(isSafeMarketingLocation(new URL("https://couranr.com/track/secret"))).toBe(false);
    expect(safeMarketingPageLocation(new URL("https://couranr.com/send?intent=pickup&utm_campaign=local&fbclid=click123")))
      .toBe("https://couranr.com/send?utm_campaign=local");
  });

  it("does not initialize either provider without an explicit consent choice", () => {
    const fake = browser("https://couranr.com/sameday", false);
    initializeMarketingMeasurement("G-TEST", "123");
    trackMarketingPageView();
    trackSubmittedSameDayLead("11111111-1111-4111-8111-111111111111");
    expect(fake).not.toHaveProperty("gtag");
    expect(fake).not.toHaveProperty("fbq");
  });

  it("tracks one submitted server-confirmed request, but no quote or contact data", () => {
    const fake = browser("https://couranr.com/send?intent=send&utm_campaign=local");
    initializeMarketingMeasurement("G-TEST-ONE", "12345");
    trackMarketingPageView();
    trackSubmittedSameDayLead(null);
    trackSubmittedSameDayLead("not-a-request-id");
    const id = "22222222-2222-4222-8222-222222222222";
    trackSubmittedSameDayLead(id);
    trackSubmittedSameDayLead(id);
    const calls = JSON.stringify({
      google: (fake as typeof fake & { dataLayer: unknown[] }).dataLayer,
      meta: (fake as typeof fake & { fbq: { queue: unknown[] } }).fbq.queue,
    });
    expect((calls.match(/generate_lead/g) ?? [])).toHaveLength(1);
    expect((calls.match(/"Lead"/g) ?? [])).toHaveLength(1);
    expect(calls).not.toContain(id);
    expect(calls).not.toContain("intent=send");
    expect(calls).toContain("utm_campaign=local");
  });

  it("cannot turn a provider failure into a failed delivery request", () => {
    const fake = browser("https://couranr.com/send");
    initializeMarketingMeasurement("G-TEST-TWO", null);
    (fake as typeof fake & { gtag: () => never }).gtag = () => { throw new Error("provider unavailable"); };
    expect(() => trackSubmittedSameDayLead("33333333-3333-4333-8333-333333333333")).not.toThrow();
  });
});
