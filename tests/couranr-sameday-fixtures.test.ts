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

  it("enables preview fixtures ONLY with the server-side opt-in", () => {
    expect(resolveAdapterMode({ nodeEnv: "production", vercelEnv: "preview" }).mode).toBe("disabled");
    const off = resolveAdapterMode({ vercelEnv: "preview" });
    expect(off.mode).toBe("disabled");
    expect(off.reason).toBe("preview_not_enabled");
    const on = resolveAdapterMode({ vercelEnv: "preview", fixtureFlag: "1" });
    expect(on.mode).toBe("fixture");
    expect(on.reason).toBe("preview_enabled");
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
