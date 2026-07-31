import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROFILE_ROLES,
  defaultDestination,
  isProfileRole,
  normalizeNext,
  resolveLanding,
  resolveSurface,
  surfaceOf,
  type LandingFacts,
} from "@/lib/couranr/auth/landing";
import { classifyAuthError } from "@/components/couranr/auth/authCopy";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const MERCHANT: LandingFacts = { role: "customer", activeMembershipCount: 1 };
const NEW_MERCHANT: LandingFacts = { role: "customer", activeMembershipCount: 0 };
const ADMIN: LandingFacts = { role: "admin", activeMembershipCount: 0 };
const DRIVER: LandingFacts = { role: "driver", activeMembershipCount: 0 };

/* ------------------------------------------------------------ vocabulary */

describe("profile role vocabulary", () => {
  /**
   * The live constraint is:
   *   CHECK ((role = ANY (ARRAY['customer','driver','admin'])))
   * A value this list accepts but the database rejects is a runtime failure.
   */
  it("is exactly the three values profiles_role_check permits", () => {
    expect([...PROFILE_ROLES].sort()).toEqual(["admin", "customer", "driver"]);
  });

  it("does not invent an `operations` profile value", () => {
    expect(isProfileRole("operations")).toBe(false);
    expect(PROFILE_ROLES).not.toContain("operations" as any);
    // No TypeScript module treats "operations" as a PROFILE role any more.
    // `kind: "operations"` is the RequestActor discriminant and is unrelated,
    // so match the role list rather than the bare word.
    for (const f of ["lib/couranr/requests/actor.ts", "lib/couranr/onboarding/commands.ts"]) {
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const decl = code.match(/OPERATIONS_PROFILE_ROLES[^=]*=\s*\[([^\]]*)\]/);
      expect(decl, `${f} has no OPERATIONS_PROFILE_ROLES`).not.toBeNull();
      expect(decl![1].replace(/\s/g, "")).toBe('"admin"');
    }
  });

  it("rejects anything that is not a live role", () => {
    for (const v of ["", "owner", "ops", "ADMIN", null, undefined, 7]) {
      expect(isProfileRole(v)).toBe(false);
    }
  });
});

/* --------------------------------------------------------- landing order */

describe("landing resolution", () => {
  it("sends an admin to Operations", () => {
    expect(resolveSurface(ADMIN)).toBe("operations");
    expect(defaultDestination(ADMIN)).toBe("/operations");
  });

  it("sends a driver to the driver surface", () => {
    expect(resolveSurface(DRIVER)).toBe("driver");
    expect(defaultDestination(DRIVER)).toBe("/driver");
  });

  it("sends a merchant with an active membership to /business", () => {
    expect(defaultDestination(MERCHANT)).toBe("/business");
  });

  it("sends an authenticated caller with no membership to onboarding", () => {
    expect(defaultDestination(NEW_MERCHANT)).toBe("/business/onboarding");
  });

  /** The higher-privilege surface wins, so an operator never acts as a merchant by accident. */
  it("prefers Operations when an admin also holds a membership", () => {
    const both: LandingFacts = { role: "admin", activeMembershipCount: 3 };
    expect(defaultDestination(both)).toBe("/operations");
  });

  it("treats a missing profile row as a merchant, not as an operator", () => {
    const noProfile: LandingFacts = { role: null, activeMembershipCount: 1 };
    expect(resolveSurface(noProfile)).toBe("business");
  });
});

/* ------------------------------------------------------- surface parsing */

