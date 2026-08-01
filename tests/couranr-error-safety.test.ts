import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PUBLIC_STATUS,
  classifyDatabaseError,
  newCorrelationId,
  publicError,
} from "@/lib/couranr/errors";

const ROOT = path.resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const ROUTES = walk(path.join(ROOT, "app/api/couranr"));
const rel = (f: string) => path.relative(ROOT, f);

describe("correlation ids", () => {
  it("are unique, prefixed and contain no ambiguous characters", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      const id = newCorrelationId();
      expect(id).toMatch(/^cr_[0-9abcdefghjkmnpqrstvwxyz]{12}$/);
      // i, l, o and u are excluded so a person can read these back to support
      // without confusing them for 1 or 0.
      expect(id.slice(3)).not.toMatch(/[ilou]/);
      seen.add(id);
    }
    expect(seen.size).toBe(500);
  });
});

describe("publicError", () => {
  const cid = "cr_abcdefghjkmn";

  it("returns only the four safe fields", () => {
    const body = publicError({ correlationId: cid, code: "internal" });
    expect(Object.keys(body).sort()).toEqual(["code", "correlationId", "error"]);
  });

  /**
   * The rule this whole module exists for. A driver error carries constraint
   * names, table names and SQL; none of it may survive into a response.
   */
  it("drops details for every code except invalid_input", () => {
    const leak = [{ code: 'duplicate key value violates unique constraint "orders_pkey"' }];
    for (const code of [
      "internal",
      "not_permitted",
      "not_found",
      "wrong_state",
      "version_conflict",
      "conflict",
      "unauthenticated",
    ] as const) {
      const body = publicError({ correlationId: cid, code, details: leak });
      expect(body.details, code).toBeUndefined();
      expect(JSON.stringify(body)).not.toMatch(/constraint|orders_pkey|duplicate key/i);
    }
  });

  it("keeps only field-shaped codes on invalid_input", () => {
    const body = publicError({
      correlationId: cid,
      code: "invalid_input",
      details: [
        { code: "loaded_miles_required", field: "loadedMiles" },
        { code: 'relation "couranr_delivery_requests" does not exist' },
        { code: "weight_required" },
      ],
    });
    expect(body.details).toEqual([
      { code: "loaded_miles_required", field: "loadedMiles" },
      { code: "[redacted]" },
      { code: "weight_required" },
    ]);
    // NB: the whole body cannot be scanned for /relation/ — "correlationId"
    // contains it. The leak would be in `details`, so check that.
    expect(JSON.stringify(body.details)).not.toMatch(/relation|does not exist/i);
  });

  it("redacts rather than truncates, so no leaked prefix survives", () => {
    const body = publicError({
      correlationId: cid,
      code: "invalid_input",
      details: [{ code: "syntax error at or near SELECT" }],
    });
    expect(body.details).toEqual([{ code: "[redacted]" }]);
  });

  it("maps every code to a status", () => {
    for (const code of Object.keys(PUBLIC_STATUS)) {
      expect(PUBLIC_STATUS[code as keyof typeof PUBLIC_STATUS]).toBeGreaterThanOrEqual(400);
    }
    expect(PUBLIC_STATUS.version_conflict).toBe(409);
    expect(PUBLIC_STATUS.internal).toBe(500);
  });
});

describe("classifyDatabaseError", () => {
  it("maps the Couranr command SQLSTATEs", () => {
    expect(classifyDatabaseError({ code: "CR404" })).toBe("not_found");
    expect(classifyDatabaseError({ code: "CR409" })).toBe("version_conflict");
    expect(classifyDatabaseError({ code: "42501" })).toBe("not_permitted");
  });

  /**
   * CR422 means the SERVER passed itself an inconsistent quote. Reporting that
   * as `invalid_input` would blame the merchant for our bug and invite them to
   * "fix" input that is already correct.
   */
  it("treats a quote-integrity failure as internal, not as user input", () => {
    expect(classifyDatabaseError({ code: "CR422" })).toBe("internal");
  });

  it("collapses every other database error to internal", () => {
    for (const code of ["23505", "23503", "23514", "42P01", "40001", "", undefined]) {
      expect(classifyDatabaseError({ code, message: 'constraint "x_pkey"' })).toBe("internal");
    }
    expect(classifyDatabaseError(null)).toBe("internal");
  });
});

describe("canonical routes cannot leak a database detail", () => {
  it("covers every canonical route", () => {
    expect(ROUTES.map(rel).sort()).toEqual([
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

  for (const file of ROUTES) {
    const src = readFileSync(file, "utf8");

    it(`${rel(file)} builds every failure through the shared helper`, () => {
      // No route may hand-roll an error body: that is how a `details:
      // error.message` creeps back in.
      const jsonCalls = src.match(/NextResponse\.json\(/g) || [];
      const errorBodies = src.match(/NextResponse\.json\(\s*\{\s*error:/g) || [];
      expect(errorBodies, `${rel(file)} hand-rolls an error body`).toHaveLength(0);
      // Every route returns at least one success body.
      expect(jsonCalls.length).toBeGreaterThan(0);
    });

    it(`${rel(file)} forwards no driver field`, () => {
      for (const rx of [
        /result\.details/,
        /error\.message/,
        /\.details\b(?!\s*\?)/,
        /result\.error\b/,
        /\berror\.code\b/,
        /\bhint\b/,
        /\bsqlstate\b/i,
        /\bstack\b/,
      ]) {
        expect(rx.test(src), `${rel(file)} matches ${rx}`).toBe(false);
      }
    });
  }
});

/**
 * The command layer is the only place a driver error is seen at all, and it
 * must log rather than return it.
 */
describe("the command layer logs driver detail instead of returning it", () => {
  const commands = readFileSync(path.join(ROOT, "lib/couranr/requests/commands.ts"), "utf8");
  const code = commands.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("routes every failure through fail(), which logs", () => {
    // Every construction of a CommandFailure goes through fail(); a literal
    // `ok: false` anywhere else would bypass the correlation id and the log.
    // A comma, not a semicolon: this matches object literals only, not the
    // `CommandFailure` type declaration.
    const literals = code.match(/\{\s*ok:\s*false,/g) || [];
    // Exactly one: the object fail() itself builds.
    expect(literals.length).toBe(1);
    expect(code).toMatch(/logServerFailure\(/);
  });

  it("passes the driver message only into the log, never into the result", () => {
    // `detail:` is the log-only field on fail(). `details:` is the caller-safe
    // one and must never be handed a driver message.
    expect(code).toMatch(/detail: \{ fn, code: error\.code, message: error\.message \}/);
    expect(code).not.toMatch(/details: error/);
    expect(code).not.toMatch(/details: \[error/);
  });

  it("gives every failure a correlation id", () => {
    expect(code).toMatch(/const correlationId = newCorrelationId\(\)/);
    expect(code).toMatch(/correlationId,/);
  });
});
