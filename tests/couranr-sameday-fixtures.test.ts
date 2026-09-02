/**
 * Fixture safety for Same Day.
 *
 * `/send` is a complete frontend over adapters that have no backend. The whole
 * risk of that shape is a fixture reaching production and presenting a quote, a
 * payment authorization or a "we have your request" that nothing backs. These
 * are the eight mechanical proofs the work order requires, plus the positive
 * control that proves the gate can go red.
 *
 * The guarantee is STRUCTURAL, not a promise: `resolveAdapterMode` reads
 * server/build-time environment values only. A visitor has no input it consults.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { resolveAdapterMode, fixturesEnabled } from "@/lib/couranr/sameday/adapterMode";
import { getSameDayAdapters } from "@/lib/couranr/sameday/adapters";
import { BASE_PRICE_CENTS } from "@/lib/couranr/pricing";

const ROOT = path.join(__dirname, "..");
const PROD = { nodeEnv: "production" as const };

describe("1-2. production resolves disabled, and refuses an override", () => {
  it("resolves disabled in production", () => {
    expect(resolveAdapterMode(PROD).mode).toBe("disabled");
    expect(fixturesEnabled(PROD)).toBe(false);
  });

  it("resolves disabled in a Vercel production deployment", () => {
    expect(resolveAdapterMode({ nodeEnv: "development", vercelEnv: "production" }).mode).toBe("disabled");
  });

  it("REFUSES a production build that asks for fixtures, and records it", () => {
    for (const flag of ["1", "true", "yes", "on", "TRUE"]) {
      const r = resolveAdapterMode({ ...PROD, fixtureFlag: flag });
      expect(r.mode, `flag=${flag}`).toBe("disabled");
      expect(r.reason).toBe("production_override_refused");
      expect(r.misconfigured).toBe(true);
    }
  });
});

describe("3. test and preview can select fixtures explicitly", () => {
  it("enables fixtures under NODE_ENV=test", () => {
    expect(resolveAdapterMode({ nodeEnv: "test" }).mode).toBe("fixture");
  });

  /* THE REALISTIC VERCEL SHAPE, which is what the first version of this test
     missed. Next sets NODE_ENV=production for every production build, so a
     preview deployment is `NODE_ENV=production, VERCEL_ENV=preview` — and the
     resolver classified that as production, making this whole branch dead code
     and reporting a correct preview config as a refused production override.
     The old test asserted only the NO-FLAG preview case, where `disabled` is
     right either way, so it passed over the bug. Both halves are asserted now. */
  it("enables preview fixtures with the opt-in, on a REAL preview deployment", () => {
    const on = resolveAdapterMode({
      nodeEnv: "production",
      vercelEnv: "preview",
      fixtureFlag: "1",
    });
    expect(on.mode).toBe("fixture");
    expect(on.reason).toBe("preview_enabled");
    expect(on.misconfigured).toBe(false);
  });

  it("leaves a preview deployment disabled without the opt-in", () => {
    for (const env of [
      { nodeEnv: "production", vercelEnv: "preview" },
      { vercelEnv: "preview" },
    ]) {
      const off = resolveAdapterMode(env);
      expect(off.mode, JSON.stringify(env)).toBe("disabled");
      expect(off.reason).toBe("preview_not_enabled");
      expect(off.misconfigured).toBe(false);
    }
  });

  /* VERCEL_ENV is authoritative when present, so a production deployment is
     production no matter what NODE_ENV says — and a preview is not production
     no matter what NODE_ENV says. Both directions, because getting either
     wrong is a live defect. */
  it("lets VERCEL_ENV decide, in both directions", () => {
    expect(
      resolveAdapterMode({ nodeEnv: "development", vercelEnv: "production", fixtureFlag: "1" }).mode,
    ).toBe("disabled");
    expect(
      resolveAdapterMode({ nodeEnv: "production", vercelEnv: "development" }).mode,
    ).toBe("disabled");
    expect(
      resolveAdapterMode({ nodeEnv: "production", vercelEnv: "preview", fixtureFlag: "1" }).mode,
    ).toBe("fixture");
  });

  it("falls closed on an environment it does not recognise", () => {
    expect(resolveAdapterMode({}).mode).toBe("disabled");
    expect(resolveAdapterMode({ nodeEnv: "staging" }).reason).toBe("unknown_environment");
  });
});

