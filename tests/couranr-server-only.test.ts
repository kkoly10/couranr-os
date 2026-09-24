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

import { CANONICAL_ROUTES, SERVER_ONLY_MODULES } from "./couranr-security-inventory";

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
    expect(serverOnlyModules.map(rel).sort()).toEqual(SERVER_ONLY_MODULES);
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
    expect(canonical.map(rel).sort()).toEqual(CANONICAL_ROUTES);
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
   *   TOKEN     `/pay/[token]` and `/track/[token]` — the link IS the
   *             authorization: 256 random bits, stored only as a SHA-256 hash,
   *             scoped to one request and one audience, expiring, and
   *             revocable. A customer has no Couranr account to sign in to.
   *   SIGNATURE the Stripe webhook — authorized by verifying Stripe's
   *             signature over the raw bytes with our own signing secret,
   *             before the payload is parsed at all.
   *
   * Membership is not enough to pass. Each token route must be shown BELOW to
   * validate the token's shape before any lookup AND to resolve it through a
   * named redeem path — otherwise "add the file to the set" would be a way to
   * ship an unauthenticated route.
   */
  const TOKEN_AUTHORIZED = new Map<string, { shape: RegExp; redeem: RegExp }>([
    [
      "app/api/couranr/consumer/recover-sender/route.ts",
      { shape: /isWellFormedAccessToken\(/, redeem: /recoverSenderGuestSession\(/ },
    ],
    [
      "app/api/couranr/track/[token]/help-link/route.ts",
      { shape: /isWellFormedTrackingToken\(/, redeem: /issueCustomerHelpToken\(/ },
    ],
    /*
     * Batch 3 §D. The consumer guest routes authorize by the opaque
     * x-couranr-guest header: shape-checked before hashing, then redeemed
     * against the hash-only session store with ONE uniform refusal.
     * (consumer/session mints the credential and is inventoried below as
     * deliberately unauthenticated — it creates authority, it holds none.)
     */
    [
      "app/api/couranr/consumer/estimate/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/driver-feedback/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/cancellation-review/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/help-link/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/pay/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/pickup-code/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/pickup-manifest/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/places/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/readiness/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/reconcile-payment/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/refresh-quote/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/interpret/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/request/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    [
      "app/api/couranr/consumer/submit/route.ts",
      { shape: /redeemGuestSessionToken\(/, redeem: /redeemGuestSessionToken\(/ },
    ],
    /*
     * Merchant-hosted customer routes use a distinct opaque header credential.
     * The session endpoint below mints it; every subsequent hosted public route
     * redeems it against BOTH the token hash and the merchant slug snapshot.
     */
    [
      "app/api/couranr/hosted/[merchantSlug]/places/route.ts",
      { shape: /redeemHostedSessionToken\(/, redeem: /redeemHostedSessionToken\(/ },
    ],
    [
      "app/api/couranr/hosted/[merchantSlug]/request/route.ts",
      { shape: /redeemHostedSessionToken\(/, redeem: /redeemHostedSessionToken\(/ },
    ],
    [
      "app/api/couranr/hosted/[merchantSlug]/submit/route.ts",
      { shape: /redeemHostedSessionToken\(/, redeem: /redeemHostedSessionToken\(/ },
    ],
    [
      "app/api/couranr/pay/[token]/reconcile/route.ts",
      { shape: /isWellFormedToken\(/, redeem: /redeemPaymentLink\(/ },
    ],
    [
      "app/api/couranr/pay/[token]/route.ts",
      { shape: /isWellFormedToken\(/, redeem: /redeemPaymentLink\(/ },
    ],
    [
      "app/api/couranr/track/[token]/route.ts",
      // `loadTrackingView` redeems internally and then loads only the rows the
      // sanitized projection needs.
      { shape: /isWellFormedTrackingToken\(/, redeem: /loadTrackingView\(/ },
    ],
    [
      "app/api/couranr/track/[token]/driver-feedback/route.ts",
      { shape: /isWellFormedTrackingToken\(/, redeem: /redeemTrackingLink\(/ },
    ],
    [
      "app/api/couranr/track/[token]/adult-attestation/route.ts",
      { shape: /isWellFormedTrackingToken\(/, redeem: /attestRecipientAdult\(/ },
    ],
    [
      // The recipient's own handoff credential. Same contract as the
      // attestation route: the tracking token IS the authorization, shape is
      // checked before anything is hashed, and the command re-resolves it in
      // SQL as a live, unexpired, recipient-audience credential.
      "app/api/couranr/track/[token]/dropoff-code/route.ts",
      { shape: /isWellFormedTrackingToken\(/, redeem: /issueRecipientDropoffCode\(/ },
    ],
    [
      "app/api/couranr/track/[token]/proof/[proofId]/url/route.ts",
      // The proof route needs a SECOND check beyond redeeming: `signedProofUrl`
      // does no scoping of its own, so the proof must be proved to belong to
      // this token's delivery before anything is minted.
      { shape: /isWellFormedTrackingToken\(/, redeem: /authorizeProofForToken\(/ },
    ],
    [
      // PUB-007 Delivery Help. Unauthenticated by design: the recipient of a
      // delivery has no account, so the token IS the credential. The shape is
      // checked in the route before any database work, exactly as the tracking
      // route does, so junk URLs cannot be used to probe timing.
      "app/api/couranr/help/[token]/route.ts",
      { shape: /isWellFormedHelpToken\(/, redeem: /redeemHelpToken\(/ },
    ],
    [
      // CUS-004 uses the same one-delivery Delivery Help credential. It may
      // author only the scoped problem-report/evidence substrate.
      "app/api/couranr/help/[token]/problem-report/route.ts",
      { shape: /isWellFormedHelpToken\(/, redeem: /redeemHelpToken\(/ },
    ],
    [
      // CUS-002 is the same one-delivery Delivery Help credential, not a new
      // public authorization class. It may only append a reviewed help message.
      "app/api/couranr/help/[token]/resolution-request/route.ts",
      { shape: /isWellFormedHelpToken\(/, redeem: /redeemHelpToken\(/ },
    ],
    [
      // Opaque, revocable portrait reference for mail image proxies. It
      // carries only approved public identity bytes, never a storage path.
      "app/api/couranr/driver-portrait/[publicId]/route.ts",
      { shape: /isWellFormedPortraitPublicId\(/, redeem: /redeemDriverPortrait\(/ },
    ],
  ]);
  const SIGNATURE_AUTHORIZED = new Set(["app/api/couranr/stripe/webhook/route.ts"]);
  const CRON_AUTHORIZED = new Set(["app/api/couranr/internal/automation/tick/route.ts"]);

  it("every canonical route authorizes its caller somehow", () => {
    for (const file of canonical) {
      const src = SOURCE.get(file) ?? "";
      const name = rel(file);

      /*
       * Batch 3 §D. consumer/session MINTS the guest credential: it is
       * unauthenticated BY DESIGN (the 256-bit token it returns once is the
       * authorization for every other consumer route, which this test forces
       * to redeem it). Hold it to its own contract instead of an auth check.
       */
      if (name === "app/api/couranr/consumer/session/route.ts") {
        expect(src, `${name} must mint through createGuestSession`).toMatch(/createGuestSession\(/);
        expect(src, `${name} must document its unauthenticated design`).toMatch(/UNAUTHENTICATED BY DESIGN/);
        continue;
      }
      if (name === "app/api/couranr/hosted/[merchantSlug]/session/route.ts") {
        expect(src, `${name} must mint through createHostedSession`).toMatch(/createHostedSession\(/);
        expect(src, `${name} must document the public bootstrap authorization boundary`).toMatch(
          /Public bootstrap by design/
        );
        continue;
      }
      const tokenRule = TOKEN_AUTHORIZED.get(name);
      if (tokenRule) {
        // It must actually redeem the token, and reject a malformed one
        // before any lookup happens.
        expect(src, `${name} does not redeem its token`).toMatch(tokenRule.redeem);
        expect(src, `${name} does not validate the token shape`).toMatch(tokenRule.shape);
        continue;
      }
      if (SIGNATURE_AUTHORIZED.has(name)) {
        expect(src, `${name} does not verify a signature`).toMatch(/constructEvent\(/);
        expect(src, `${name} does not use its own signing secret`).toMatch(
          /STRIPE_COURANR_WEBHOOK_SECRET/
        );
        continue;
      }
      if (CRON_AUTHORIZED.has(name)) {
        expect(src, `${name} does not require CRON_SECRET`).toMatch(/process\.env\.CRON_SECRET/);
        expect(src, `${name} does not verify the bearer Authorization header`).toMatch(
          /authorization[\s\S]*Bearer/
        );
        expect(src, `${name} must fail closed when the secret is absent`).toMatch(
          /automation_not_configured/
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