describe("surfaceOf", () => {
  it("maps the three authenticated roots", () => {
    expect(surfaceOf("/operations")).toBe("operations");
    expect(surfaceOf("/driver/availability")).toBe("driver");
    expect(surfaceOf("/business/deliveries/new")).toBe("business");
  });

  /** `/businesses` is the PUBLIC marketing page. A startsWith check would claim it. */
  it("is segment-aware, not prefix-based", () => {
    expect(surfaceOf("/businesses")).toBe(null);
    expect(surfaceOf("/business-tools")).toBe(null);
    expect(surfaceOf("/driverless")).toBe(null);
  });

  it("returns null for public paths", () => {
    for (const p of ["/", "/pricing", "/sign-in", "/estimate"]) {
      expect(surfaceOf(p), p).toBe(null);
    }
  });

  it("ignores query and hash", () => {
    expect(surfaceOf("/business/deliveries/new?step=review")).toBe("business");
    expect(surfaceOf("/operations#top")).toBe("operations");
  });
});

/* ------------------------------------------------------- open redirects */

describe("normalizeNext refuses every external destination", () => {
  const EXTERNAL = [
    "//evil.test",
    "///evil.test",
    "https://evil.test",
    "http://evil.test/path",
    "HTTPS://EVIL.TEST",
    "javascript:alert(1)",
    "data:text/html,<script>",
    "\\\\evil.test",
    "/\\evil.test",
    "%2f%2fevil.test",
    "%2F%2Fevil.test",
    "https:/evil.test",
    "//evil.test/business",
    "\thttps://evil.test",
  ];

  for (const value of EXTERNAL) {
    it(`rejects ${JSON.stringify(value)}`, () => {
      expect(normalizeNext(value).path).toBe(null);
    });
  }

  it("rejects traversal rather than resolving it", () => {
    expect(normalizeNext("/business/../operations").path).toBe(null);
  });

  it("rejects a relative path with no leading slash", () => {
    expect(normalizeNext("business").path).toBe(null);
    expect(normalizeNext("business/deliveries").reason).toBe("not_internal");
  });

  it("rejects a malformed escape sequence instead of throwing", () => {
    expect(() => normalizeNext("%E0%A4%A")).not.toThrow();
    expect(normalizeNext("%E0%A4%A").path).toBe(null);
  });

  /**
   * The regression this guards: a naive `[ -\s]` character class is a RANGE
   * from space, which also matches a literal hyphen — it would have rejected
   * /sign-in and every other hyphenated route in the product.
   */
  it("accepts ordinary internal paths, including hyphenated ones", () => {
    for (const p of [
      "/business",
      "/sign-in",
      "/business/deliveries/new",
      "/business/deliveries/new?step=review",
      "/operations/queue",
      "/driver/availability",
      "/business/settings/team",
    ]) {
      expect(normalizeNext(p).path, p).toBe(p);
    }
  });
});

/* -------------------------------------------- cross-role next refusals */

describe("resolveLanding honours next only within the caller's own surface", () => {
  it("lets a merchant deep-link inside /business", () => {
    const d = resolveLanding(MERCHANT, "/business/deliveries/new");
    expect(d.destination).toBe("/business/deliveries/new");
    expect(d.usedNext).toBe(true);
  });

  it("does NOT let a merchant next into /operations", () => {
    const d = resolveLanding(MERCHANT, "/operations/queue");
    expect(d.destination).toBe("/business");
    expect(d.usedNext).toBe(false);
    expect(d.rejectedNextReason).toBe("wrong_surface");
  });

  it("does NOT let a driver next into /business", () => {
    const d = resolveLanding(DRIVER, "/business/deliveries/new");
    expect(d.destination).toBe("/driver");
    expect(d.rejectedNextReason).toBe("wrong_surface");
  });

  it("does NOT let a merchant next into /driver", () => {
    expect(resolveLanding(MERCHANT, "/driver").destination).toBe("/business");
  });

  it("lets an admin deep-link inside /operations", () => {
    const d = resolveLanding(ADMIN, "/operations/queue");
    expect(d.destination).toBe("/operations/queue");
    expect(d.usedNext).toBe(true);
  });

  it("falls back for an external next rather than honouring it", () => {
    const d = resolveLanding(MERCHANT, "https://evil.test/business");
    expect(d.destination).toBe("/business");
    expect(d.rejectedNextReason).toBe("absolute_url");
  });

  it("falls back for a protocol-relative next", () => {
    expect(resolveLanding(MERCHANT, "//evil.test").rejectedNextReason).toBe("protocol_relative");
  });

  it("never returns a destination that is not an internal path", () => {
    const probes = [undefined, null, "", "//evil.test", "https://evil.test", "/operations", "x"];
    for (const facts of [MERCHANT, NEW_MERCHANT, ADMIN, DRIVER]) {
      for (const p of probes) {
        const d = resolveLanding(facts, p);
        expect(d.destination.startsWith("/"), String(p)).toBe(true);
        expect(d.destination.startsWith("//")).toBe(false);
        expect(d.destination).not.toMatch(/^[a-z]+:/i);
      }
    }
  });

  /** A deep merchant link is useless before onboarding: the page has nothing to show. */
  it("sends a membership-less merchant to onboarding even with a valid next", () => {
    const d = resolveLanding(NEW_MERCHANT, "/business/deliveries/new");
    expect(d.destination).toBe("/business/onboarding");
    expect(d.usedNext).toBe(false);
  });
});