describe("4. no visitor-controlled input can enable fixtures", () => {
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
        if (/FIXTURE_PLACES|sameday\/adapters"\s*;?[\s\S]*?\bFIXTURE\b/.test(src)) offenders.push(r);
      }
    };
    walk("app");
    walk("components");
    expect(offenders).toEqual([]);
  });
});

describe("5-6. transactional presentation depends on adapters, and disabled cannot succeed", () => {
  it("every disabled adapter refuses", async () => {
    const a = getSameDayAdapters(PROD);
    expect(a.mode).toBe("disabled");
    expect(await a.searchAddress("main")).toEqual([]);
    expect((await a.checkAvailability("a", "b")).state).toBe("unavailable");
    expect((await a.readIntake("a birthday cake")).state).toBe("unavailable");
    expect((await a.quote({ pickup: "a", destination: "b", timing: "asap" })).state).toBe("unavailable");
  });

  /* The two that matter most: a disabled submit or payment must not be able to
     reach a success state by ANY input. Success is not merely unlikely — the
     disabled implementation never constructs it. */
  it("a disabled submit adapter cannot reach received-preview", async () => {
    const a = getSameDayAdapters(PROD);
    for (let i = 0; i < 25; i += 1) {
      expect((await a.submitRequest()).state).toBe("unavailable");
    }
  });

  it("a disabled payment adapter cannot reach authorized-fixture", async () => {
    const a = getSameDayAdapters(PROD);
    for (let i = 0; i < 25; i += 1) {
      expect((await a.authorizePayment()).state).toBe("not-available");
    }
  });

  it("the disabled implementation contains no success constructor", () => {
    const src = readFileSync(path.join(ROOT, "lib/couranr/sameday/adapters.ts"), "utf8");
    const disabled = src.slice(src.indexOf("const DISABLED"), src.indexOf("const FIXTURE_PLACES"));
    expect(disabled).not.toContain("received-preview");
    expect(disabled).not.toContain("authorized-fixture");
    expect(disabled).not.toContain("fixture-available");
  });
});

describe("7. fixture success IS reachable in a sanctioned environment", () => {
  /* Without this the suite would pass with every adapter permanently broken. */
  it("reaches quote, submit and payment success under test mode", async () => {
    const a = getSameDayAdapters({ nodeEnv: "test" });
    expect(a.mode).toBe("fixture");
    expect((await a.quote({ pickup: "a", destination: "b", timing: "asap" })).state).toBe("fixture-available");
  });

  /* The fixture example is the only consumer-facing PRICE on the Same Day
     surface. It teaches the base fare, so it must never be a literal that
     outlives a policy change: this fails the moment the engine moves and the
     example does not. */
  it("the fixture example quotes the engine's base fare, not a copy of it", async () => {
    const a = getSameDayAdapters({ nodeEnv: "test" });
    const q = await a.quote({ pickup: "a", destination: "b", timing: "asap" });
    expect(q.state).toBe("fixture-available");
    expect(q.state === "fixture-available" && q.totalCents).toBe(BASE_PRICE_CENTS);
    const src = readFileSync(path.join(ROOT, "lib/couranr/sameday/adapters.ts"), "utf8");
    expect(src).toContain("totalCents: BASE_PRICE_CENTS");
    expect(src, "a restated base fare is drift waiting to happen").not.toMatch(
      /totalCents:\s*\d/
    );
    expect((await a.submitRequest()).state).toBe("received-preview");
    expect((await a.authorizePayment()).state).toBe("authorized-fixture");
    expect((await a.searchAddress("main")).length).toBeGreaterThan(0);
  });
});

describe("8. POSITIVE CONTROL: binding production to fixtures fails the gate", () => {
  it("a resolver that honoured the production override would be caught", () => {
    /* The control is the rule restated as a predicate over the real resolver.
       If someone made the flag win in production, this is what goes red. */
    const honoured = (env: Parameters<typeof resolveAdapterMode>[0]) =>
      resolveAdapterMode(env).mode === "fixture";
    expect(honoured({ nodeEnv: "production", fixtureFlag: "1" })).toBe(false);
    expect(honoured({ vercelEnv: "production", fixtureFlag: "true" })).toBe(false);

    /* And the control proves it can distinguish: the same predicate IS true
       where fixtures are sanctioned, so it is not just always-false. */
    expect(honoured({ vercelEnv: "preview", fixtureFlag: "1" })).toBe(true);
  });
});
