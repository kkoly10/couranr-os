/**
 * Same Day adapter-mode safety: LIVE by default, fixtures test-only.
 *
 * The consumer backend is real, so `live` is the DEFAULT for every real
 * environment and production needs NO env flag — the obsolete
 * COURANR_CONSUMER_SEND / COURANR_CONSUMER_SEND_PRODUCTION two-key blockade is
 * gone. `fixture` is deterministic data for automated tests plus an explicit
 * NON-production opt-in (COURANR_SAMEDAY_FIXTURES); it can NEVER reach
 * production and no visitor input can turn it on. There is no disabled product
 * path. These are the mechanical proofs of that contract, with a positive
 * control that the gate can still go red.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { resolveAdapterMode, fixturesEnabled } from "@/lib/couranr/sameday/adapterMode";
import { getSameDayAdapters, getSameDayAdaptersForMode } from "@/lib/couranr/sameday/adapters";
import { BASE_PRICE_CENTS } from "@/lib/couranr/pricing";

const ROOT = path.join(__dirname, "..");
const PROD = { nodeEnv: "production" as const };

describe("1-2. production resolves LIVE by default, with no env flag", () => {
  it("resolves live in production, and fixtures are not enabled", () => {
    const r = resolveAdapterMode(PROD);
    expect(r.mode).toBe("live");
    expect(r.reason).toBe("production");
    expect(r.misconfigured).toBe(false);
    expect(fixturesEnabled(PROD)).toBe(false);
  });

  it("resolves live in a Vercel production deployment", () => {
    expect(resolveAdapterMode({ nodeEnv: "development", vercelEnv: "production" }).mode).toBe("live");
  });

  it("needs NO COURANR_CONSUMER_SEND flag: the resolver never reads one", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/sameday/adapterMode.ts"), "utf8");
    // The word may appear in the LEADING doc comment (explaining what was
    // removed); the code below the doc block must not read it.
    const code = src.slice(src.indexOf("export type AdapterMode"));
    expect(code).not.toContain("COURANR_CONSUMER_SEND");
    expect(code).not.toContain("consumerSendFlag");
    expect(code).not.toContain("consumerSendProductionFlag");
  });
});

describe("3. production REFUSES a fixture override, resolving LIVE (never disabled)", () => {
  it("a production build asking for fixtures gets live + a recorded misconfiguration", () => {
    for (const flag of ["1", "true", "yes", "on", "TRUE"]) {
      const r = resolveAdapterMode({ ...PROD, fixtureFlag: flag });
      expect(r.mode, `flag=${flag}`).toBe("live");
      expect(r.reason).toBe("production_fixtures_refused");
      expect(r.misconfigured).toBe(true);
    }
  });
});

describe("4. fixtures are test-only plus an explicit non-production opt-in", () => {
  it("enables fixtures under NODE_ENV=test", () => {
    const r = resolveAdapterMode({ nodeEnv: "test" });
    expect(r.mode).toBe("fixture");
    expect(r.reason).toBe("test");
  });

  /* THE REALISTIC VERCEL SHAPE: Next sets NODE_ENV=production for every
     production build, so a preview deployment is
     `NODE_ENV=production, VERCEL_ENV=preview`. VERCEL_ENV is authoritative. */
  it("enables preview fixtures with the opt-in on a REAL preview deployment", () => {
    const on = resolveAdapterMode({ nodeEnv: "production", vercelEnv: "preview", fixtureFlag: "1" });
    expect(on.mode).toBe("fixture");
    expect(on.reason).toBe("fixtures_opt_in");
    expect(on.misconfigured).toBe(false);
  });

  it("a preview WITHOUT the opt-in is live, not disabled", () => {
    for (const env of [
      { nodeEnv: "production", vercelEnv: "preview" },
      { vercelEnv: "preview" },
    ]) {
      const off = resolveAdapterMode(env);
      expect(off.mode, JSON.stringify(env)).toBe("live");
      expect(off.reason).toBe("preview");
      expect(off.misconfigured).toBe(false);
    }
  });

  it("development is live by default, fixtures only on the explicit opt-in", () => {
    expect(resolveAdapterMode({ nodeEnv: "development" }).mode).toBe("live");
    expect(resolveAdapterMode({ nodeEnv: "development" }).reason).toBe("development");
    expect(resolveAdapterMode({ nodeEnv: "development", fixtureFlag: "1" }).mode).toBe("fixture");
  });

  it("VERCEL_ENV decides, in both directions", () => {
    // A production deployment refuses the fixture override -> live.
    expect(resolveAdapterMode({ nodeEnv: "development", vercelEnv: "production", fixtureFlag: "1" }).mode).toBe("live");
    // A preview is not production even when NODE_ENV says production.
    expect(resolveAdapterMode({ nodeEnv: "production", vercelEnv: "preview", fixtureFlag: "1" }).mode).toBe("fixture");
  });

  it("an unrecognised environment is live (real backend, budget-gated), never a fake-data screen", () => {
    expect(resolveAdapterMode({}).mode).toBe("live");
    expect(resolveAdapterMode({ nodeEnv: "staging" }).mode).toBe("live");
    expect(resolveAdapterMode({ nodeEnv: "staging" }).reason).toBe("default");
  });

  it("only a truthy fixture flag arms fixtures; garbage does not", () => {
    for (const flag of ["off", "0", "no", ""]) {
      expect(resolveAdapterMode({ nodeEnv: "development", fixtureFlag: flag }).mode, `flag=${flag}`).toBe("live");
    }
  });
});

