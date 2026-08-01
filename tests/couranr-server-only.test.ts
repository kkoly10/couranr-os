import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static enforcement that a `"use client"` module cannot reach a server-only
 * one.
 *
 * This repo already carries the inverse bug: six server-context files import
 * the `"use client"` browser Supabase client, so they authenticate as `anon`
 * rather than the caller — which is why `/api/delivery/complete` has almost
 * certainly never captured a payment. A runtime guard would only fire once a
 * browser had already been shipped the bundle; this fails the test run instead.
 */

const ROOT = path.resolve(__dirname, "..");
const SEARCH_DIRS = ["app", "components", "lib"];
const EXTS = [".ts", ".tsx"];

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.includes(path.extname(full))) out.push(full);
  }
  return out;
}

const FILES = SEARCH_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const SOURCE = new Map(FILES.map((f) => [f, readFileSync(f, "utf8")]));

function isClientModule(file: string): boolean {
  const src = SOURCE.get(file) ?? "";
  // The directive must be the first statement, so only look at the head.
  return /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(src);
}

/** A module is server-only if it calls the guard at module scope. */
function isServerOnlyModule(file: string): boolean {
  return /^assertServerOnly\(/m.test(SOURCE.get(file) ?? "");
}

/** Resolves an import specifier to a file inside this repo, or null. */
function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // a package, not repo source

  for (const candidate of [
    base,
    ...EXTS.map((e) => base + e),
    ...EXTS.map((e) => path.join(base, "index" + e)),
  ]) {
    if (SOURCE.has(candidate)) return candidate;
  }
  return null;
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;

function importsOf(file: string): string[] {
  const src = SOURCE.get(file) ?? "";
  const out: string[] = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const resolved = resolveImport(file, m[1]);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** Depth-first walk of the import graph, returning the offending path if any. */
function reachesServerOnly(entry: string): string[] | null {
  const seen = new Set<string>();
  const stack: Array<{ file: string; trail: string[] }> = [{ file: entry, trail: [entry] }];

  while (stack.length > 0) {
    const { file, trail } = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);

    if (file !== entry && isServerOnlyModule(file)) return trail;
    // A nested "use client" module is still client code; keep walking it.
    for (const dep of importsOf(file)) {
      stack.push({ file: dep, trail: [...trail, dep] });
    }
  }
  return null;
}

const rel = (f: string) => path.relative(ROOT, f);

describe("server-only modules are unreachable from client code", () => {
  const clientModules = FILES.filter(isClientModule);
  const serverOnlyModules = FILES.filter(isServerOnlyModule);

  it("finds the modules it is meant to police", () => {
    // If either side is empty the whole suite would pass vacuously.
    expect(clientModules.length).toBeGreaterThan(0);
    expect(serverOnlyModules.map(rel).sort()).toEqual([
      // Holds the service-role client and the Stripe secret key.
      "lib/couranr/fulfillment/commands.ts",
      "lib/couranr/onboarding/commands.ts",
      // The payment modules hold the service-role client, the Stripe secret
      // key and the token hashing. None may ever be reachable from a bundle.
      "lib/couranr/payments/commands.ts",
      "lib/couranr/payments/stripe.ts",
      "lib/couranr/payments/tokens.ts",
      "lib/couranr/requests/actor.ts",
      "lib/couranr/requests/commands.ts",
    ]);
  });

  it("no client module imports a server-only module, directly or transitively", () => {
    const offenders: string[] = [];
    for (const entry of clientModules) {
      const trail = reachesServerOnly(entry);
      if (trail) offenders.push(trail.map(rel).join("\n    -> "));
    }
    expect(offenders, `client code reaches server-only modules:\n  ${offenders.join("\n  ")}`).toEqual(
      []
    );
  });

  /**
   * Positive control. Without it, a broken resolver or a regex that matches
   * nothing would make the test above pass no matter what the code does.
   */
  it("the walker DOES detect a server-only import when one exists", () => {
    const serverRoute = path.join(ROOT, "app/api/couranr/delivery-requests/route.ts");
    expect(SOURCE.has(serverRoute)).toBe(true);
    const trail = reachesServerOnly(serverRoute);
    expect(trail, "the route should reach a server-only module").not.toBeNull();
    expect(trail!.map(rel)).toContain("lib/couranr/requests/commands.ts");
  });

  it("recognises a 'use client' directive that follows a comment", () => {
    const browserClient = path.join(ROOT, "lib/supabaseClient.ts");
    expect(isClientModule(browserClient)).toBe(true);
  });
});

/**
 * The complementary rule: no server route may import the `"use client"`
 * browser Supabase client. Scoped to the new canonical routes — the six legacy
 * offenders are known and are not this commit's to fix.
 */
describe("canonical server routes do not import the browser client", () => {
  const canonical = FILES.filter((f) => rel(f).startsWith("app/api/couranr/"));

  /**
   * The exact set, not a count: a new canonical route has to be added here
   * deliberately, so it cannot be introduced without being checked.
   */
  it("covers every canonical route", () => {
    expect(canonical.map(rel).sort()).toEqual([
      "app/api/couranr/delivery-requests/[id]/authorize-payment/route.ts",
      "app/api/couranr/delivery-requests/[id]/estimate/route.ts",
      "app/api/couranr/delivery-requests/[id]/fulfillment/route.ts",
      "app/api/couranr/delivery-requests/[id]/payment-link/route.ts",
      "app/api/couranr/delivery-requests/[id]/readiness/route.ts",
      "app/api/couranr/delivery-requests/[id]/reconcile-payment/route.ts",
      "app/api/couranr/delivery-requests/[id]/route.ts",
      "app/api/couranr/delivery-requests/[id]/submit/route.ts",
      "app/api/couranr/delivery-requests/route.ts",
      "app/api/couranr/me/business-accounts/route.ts",
      "app/api/couranr/me/landing/route.ts",
      "app/api/couranr/me/workspace/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/accept-as-quoted/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/begin-review/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/capture/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/decline/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/reconcile-capture/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/requote/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/service-plan/route.ts",
      "app/api/couranr/operations/queue/route.ts",
      "app/api/couranr/pay/[token]/reconcile/route.ts",
      "app/api/couranr/pay/[token]/route.ts",
      "app/api/couranr/stripe/webhook/route.ts",
    ]);
  });

  /**
   * Every canonical route must establish who is calling before it does
   * anything. Ten of the 76 legacy routes have no authentication check at all,
   * two of which touch money; none of these may join them.
   */
  /**
   * Three authorization classes, and a route belongs to exactly one.
   *
   * Most routes resolve a Bearer actor. Two do not, and both are enumerated
   * here rather than exempted by a pattern, so a genuinely unauthenticated
   * route cannot join them by accident:
   *
   *   TOKEN     `/pay/[token]` — the link IS the authorization: 256 random
   *             bits, stored only as a SHA-256 hash, scoped to one request and
   *             one action, expiring within 7 days and revoked when the quote
   *             changes. A customer has no Couranr account to sign in to.
   *   SIGNATURE the Stripe webhook — authorized by verifying Stripe's
   *             signature over the raw bytes with our own signing secret,
   *             before the payload is parsed at all.
   */
  const TOKEN_AUTHORIZED = new Set([
    "app/api/couranr/pay/[token]/route.ts",
    "app/api/couranr/pay/[token]/reconcile/route.ts",
  ]);
  const SIGNATURE_AUTHORIZED = new Set(["app/api/couranr/stripe/webhook/route.ts"]);

  it("every canonical route authorizes its caller somehow", () => {
    for (const file of canonical) {
      const src = SOURCE.get(file) ?? "";
      const name = rel(file);

      if (TOKEN_AUTHORIZED.has(name)) {
        // It must actually redeem the token, and reject a malformed one
        // before any lookup happens.
        expect(src, `${name} does not redeem its token`).toMatch(/redeemPaymentLink\(/);
        expect(src, `${name} does not validate the token shape`).toMatch(/isWellFormedToken\(/);
        continue;
      }
      if (SIGNATURE_AUTHORIZED.has(name)) {
        expect(src, `${name} does not verify a signature`).toMatch(/constructEvent\(/);
        expect(src, `${name} does not use its own signing secret`).toMatch(
          /STRIPE_COURANR_WEBHOOK_SECRET/
        );
        continue;
      }

      expect(
        /resolveRequestActor\(|resolveUserId\(/.test(src),
        `${name} has no authentication check`
      ).toBe(true);
    }
  });

  /** No canonical route may accept a status or an amount from a caller. */
  it("no canonical route reads a status or an amount off the request body", () => {
    for (const file of canonical) {
      const src = SOURCE.get(file) ?? "";
      for (const rx of [
        /body\??\.\w*[Ss]tatus/,
        /body\??\.\w*[Ss]tate/,
        /body\??\.\w*[Cc]ents/,
        /body\??\.\w*[Aa]mount/,
        /body\??\.\w*[Tt]otal/,
      ]) {
        expect(rx.test(src), `${rel(file)} reads ${rx} from the body`).toBe(false);
      }
    }
  });

  for (const file of canonical) {
    it(`${rel(file)} uses the service-role client only`, () => {
      const trail = (function find(entry: string): string[] | null {
        const seen = new Set<string>();
        const stack: Array<{ f: string; t: string[] }> = [{ f: entry, t: [entry] }];
        while (stack.length) {
          const { f, t } = stack.pop()!;
          if (seen.has(f)) continue;
          seen.add(f);
          if (rel(f) === "lib/supabaseClient.ts") return t;
          for (const d of importsOf(f)) stack.push({ f: d, t: [...t, d] });
        }
        return null;
      })(file);
      expect(trail === null, trail ? trail.map(rel).join(" -> ") : "").toBe(true);
    });
  }
});