/* --------------------------------------------------------- auth copy */

describe("auth error copy", () => {
  it("classifies invalid credentials without revealing whether the account exists", () => {
    const f = classifyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" });
    expect(f.kind).toBe("invalid_credentials");
    expect(f.body).not.toMatch(/no account|not found|does not exist|unknown email/i);
  });

  it("classifies an unconfirmed email", () => {
    expect(classifyAuthError({ code: "email_not_confirmed" }).kind).toBe("email_not_confirmed");
    expect(classifyAuthError({ message: "Email not confirmed" }).kind).toBe("email_not_confirmed");
  });

  it("classifies rate limiting by code or status", () => {
    expect(classifyAuthError({ status: 429 }).kind).toBe("rate_limited");
    expect(classifyAuthError({ code: "over_request_rate_limit" }).kind).toBe("rate_limited");
  });

  /** An unreviewed Supabase string must never reach a merchant verbatim. */
  it("never echoes an unrecognised driver message", () => {
    const leak = 'PGRST301: JWSError JWSInvalidSignature on relation "profiles"';
    const f = classifyAuthError({ message: leak });
    expect(f.kind).toBe("unknown");
    expect(JSON.stringify(f)).not.toContain("PGRST301");
    expect(JSON.stringify(f)).not.toContain("profiles");
  });

  it("survives a null or shapeless error", () => {
    expect(classifyAuthError(null).kind).toBe("unknown");
    expect(classifyAuthError({}).kind).toBe("unknown");
  });
});

/* ------------------------------------------------------ wiring assertions */

