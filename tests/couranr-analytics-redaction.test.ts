import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { redactAnalyticsUrl } from "@/components/analytics/CouranrAnalytics";

/**
 * Vercel Web Analytics reports the resolved URL. Three customer routes carry a
 * token IN THE PATH, and that token is the entire authority behind the link —
 * not an identifier. Shipping it to an analytics endpoint would be handing out
 * live credentials on every page view.
 *
 * `<Analytics />` as the install PR wrote it had no `beforeSend` at all. These
 * assertions are what make the redaction load-bearing rather than a comment.
 */
const ROOT = path.resolve(__dirname, "..");
const TOKEN = "foPT29urgIB8hupxwP4rkoikGwSwJEX1iLYtZqJ8Dlg";

describe("analytics URL redaction", () => {
  it("strips the token from every token-bearing customer route", () => {
    for (const route of ["help", "track", "pay"]) {
      const out = redactAnalyticsUrl(`https://couranr.com/${route}/${TOKEN}`);
      expect(out, `${route} still carries the token`).not.toContain(TOKEN);
      expect(out).toBe(`https://couranr.com/${route}/[token]`);
    }
  });

  it("keeps the route shape, so the surface is still measurable", () => {
    // A redaction that collapsed every token route to one string would make the
    // busiest customer surfaces indistinguishable. /help, /track and /pay must
    // stay apart.
    const seen = ["help", "track", "pay"].map((r) =>
      redactAnalyticsUrl(`https://couranr.com/${r}/${TOKEN}`)
    );
    expect(new Set(seen).size).toBe(3);
  });

  it("preserves a nested segment after the token", () => {
    expect(redactAnalyticsUrl(`https://couranr.com/track/${TOKEN}/proof`)).toBe(
      "https://couranr.com/track/[token]/proof"
    );
  });

  it("drops the query string wholesale", () => {
    // Not an enumerated deny-list: a future ?token= or ?email= would otherwise
    // ship silently. Nothing on these surfaces needs a query measured.
    expect(redactAnalyticsUrl(`https://couranr.com/help/${TOKEN}?secret=abc&x=1`)).toBe(
      "https://couranr.com/help/[token]"
    );
    expect(redactAnalyticsUrl("https://couranr.com/business?utm=x")).toBe(
      "https://couranr.com/business"
    );
  });

  it("leaves ordinary marketing routes alone", () => {
    for (const p of ["/", "/business", "/businesses", "/pricing", "/sameday"]) {
      expect(redactAnalyticsUrl(`https://couranr.com${p}`)).toBe(`https://couranr.com${p}`);
    }
  });

  it("reports nothing rather than something unredacted when the URL will not parse", () => {
    expect(redactAnalyticsUrl("not a url")).toBe("");
    expect(redactAnalyticsUrl("")).toBe("");
  });

  it("is actually wired into the root layout", () => {
    /* The redaction is worthless if the layout still renders the bare
       component. The install PR's version imported `Analytics` directly. */
    const layout = readFileSync(path.join(ROOT, "app/layout.tsx"), "utf8");
    expect(layout).toContain("CouranrAnalytics");
    expect(layout).not.toMatch(/from "@vercel\/analytics/);
    expect(layout).not.toMatch(/<Analytics\s*\/>/);
  });

  it("keeps beforeSend on the component, not merely available", () => {
    const src = readFileSync(
      path.join(ROOT, "components/analytics/CouranrAnalytics.tsx"),
      "utf8"
    );
    expect(src).toContain("beforeSend");
    expect(src).toContain('"use client"');
  });
});