describe("5. no visitor-controlled input can enable fixtures", () => {
  /* The forbidden inputs, checked as an ABSENCE in the source. A test that
     passed fake values in would only prove this implementation ignores them;
     asserting the module never reads them proves no future edit can. */
  it("the resolver reads no query, hash, storage or cookie", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/sameday/adapterMode.ts"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    for (const banned of [
      "searchParams", "location", "window", "document", "localStorage",
      "sessionStorage", "cookie", "useSearchParams", "NEXT_PUBLIC",
    ]) {
      expect(code, `adapterMode reads ${banned}`).not.toContain(banned);
    }
  });

  it("no page or component imports fixture data directly", () => {
    const offenders: string[] = [];
    const walk = (rel: string) => {
      for (const name of readdirSync(path.join(ROOT, rel))) {
        const r = `${rel}/${name}`;
        if (statSync(path.join(ROOT, r)).isDirectory()) { walk(r); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        const src = readFileSync(path.join(ROOT, r), "utf8");
        if (/FIXTURE_PLACES/.test(src)) offenders.push(r);
      }
    };
    walk("app");
    walk("components");
    expect(offenders).toEqual([]);
  });
});

describe("6. live is the default set; fixture success is reachable only in a sanctioned env", () => {
  it("production resolves the LIVE set, with the live-only methods", () => {
    const a = getSameDayAdapters(PROD);
    expect(a.mode).toBe("live");
    expect(typeof a.reconcilePayment).toBe("function");
    expect(typeof a.readRequest).toBe("function");
  });

  /* Without this the suite would pass with every fixture adapter broken. */
  it("test mode resolves the fixture set; quote/submit/payment/search succeed there", async () => {
    const a = getSameDayAdapters({ nodeEnv: "test" });
    expect(a.mode).toBe("fixture");
    const q = await a.quote({ pickup: "a", destination: "b", timingIntent: "asap" });
    expect(q.state).toBe("fixture-available");
    expect(q.state === "fixture-available" && q.totalCents).toBe(BASE_PRICE_CENTS);
    expect((await a.submitRequest()).state).toBe("received-preview");
    expect((await a.authorizePayment()).state).toBe("authorized-fixture");
    const s = await a.searchAddress("main");
    expect(s.status).toBe("ok");
    expect(s.status === "ok" && s.suggestions.length).toBeGreaterThan(0);
  });

  /* The fixture example is the only consumer-facing PRICE on the Same Day
     surface. It reads the engine's base fare, so it must never be a literal
     that outlives a policy change. */
  it("the fixture example quotes the engine's base fare, not a copy of it", async () => {
    const a = getSameDayAdaptersForMode("fixture");
    const q = await a.quote({ pickup: "a", destination: "b", timingIntent: "asap" });
    expect(q.state === "fixture-available" && q.totalCents).toBe(BASE_PRICE_CENTS);
    const src = readFileSync(path.join(ROOT, "lib/couranr/sameday/adapters.ts"), "utf8");
    expect(src).toContain("totalCents: BASE_PRICE_CENTS");
    expect(src, "a restated base fare is drift waiting to happen").not.toMatch(/totalCents:\s*\d/);
  });

  it("the fixture block constructs no live state, talks to no server, and no DISABLED set survives", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/sameday/adapters.ts"), "utf8");
    const fixture = src.slice(src.indexOf("const FIXTURE"), src.indexOf("export function getSameDayAdapters"));
    expect(fixture).not.toContain("live-available");
    expect(fixture).not.toContain("authorization-required");
    expect(fixture).not.toContain("fetch(");
    // The disabled product path is removed by deletion, not left dormant.
    expect(src).not.toContain("const DISABLED");
    expect(src).not.toContain("production_stop");
  });
});

describe("7. POSITIVE CONTROL: binding production to fixtures fails the gate", () => {
  it("a resolver that honoured the production override would be caught", () => {
    const honoursFixturesInProd = (env: Parameters<typeof resolveAdapterMode>[0]) =>
      resolveAdapterMode(env).mode === "fixture";
    expect(honoursFixturesInProd({ nodeEnv: "production", fixtureFlag: "1" })).toBe(false);
    expect(honoursFixturesInProd({ vercelEnv: "production", fixtureFlag: "true" })).toBe(false);
    /* And the control proves it can distinguish: the same predicate IS true
       where fixtures are sanctioned. */
    expect(honoursFixturesInProd({ vercelEnv: "preview", fixtureFlag: "1" })).toBe(true);
  });

  it("there is no production DISABLED product path — every production shape is live", () => {
    for (const env of [
      PROD,
      { vercelEnv: "production" as const },
      { ...PROD, fixtureFlag: "1" },
      { vercelEnv: "production" as const, fixtureFlag: "1" },
    ]) {
      expect(resolveAdapterMode(env).mode, JSON.stringify(env)).toBe("live");
    }
  });
});

describe("PUB-004 layout", () => {
  const page = readFileSync(
    path.join(ROOT, "app/(couranr)/(public)/(consumer-public)/send/page.tsx"),
    "utf8",
  );
  const css = readFileSync(path.join(ROOT, "app/(couranr)/couranr.css"), "utf8");

  it("centres both intent variants in one bounded workflow surface", () => {
    expect(page).toContain('className="cr-mkt cr-send-page"');
    expect(css).toMatch(/\.cr-send\s*\{[^}]*max-width:\s*54rem[^}]*margin-inline:\s*auto/s);
    expect(css).toMatch(/\.cr-send-rail\s*\{[^}]*grid-template-columns:\s*repeat\(5,/s);
  });
});