describe("sign-in screen", () => {
  const page = read("app/(couranr)/(public)/sign-in/page.tsx");
  const form = read("components/couranr/auth/SignInForm.tsx");

  it("is no longer a placeholder", () => {
    expect(page).not.toMatch(/ScreenPlaceholder/);
    expect(page).toMatch(/SignInForm/);
  });

  it("uses the documented Supabase call", () => {
    expect(form).toMatch(/supabase\.auth\.signInWithPassword\(/);
  });

  it("asks the SERVER where to land, and never decides for itself", () => {
    expect(form).toMatch(/fetchLanding\(/);
    // No hard-coded post-login destination in the form.
    expect(form).not.toMatch(/push\("\/operations/);
    expect(form).not.toMatch(/push\("\/driver/);
    expect(form).not.toMatch(/replace\("\/business/);
  });

  it("covers the required states", () => {
    expect(form).toMatch(/checkingSession/);      // loading
    expect(form).toMatch(/fieldErrors/);          // empty validation
    expect(form).toMatch(/classifyAuthError/);    // invalid credentials
    expect(form).toMatch(/email_not_confirmed/);  // unconfirmed
    expect(form).toMatch(/did not stick/);        // session unavailable
    expect(form).toMatch(/SuccessState/);         // success
    expect(form).toMatch(/router\.replace/);      // already-signed-in redirect
  });

  it("shows no raw internal error", () => {
    expect(form).not.toMatch(/error\.message/);
    expect(form).not.toMatch(/JSON\.stringify\(error/);
  });

  /** §2: canonical screens use cr- classes and --couranr-* tokens only. */
  it("leaks no legacy styling", () => {
    for (const f of [
      "components/couranr/auth/SignInForm.tsx",
      "components/couranr/auth/SignOutButton.tsx",
      "components/couranr/auth/SurfaceGuard.tsx",
    ]) {
      const src = read(f);
      const classes = Array.from(src.matchAll(/className=\{?["'`]([^"'`]+)/g))
        .flatMap((m) => m[1].split(/\s+/))
        .filter(Boolean)
        .filter((c) => !c.startsWith("cr-"));
      expect(classes, `${f} uses non-cr classes: ${classes.join(",")}`).toEqual([]);
      // No unprefixed custom property, which would restyle legacy pages.
      const vars = Array.from(src.matchAll(/var\((--[a-z-]+)/g)).map((m) => m[1]);
      for (const v of vars) expect(v.startsWith("--couranr-"), `${f} uses ${v}`).toBe(true);
    }
  });
});

/* ----------------------------------------------------------- sign out */

describe("sign out", () => {
  const button = read("components/couranr/auth/SignOutButton.tsx");
  const shells = read("components/couranr/shell/shells.tsx");

  it("calls Supabase signOut", () => {
    expect(button).toMatch(/supabase\.auth\.signOut\(\)/);
  });

  /** The bug: a Link that navigated and left the session live. */
  it("redirects only AFTER the session is gone", () => {
    const call = button.indexOf("supabase.auth.signOut()");
    const errorGuard = button.indexOf("if (error)");
    const redirect = button.indexOf('router.replace("/sign-in")');
    expect(call).toBeGreaterThan(-1);
    expect(errorGuard).toBeGreaterThan(call);
    expect(redirect).toBeGreaterThan(errorGuard);
  });

  it("does not claim success when signOut fails", () => {
    expect(button).toMatch(/still signed in/i);
    // The failure branch returns before any navigation.
    const failBranch = button.slice(button.indexOf("if (error)"), button.indexOf("router.replace"));
    expect(failBranch).toMatch(/return;/);
  });

  it("is a real button, keyboard reachable, with a busy state", () => {
    expect(button).toMatch(/<button/);
    expect(button).toMatch(/type="button"/);
    expect(button).toMatch(/disabled=\{busy\}/);
    expect(button).toMatch(/aria-busy/);
  });

  it("is used by the merchant, operations and driver shells", () => {
    expect((shells.match(/<SignOutButton/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  /** "Sign out" must never be navigation alone. */
  it("no shell implements sign out as a Link", () => {
    expect(shells).not.toMatch(/SignOutLink/);
    const linkBlocks = Array.from(shells.matchAll(/<Link[\s\S]{0,200}?<\/Link>/g)).map((m) => m[0]);
    for (const block of linkBlocks) {
      expect(block, `a Link still renders sign-out: ${block}`).not.toMatch(/Sign out/i);
    }
    // Stripped of comments: the file legitimately DOCUMENTS the old
    // `<Link href="/login">` in explaining why it is gone.
    const shellCode = shells.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(shellCode).not.toMatch(/href="\/login"/);
  });

  /** The customer surface is reached by a per-delivery token, not a session. */
  it("is absent from the customer token shell", () => {
    const customer = shells.slice(
      shells.indexOf("export function CustomerTokenShell"),
      shells.indexOf("export function MerchantShell")
    );
    expect(customer).not.toMatch(/SignOutButton/);
  });
});

/* -------------------------------------------------------------- guards */

describe("surface guards", () => {
  const guard = read("components/couranr/auth/SurfaceGuard.tsx");

  for (const [file, surface] of [
    ["app/(couranr)/business/layout.tsx", "business"],
    ["app/(couranr)/operations/layout.tsx", "operations"],
    ["app/(couranr)/driver/layout.tsx", "driver"],
  ] as const) {
    it(`${file} guards the ${surface} surface`, () => {
      const src = read(file);
      expect(src).toMatch(/<SurfaceGuard/);
      expect(src).toMatch(new RegExp(`surface="${surface}"`));
    });
  }

  it("renders no children until the check resolves", () => {
    // The only unconditional return of children is behind state === "allowed".
    expect(guard).toMatch(/if \(state === "allowed"\) return <>\{children\}<\/>/);
    const beforeAllowed = guard.slice(0, guard.indexOf('state === "allowed"'));
    expect(beforeAllowed).not.toMatch(/\{children\}/);
  });

  it("sends a signed-out visitor to sign-in with a safe next", () => {
    expect(guard).toMatch(/\/sign-in\?next=/);
    expect(guard).toMatch(/encodeURIComponent/);
  });

  it("sends a wrong-surface caller to the SERVER-derived destination", () => {
    expect(guard).toMatch(/router\.replace\(landing\.value\.destination\)/);
  });

  it("says plainly that it is not authorization", () => {
    expect(guard).toMatch(/NOT AUTHORIZATION/);
  });
});

/* --------------------------------------------------------- landing route */

describe("the landing route", () => {
  const route = read("app/api/couranr/me/landing/route.ts");

  it("requires a Bearer token and validates it through getUser", () => {
    expect(route).toMatch(/resolveUserId\(req\)/);
    expect(read("lib/couranr/requests/actor.ts")).toMatch(/supabaseAdmin\.auth\.getUser\(token\)/);
  });

  it("reads no role or account from the client", () => {
    expect(route).not.toMatch(/searchParams\.get\("role"\)/);
    expect(route).not.toMatch(/searchParams\.get\("businessAccountId"\)/);
    expect(route).not.toMatch(/body/);
    // `next` is the ONLY client input.
    const params = Array.from(route.matchAll(/searchParams\.get\("(\w+)"\)/g)).map((m) => m[1]);
    expect(params).toEqual(["next"]);
  });

  it("derives every fact server-side", () => {
    expect(route).toMatch(/from\("profiles"\)/);
    expect(route).toMatch(/from\("business_members"\)/);
    expect(route).toMatch(/eq\("status", "active"\)/);
  });

  it("treats an unrecognised stored role as no role", () => {
    expect(route).toMatch(/isProfileRole\(rawRole\) \? rawRole : null/);
  });

  /**
   * FAIL CLOSED. A failed lookup previously fell through as `data: null` ->
   * zero rows -> "brand-new merchant", which would have sent an established
   * merchant to onboarding on a transient database error.
   */
  describe("fails closed on every lookup", () => {
    it("returns an internal failure when the profile lookup errors", () => {
      expect(route).toMatch(/if \(profileResult\.error\) \{[\s\S]*?routeInternalFailure/);
    });

    it("returns an internal failure when the membership lookup errors", () => {
      expect(route).toMatch(/if \(membershipResult\.error\) \{[\s\S]*?routeInternalFailure/);
    });

    it("returns an internal failure when the membership rows are not an array", () => {
      expect(route).toMatch(/!Array\.isArray\(membershipResult\.data\)/);
    });

    /** Every failure path must return BEFORE any destination is computed. */
    it("computes no destination until every lookup has succeeded", () => {
      const decisionAt = route.indexOf("resolveLanding(");
      const guards = [
        route.indexOf("if (profileResult.error)"),
        route.indexOf("if (membershipResult.error)"),
        route.indexOf("!Array.isArray(membershipResult.data)"),
      ];
      for (const g of guards) {
        expect(g).toBeGreaterThan(-1);
        expect(g).toBeLessThan(decisionAt);
      }
    });

    it("never coerces a failed lookup into a count", () => {
      // The old shape. `?? 0` on a lookup result is the bug.
      expect(route).not.toMatch(/membershipResult\.data\?\.length \?\? 0/);
      expect(route).toMatch(/activeMembershipCount: membershipResult\.data\.length/);
    });

    it("logs the detail rather than returning it", () => {
      expect(route).toMatch(/routeInternalFailure\(/);
      expect(read("lib/couranr/requests/respond.ts")).toMatch(/logServerFailure\(/);
      // The sanitized message is ours, not the driver's.
      expect(route).toMatch(/We could not load your account/);
      // The driver error reaches the logger, never a field read in the route.
      expect(route).toMatch(/error: profileResult\.error/);
      expect(route).not.toMatch(/error\.message/);
    });
  });

  /**
   * The unused lookup is GONE rather than retained with a corrected error
   * check: `hasWorkspace` was never read by any landing decision.
   */
  it("runs no query whose result is ignored", () => {
    expect(route).not.toMatch(/couranr_merchant_workspaces/);
    expect(route).not.toMatch(/hasWorkspace/);
    expect(read("lib/couranr/auth/landing.ts")).not.toMatch(/hasWorkspace/);
    // Exactly two lookups remain, and both feed the decision.
    expect((route.match(/supabaseAdmin\s*\.?\s*\n?\s*\.from\(/g) || []).length).toBe(2);
  });
});

describe("the business-accounts route fails closed", () => {
  const route = read("app/api/couranr/me/business-accounts/route.ts");
  const actor = read("lib/couranr/requests/actor.ts");

  it("returns an internal failure instead of an empty list", () => {
    expect(route).toMatch(/isMembershipLookupFailed\(result\)/);
    expect(route).toMatch(/routeInternalFailure\(/);
  });

  /** The root cause: `if (error || !data) return []`. */
  it("listActiveMemberships propagates the error rather than swallowing it", () => {
    const code = actor.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/if \(error \|\| !data\) return \[\]/);
    expect(code).toMatch(/if \(error\) return \{ ok: false/);
    expect(code).toMatch(/!Array\.isArray\(data\)/);
  });
});

/* ------------------------------------------------------- signup honesty */

describe("signup confirmation handling", () => {
  const form = read("components/couranr/onboarding/SignUpForm.tsx");

  /** The old comment asserted a Supabase setting this code had never tested. */
  it("no longer asserts that email confirmation is on", () => {
    expect(form).not.toMatch(/Email confirmation is on for this project/);
  });

  it("branches on what signUp actually returned", () => {
    expect(form).toMatch(/if \(data\.session\)/);
    expect(form).toMatch(/runtime property of the Supabase Auth configuration/);
  });

  it("gives a confirmation-required user a usable path forward", () => {
    expect(form).toMatch(/Check your email/);
    expect(form).toMatch(/href: "\/sign-in"/);
  });

  it("does not add an untested emailRedirectTo", () => {
    expect(form).not.toMatch(/emailRedirectTo/);
  });
});

/* ------------------------------------------------ no placeholders left */

describe("the canonical auth loop has no placeholders", () => {
  it("neither sign-in nor sign-up is a ScreenPlaceholder", () => {
    for (const f of [
      "app/(couranr)/(public)/sign-in/page.tsx",
      "app/(couranr)/(public)/sign-up/page.tsx",
      "app/(couranr)/business/onboarding/page.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/ScreenPlaceholder/);
    }
  });

  /** Every route the auth loop links to must exist as a page. */
  it("every internal destination it can produce is a real route", () => {
    const appDir = path.join(ROOT, "app");
    const pages = new Set<string>();
    (function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "page.tsx") {
          const route =
            "/" +
            path
              .relative(appDir, path.dirname(full))
              .split(path.sep)
              .filter((seg) => !(seg.startsWith("(") && seg.endsWith(")")))
              .join("/");
          pages.add(route === "/" ? "/" : route.replace(/\/$/, ""));
        }
      }
    })(appDir);

    for (const dest of ["/sign-in", "/sign-up", "/business", "/business/onboarding", "/operations", "/driver"]) {
      expect(pages.has(dest), `${dest} has no page`).toBe(true);
    }
  });
});
