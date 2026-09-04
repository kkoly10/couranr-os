/**
 * Where a signed-in caller belongs, and whether a requested `next` may be
 * honoured.
 *
 * Pure and dependency-free, so every redirect decision is unit-testable without
 * a database or a browser. The route that uses it resolves the role and the
 * memberships SERVER-SIDE; nothing here reads anything a client sent except the
 * raw `next` string, which is treated as hostile.
 */

/**
 * The LIVE profile vocabulary. `profiles_role_check` on production permits
 * exactly these three:
 *
 *   CHECK ((role = ANY (ARRAY['customer'::text, 'driver'::text, 'admin'::text])))
 *
 * There is no `operations` profile value. Couranr Operations is `admin`. Do not
 * add a fourth value here without the migration that widens the constraint —
 * a role this list accepts but the database rejects is a runtime failure, and a
 * role the database accepts but this list ignores silently loses a surface.
 */
export const PROFILE_ROLES = ["customer", "driver", "admin"] as const;
export type ProfileRole = (typeof PROFILE_ROLES)[number];

export function isProfileRole(v: unknown): v is ProfileRole {
  return typeof v === "string" && (PROFILE_ROLES as readonly string[]).includes(v);
}

/** The authenticated surfaces a landing decision can choose between. */
export type Surface = "operations" | "driver" | "business";

export const SURFACE_ROOT: Record<Surface, string> = {
  operations: "/operations",
  driver: "/driver",
  business: "/app/business",
};

/** Everything the SERVER established about the caller. No client input. */
export type LandingFacts = {
  /** From `profiles.role`. Null when the profile row is missing. */
  role: ProfileRole | null;
  /** Count of `business_members` rows with status 'active'. */
  activeMembershipCount: number;
};

export type LandingDecision = {
  /** The path to send the caller to. Always internal, always absolute-rooted. */
  destination: string;
  /** The surface that owns `destination`. */
  surface: Surface;
  /** True when a requested `next` was honoured rather than the default. */
  usedNext: boolean;
  /** Why a requested `next` was refused. Absent when none was requested. */
  rejectedNextReason?:
    | "not_internal"
    | "protocol_relative"
    | "absolute_url"
    | "wrong_surface"
    | "malformed";
};

/**
 * The surface a caller owns, in priority order.
 *
 * An `admin` who also holds a merchant membership lands on Operations: the
 * higher-privilege surface wins, so an operator never silently ends up acting
 * as a merchant.
 */
export function resolveSurface(facts: LandingFacts): Surface {
  if (facts.role === "admin") return "operations";
  if (facts.role === "driver") return "driver";
  return "business";
}

/**
 * The default destination for a caller who asked for nothing in particular.
 *
 * A merchant with no active membership is sent to onboarding rather than to a
 * dashboard that would show them an empty shell and no way forward.
 */
export function defaultDestination(facts: LandingFacts): string {
  const surface = resolveSurface(facts);
  if (surface !== "business") return SURFACE_ROOT[surface];
  return facts.activeMembershipCount > 0
    ? SURFACE_ROOT.business
    : `${SURFACE_ROOT.business}/onboarding`;
}

/**
 * Which surface a path belongs to, or null if it is not an authenticated
 * surface path at all.
 *
 * SEGMENT-AWARE, and that is the whole point. Two near-misses live next to the
 * merchant surface and neither may be mistaken for it:
 *
 *   - `/businesses` is PUB-009, a public marketing route. A `startsWith`
 *     check would claim it.
 *   - `/business` is PUB-001 since LEG-004 — public marketing, not the
 *     merchant application. The merchant surface moved to `/app/business`,
 *     so matching on the first segment alone would now claim the wrong page.
 *
 * The merchant surface is therefore matched on TWO segments, compared exactly,
 * so `/app/not-business` and `/app/businesses` are both correctly null.
 */
export function surfaceOf(pathname: string): Surface | null {
  const segments = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  const [first, second] = segments;
  if (first === "operations") return "operations";
  if (first === "driver") return "driver";
  if (first === "app" && second === "business") return "business";
  return null;
}

export type NextRejection = NonNullable<LandingDecision["rejectedNextReason"]>;

