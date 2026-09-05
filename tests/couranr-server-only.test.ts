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
      // The entropy and SHA-256 behind every link that authorizes by URL. A
      // bundle reaching it would ship the hashing a browser must never do and
      // invite a client-side "verify this token" that skips the database.
      "lib/couranr/accessTokens.ts",
      // MER-003. Holds the service-role client and couranr_decide_activation —
      // the one call that can put a workspace LIVE. A browser must never hold
      // the code that grants activation.
      "lib/couranr/activation/commands.ts",
      // Automatic planning/dispatch owns service-role reads, server routing,
      // capture orchestration and system-only assignment.
      "lib/couranr/automation/engine.ts",
      // Reads every charge Couranr raised against a business. Read-only, but
      // it holds the service-role client and the cross-tenant filter that IS
      // the boundary — service_role bypasses RLS, so a browser holding this
      // would read any business's money.
      "lib/couranr/billing/commands.ts",
      // INT-002. Composes Consumer Smart Intake over the shared intake
      // commands (service-role) and reads the kill switch. A bundle reaching
      // it would ship the write path for a guest's intake evidence.
      "lib/couranr/consumer/intake.ts",
      // Batch 3 §D. Holds the service-role client, the guest-session hashing
      // and every consumer command wrapper. A bundle reaching it would ship
      // the code that turns an anonymous URL header into authority.
      "lib/couranr/consumer/send.ts",
      // Holds the service-role client and every conversation command. A bundle
      // reaching it would ship the write path for messages — and the module
      // that calls `couranr_conversation_thread`, which is the one door to a
      // message body in the entire system.
      "lib/couranr/conversations/commands.ts",
      // Holds the Delivery Help token hashing and the service-role client. A
      // bundle reaching it would ship the code that turns a URL into authority,
      // and invite a client-side "verify this token" that skips the database.
      "lib/couranr/conversations/help.ts",
      // Holds the service-role client and every dispatch command. The driver
      // projection is built here, so a bundle reaching this module would put
      // the unsanitized delivery row within reach of a browser.
       // MER-008/MER-009. Holds the service-role client and the UNMASKED
      // customer projection — a bundle reaching it would ship the read that
      // returns every recipient's real email and phone.
      "lib/couranr/customers/commands.ts",
     "lib/couranr/dispatch/commands.ts",
      // Holds the handoff-code HMAC secret. A bundle reaching this module
      // would ship the key that makes a six-digit PIN safe at all.
      "lib/couranr/driver/codes.ts",
      // The service-role client and every driver transition. It also mints the
      // raw PIN, which exists in exactly one response and nowhere else.
      "lib/couranr/driver/commands.ts",
      // The single accessor for that secret. There is no fallback in it, so a
      // client import would not "degrade" — it would ship the key itself.
      "lib/couranr/driver/handoffSecret.ts",
      // D1. Self-scoped Driver profile reads and the service-role availability
      // command wrapper. Browser components call it only through canonical API
      // routes; importing it into a client bundle would bypass that boundary.
      "lib/couranr/driver/profile.ts",
      // Mints signed upload and read URLs, and holds the storage read that is
      // the authority at finalization.
      "lib/couranr/driver/proof.ts",
      // Builds canonical proof object paths and holds the bucket name. Paths
      // are the part of a private object that leaks furthest.
      "lib/couranr/driver/proofPaths.ts",
      // P6-004. Cross-tenant financial reconciliation uses service_role and
      // reads the private ledger through the one public service-role RPC.
      "lib/couranr/finance/ledger.ts",
      // Holds the service-role client and the Stripe secret key.
      // Batch 3 §C. Composes cancellation with the governed money recovery —
      // release for holds, CAN-001 retention refunds for captured money.
      "lib/couranr/fulfillment/cancellation.ts",
      "lib/couranr/fulfillment/commands.ts",
      // PUB-004 hosted request authority: service-role reads, hash-only hosted
      // session credential handling, merchant validation and provider-backed
      // canonical quote composition. Browser components reach it only through
      // canonical API routes.
      "lib/couranr/hosted/commands.ts",
      // Holds the Anthropic API key inside the client it constructs, and the
      // system prompt that governs what a model is told about merchant text.
      "lib/couranr/intake/anthropicProvider.ts",
      "lib/couranr/intake/commands.ts",
      "lib/couranr/intake/interpret.ts",
      "lib/couranr/intake/provider.ts",
      // Pure redaction/tag-neutralization, no secrets — but it shapes exactly
      // what a provider is shown, and a browser bundle must never carry the
      // patterns a hostile merchant could study to evade.
      "lib/couranr/intake/sanitize.ts",
      "lib/couranr/intake/sync.ts",
      // The ONLY test seam: a process-wide "which provider answers merchants"
      // slot. A bundle must never carry it.
      "lib/couranr/intake/testSeam.ts",
      "lib/couranr/onboarding/commands.ts",
      // The payment modules hold the service-role client, the Stripe secret
      // key and the token hashing. None may ever be reachable from a bundle.
      "lib/couranr/payments/commands.ts",
      "lib/couranr/payments/stripe.ts",
      "lib/couranr/payments/tokens.ts",
      // Holds the service-role client and every preset write. A preset shapes
      // what every future delivery is prefilled with, so a browser reaching
      // this would let anyone rewrite the defaults for a whole business.
      "lib/couranr/presets/commands.ts",
      // Enforces environment gating and database-backed hard budgets for real
      // paid provider calls. It holds service-role budget authority.
      "lib/couranr/providers/paidApiGuard.ts",
      "lib/couranr/requests/actor.ts",
      "lib/couranr/requests/commands.ts",
      // Provider-neutral composition: Google verifies address identity,
      // Mapbox owns route/distance/traffic. Neither authority reaches clients.
      "lib/couranr/routing/canonicalRoute.ts",
      // Holds the server-only Google key and is the only caller of Place
      // Details (New), so browser address facts cannot become authority.
      "lib/couranr/routing/googlePlaces.ts",
      // Disabled legacy rollback implementation. It still contains the Google
      // Routes credential path and therefore remains server-only.
      "lib/couranr/routing/googleRoutes.ts",
      // Current route authority. Holds MAPBOX_ACCESS_TOKEN and paid-call guard.
      "lib/couranr/routing/mapboxDirections.ts",
      // Exact named-market authority. Keeping it server-only prevents a
      // browser from self-classifying an unverified address as serviceable.
      "lib/couranr/routing/market.ts",
      // MER-014/MER-015. Holds the service-role client AND the auth admin API
      // — `listUsers` walks every account in the project to resolve an invite
      // email, which is the last thing that may ever reach a browser bundle.
      "lib/couranr/settings/commands.ts",
      // The customer tracking link. `commands.ts` holds the service-role
      // client and the whole recipient read; `tokens.ts` holds the hashing.
      // A tracking link travels further than any other Couranr URL, so a
      // browser must never hold the code that resolves one.
      "lib/couranr/tracking/commands.ts",
      "lib/couranr/tracking/tokens.ts",
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
      "app/api/couranr/consumer/estimate/route.ts",
      "app/api/couranr/consumer/interpret/route.ts",
      "app/api/couranr/consumer/pay/route.ts",
      "app/api/couranr/consumer/places/route.ts",
      "app/api/couranr/consumer/readiness/route.ts",
      "app/api/couranr/consumer/reconcile-payment/route.ts",
      "app/api/couranr/consumer/refresh-quote/route.ts",
      "app/api/couranr/consumer/request/route.ts",
      "app/api/couranr/consumer/session/route.ts",
      "app/api/couranr/consumer/submit/route.ts",
      "app/api/couranr/conversations/[id]/messages/route.ts",
      "app/api/couranr/conversations/[id]/read/route.ts",
      "app/api/couranr/conversations/[id]/route.ts",
      "app/api/couranr/conversations/route.ts",
      "app/api/couranr/delivery-requests/[id]/authorize-payment/route.ts",
      "app/api/couranr/delivery-requests/[id]/estimate/route.ts",
      "app/api/couranr/delivery-requests/[id]/fulfillment/route.ts",
      "app/api/couranr/delivery-requests/[id]/payment-link/route.ts",
      "app/api/couranr/delivery-requests/[id]/readiness/route.ts",
      "app/api/couranr/delivery-requests/[id]/reconcile-payment/route.ts",
      "app/api/couranr/delivery-requests/[id]/route.ts",
      "app/api/couranr/delivery-requests/[id]/submit/route.ts",
      "app/api/couranr/delivery-requests/[id]/validate-hosted/route.ts",
      "app/api/couranr/delivery-requests/route.ts",
      "app/api/couranr/driver/assignment/route.ts",
      "app/api/couranr/driver/availability/route.ts",
      "app/api/couranr/driver/deliveries/[id]/arrive-at-dropoff/route.ts",
      "app/api/couranr/driver/deliveries/[id]/arrive-at-pickup/route.ts",
      "app/api/couranr/driver/deliveries/[id]/complete-direct-handoff/route.ts",
      "app/api/couranr/driver/deliveries/[id]/complete-leave-at-door/route.ts",
      "app/api/couranr/driver/deliveries/[id]/complete-pickup/route.ts",
      "app/api/couranr/driver/deliveries/[id]/complete-signature/route.ts",
      "app/api/couranr/driver/deliveries/[id]/discrepancy/route.ts",
      "app/api/couranr/driver/deliveries/[id]/proof-upload/route.ts",
      "app/api/couranr/driver/deliveries/[id]/proof/route.ts",
      "app/api/couranr/driver/deliveries/[id]/start-dropoff-route/route.ts",
      "app/api/couranr/driver/deliveries/[id]/start-pickup-route/route.ts",
      "app/api/couranr/driver/deliveries/[id]/verify-pickup-code/route.ts",
      "app/api/couranr/driver/deliveries/[id]/verify-recipient-code/route.ts",
      "app/api/couranr/driver/profile/route.ts",
      "app/api/couranr/driver/proof/[proofId]/url/route.ts",
      "app/api/couranr/driver/proof/finalize/route.ts",
      "app/api/couranr/help/[token]/route.ts",
      "app/api/couranr/hosted/[merchantSlug]/places/route.ts",
      "app/api/couranr/hosted/[merchantSlug]/request/route.ts",
      "app/api/couranr/hosted/[merchantSlug]/session/route.ts",
      "app/api/couranr/hosted/[merchantSlug]/submit/route.ts",
      "app/api/couranr/intake/[id]/route.ts",
      "app/api/couranr/intake/route.ts",
      "app/api/couranr/internal/automation/tick/route.ts",
      "app/api/couranr/me/activation/route.ts",
      "app/api/couranr/me/business-accounts/route.ts",
      "app/api/couranr/me/invitations/route.ts",
      "app/api/couranr/me/landing/route.ts",
      "app/api/couranr/me/settings/route.ts",
      "app/api/couranr/me/team/[memberId]/route.ts",
      "app/api/couranr/me/team/route.ts",
      "app/api/couranr/me/workspace/route.ts",
      "app/api/couranr/merchant/billing/route.ts",
      "app/api/couranr/merchant/customers/route.ts",
      "app/api/couranr/merchant/deliveries/[id]/pickup-code/route.ts",
      "app/api/couranr/merchant/deliveries/[id]/proof/route.ts",
      "app/api/couranr/merchant/deliveries/[id]/recipient-code/route.ts",
      "app/api/couranr/merchant/places/route.ts",
      "app/api/couranr/merchant/presets/route.ts",
      "app/api/couranr/merchant/website-tools/route.ts",
      "app/api/couranr/operations/activation/route.ts",
      "app/api/couranr/operations/businesses/route.ts",
      "app/api/couranr/operations/conversations/[id]/messages/route.ts",
      "app/api/couranr/operations/conversations/[id]/route.ts",
      "app/api/couranr/operations/deliveries/[id]/assignment/route.ts",
      "app/api/couranr/operations/deliveries/[id]/help-link/route.ts",
      "app/api/couranr/operations/deliveries/[id]/pickup-code/route.ts",
      "app/api/couranr/operations/deliveries/[id]/recipient-code/route.ts",
      "app/api/couranr/operations/deliveries/[id]/unassign/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/accept-as-quoted/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/begin-review/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/cancel-delivery/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/capture/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/decline/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/estimate/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/promotional-credit-delivery/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/reconcile-capture/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/reconcile-refund/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/refund/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/release/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/requote/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/service-plan/route.ts",
      "app/api/couranr/operations/delivery-requests/[id]/submit/route.ts",
      "app/api/couranr/operations/delivery-requests/route.ts",
      "app/api/couranr/operations/discrepancies/[id]/safe-to-continue/route.ts",
      "app/api/couranr/operations/drivers/route.ts",
      "app/api/couranr/operations/inbox/route.ts",
      "app/api/couranr/operations/payments/overview/route.ts",
      "app/api/couranr/operations/proof/[proofId]/url/route.ts",
      "app/api/couranr/operations/queue/route.ts",
      "app/api/couranr/operations/vehicles/[id]/route.ts",
      "app/api/couranr/operations/vehicles/route.ts",
      "app/api/couranr/pay/[token]/reconcile/route.ts",
      "app/api/couranr/pay/[token]/route.ts",
      "app/api/couranr/stripe/webhook/route.ts",
      "app/api/couranr/track/[token]/proof/[proofId]/url/route.ts",
      "app/api/couranr/track/[token]/route.ts",
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
      "app/api/couranr/consumer/pay/route.ts",
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