/**
 * `path` is null exactly when `reason` is set. Written as one shape rather than
 * a union because `tsconfig` sets `"strict": false`, and without
 * `strictNullChecks` a discriminated union does not narrow on `.ok`.
 */
export type NormalizedNext = { path: string | null; reason?: NextRejection };

/**
 * Normalizes an untrusted `next` into an internal relative path.
 *
 * Everything about this function is a refusal. It accepts a path that starts
 * with exactly one `/`, contains no scheme and no authority, and survives
 * decoding. Anything else is rejected rather than repaired — a "cleaned up"
 * open redirect is still an open redirect.
 */
export function normalizeNext(raw: unknown): NormalizedNext {
  if (typeof raw !== "string" || raw === "") return { path: null, reason: "malformed" };

  // Decode first, so `%2f%2fevil.test` cannot smuggle an authority past the
  // checks below. A malformed escape sequence throws; that is a rejection.
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return { path: null, reason: "malformed" };
  }

  // Backslashes are treated as separators by several browsers, so `/\evil.test`
  // and `\\evil.test` behave as protocol-relative URLs. Normalize then reject.
  const probe = value.replace(/\\/g, "/").trim();

  // Control characters and whitespace can split a header or hide a scheme.
  //
  // Checked by codepoint rather than a character class. A naive `[ -\s]` is
  // parsed as a RANGE beginning at space, which also matches a literal
  // hyphen — it would reject `/sign-in` and every other hyphenated route.
  for (let i = 0; i < probe.length; i += 1) {
    const c = probe.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return { path: null, reason: "malformed" };
  }

  if (probe.startsWith("//")) return { path: null, reason: "protocol_relative" };
  // Any scheme at all, including javascript: and data:.
  if (/^[a-z][a-z0-9+.-]*:/i.test(probe)) return { path: null, reason: "absolute_url" };
  if (!probe.startsWith("/")) return { path: null, reason: "not_internal" };

  // Reject traversal outright rather than resolving it.
  if (probe.split("/").includes("..")) return { path: null, reason: "malformed" };

  return { path: probe };
}

/**
 * Resolves where to send a caller, honouring `next` only when the SERVER facts
 * prove they may use that surface.
 *
 * A profile still has ONE primary/default surface: admin defaults to
 * Operations. But an admin may also be a real active Business member. An
 * explicit deep-link into that Business surface is then legitimate — it is
 * how a dual-role pilot operator can switch hats and exercise the Business
 * payer authority Operations deliberately does not have. This is navigation
 * only; every API route still verifies the membership independently.
 *
 * The browser may ask; it may not invent entitlement. A merchant asking for
 * `/operations` still gets `/app/business`.
 */
export function resolveLanding(facts: LandingFacts, rawNext?: unknown): LandingDecision {
  const surface = resolveSurface(facts);
  const fallback = defaultDestination(facts);

  if (rawNext === undefined || rawNext === null || rawNext === "") {
    return { destination: fallback, surface, usedNext: false };
  }

  const normalized = normalizeNext(rawNext);
  if (normalized.path === null) {
    return {
      destination: fallback,
      surface,
      usedNext: false,
      rejectedNextReason: normalized.reason,
    };
  }

  const target = surfaceOf(normalized.path);
  if (target === null) {
    return { destination: fallback, surface, usedNext: false, rejectedNextReason: "wrong_surface" };
  }

  /*
   * Dual-role pilot rule. Admin remains Operations by DEFAULT, but an explicit
   * Business deep-link is allowed when the server found at least one active
   * membership. That lets the same human intentionally switch from Couranr
   * authority to Business payer authority without ever granting Operations
   * the payer capability.
   */
  if (
    target === "business" &&
    surface === "operations" &&
    facts.role === "admin" &&
    facts.activeMembershipCount > 0
  ) {
    return { destination: normalized.path, surface: "business", usedNext: true };
  }

  if (target !== surface) {
    return { destination: fallback, surface, usedNext: false, rejectedNextReason: "wrong_surface" };
  }

  // A merchant who has no workspace yet cannot use a deep merchant link: the
  // page would load and immediately have nothing to show.
  if (surface === "business" && facts.activeMembershipCount === 0) {
    return { destination: fallback, surface, usedNext: false, rejectedNextReason: "wrong_surface" };
  }

  return { destination: normalized.path, surface, usedNext: true };
}
