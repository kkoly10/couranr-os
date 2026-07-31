import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canActOnDeliveryRequest,
  type MemberRole,
  type MemberStatus,
  type RequestActor,
} from "@/lib/couranr/requests/permissions";

const BIZ = "00000000-0000-4000-8000-0000000b0001";
const OTHER_BIZ = "00000000-0000-4000-8000-0000000b0002";
const USER = "00000000-0000-4000-8000-00000000a001";

function member(role: MemberRole, status: MemberStatus = "active", biz = BIZ): RequestActor {
  return {
    kind: "member",
    userId: USER,
    membership: { businessAccountId: biz, userId: USER, role, status },
  };
}

/** DRP-001. Bounds TRM-002 for this slice only. */
describe("DRP-001 delivery-request permission matrix", () => {
  const WRITE_ALLOWED: MemberRole[] = ["owner", "manager", "dispatcher"];
  const WRITE_DENIED: MemberRole[] = ["viewer", "billing"];

  for (const role of WRITE_ALLOWED) {
    it(`active ${role} may create and submit`, () => {
      for (const cap of ["create", "submit"] as const) {
        const d = canActOnDeliveryRequest(member(role), cap, BIZ);
        expect(d.allowed, `${role} ${cap}`).toBe(true);
        expect(d.reason).toBe("ok");
      }
    });
  }

  for (const role of WRITE_DENIED) {
    it(`active ${role} may NOT create or submit`, () => {
      for (const cap of ["create", "submit"] as const) {
        const d = canActOnDeliveryRequest(member(role), cap, BIZ);
        expect(d.allowed, `${role} ${cap}`).toBe(false);
        expect(d.reason).toBe("role_may_not_write");
      }
    });

    it(`active ${role} may still read`, () => {
      expect(canActOnDeliveryRequest(member(role), "read", BIZ).allowed).toBe(true);
    });
  }

  it("denies an invited member every capability", () => {
    for (const cap of ["create", "submit", "read", "review"] as const) {
      const d = canActOnDeliveryRequest(member("manager", "invited"), cap, BIZ);
      expect(d.allowed, cap).toBe(false);
    }
    expect(canActOnDeliveryRequest(member("manager", "invited"), "create", BIZ).reason).toBe(
      "membership_not_active"
    );
  });

  it("denies a disabled member every capability", () => {
    for (const cap of ["create", "submit", "read", "review"] as const) {
      expect(canActOnDeliveryRequest(member("owner", "disabled"), cap, BIZ).allowed, cap).toBe(
        false
      );
    }
  });

  it("denies a member of another business", () => {
    const d = canActOnDeliveryRequest(member("owner", "active", OTHER_BIZ), "create", BIZ);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("wrong_business");
  });

  it("denies a user with no membership row", () => {
    const d = canActOnDeliveryRequest(
      { kind: "member", userId: USER, membership: null },
      "read",
      BIZ
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("not_a_member");
  });

  it("denies an anonymous caller everything", () => {
    for (const cap of ["create", "submit", "read", "review"] as const) {
      const d = canActOnDeliveryRequest({ kind: "anonymous" }, cap, BIZ);
      expect(d.allowed, cap).toBe(false);
      expect(d.reason).toBe("anonymous");
    }
  });

  it("lets Couranr Operations read and review across businesses", () => {
    const ops: RequestActor = { kind: "operations", userId: "ops-1" };
    expect(canActOnDeliveryRequest(ops, "read", BIZ).allowed).toBe(true);
    expect(canActOnDeliveryRequest(ops, "review", BIZ).allowed).toBe(true);
    expect(canActOnDeliveryRequest(ops, "read", OTHER_BIZ).allowed).toBe(true);
  });

  it("does NOT let Operations create or submit on a merchant's behalf", () => {
    const ops: RequestActor = { kind: "operations", userId: "ops-1" };
    expect(canActOnDeliveryRequest(ops, "create", BIZ).allowed).toBe(false);
    expect(canActOnDeliveryRequest(ops, "submit", BIZ).allowed).toBe(false);
  });

  it("does not let any merchant role review", () => {
    for (const role of [...WRITE_ALLOWED, ...WRITE_DENIED]) {
      const d = canActOnDeliveryRequest(member(role), "review", BIZ);
      expect(d.allowed, role).toBe(false);
      expect(d.reason).toBe("role_may_not_review");
    }
  });

  /** A membership whose user_id does not match the actor must never match. */
  it("rejects a membership belonging to a different user", () => {
    const d = canActOnDeliveryRequest(
      {
        kind: "member",
        userId: USER,
        membership: {
          businessAccountId: BIZ,
          userId: "someone-else",
          role: "owner",
          status: "active",
        },
      },
      "create",
      BIZ
    );
    expect(d.allowed).toBe(false);
  });

  it("never matches on absent identifiers", () => {
    const d = canActOnDeliveryRequest(
      {
        kind: "member",
        userId: "",
        membership: { businessAccountId: "", userId: "", role: "owner", status: "active" },
      },
      "create",
      ""
    );
    expect(d.allowed).toBe(false);
  });
});

/* ---------------------------------------------------- migration SQL scope */

describe("migration is additive and correctly scoped", () => {
  const DIR = path.resolve(__dirname, "../supabase/migrations");
  // Resolved by discovery, not by a hard-coded name: `apply_migration` assigns
  // its own timestamp version, so the file was renamed to match production.
  const NAMES = readdirSync(DIR).filter((f) => f.endsWith("_couranr_delivery_requests.sql"));
  const ROLLBACK_NAMES = readdirSync(DIR).filter((f) =>
    f.endsWith("_couranr_delivery_requests.rollback.sql")
  );
  const MIG = path.join(DIR, NAMES[0] ?? "missing.sql");
  const ROLLBACK = path.join(DIR, ROLLBACK_NAMES[0] ?? "missing.sql");

  it("ships exactly one migration and one rollback, sharing a version", () => {
    expect(NAMES).toHaveLength(1);
    expect(ROLLBACK_NAMES).toHaveLength(1);
    const version = (f: string) => f.split("_")[0];
    expect(version(NAMES[0])).toBe(version(ROLLBACK_NAMES[0]));
    // The version Supabase assigned when the migration was applied to
    // production. The filename is the only place the repo records it.
    expect(version(NAMES[0])).toBe("20260731045417");
  });

  /** Comments legitimately discuss what the migration must not do. */
  function code(p: string) {
    return readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*--.*$/gm, "");
  }

  const SQL = code(MIG);
  const ROLL = code(ROLLBACK);

  /** TRUNCATE in statement position only. No /g — `.test` must not be stateful. */
  const TRUNCATE_STATEMENT = /(^|;)\s*truncate\s+/i;

  it("contains no destructive statement", () => {
    for (const rx of [
      /\bdrop\s+table\b/i,
      /\bdrop\s+column\b/i,
      /\bdelete\s+from\b/i,
      /\bdrop\s+policy\b/i,
      // TRUNCATE as a STATEMENT. Matching the bare word would flag
      // `revoke ... truncate ... from service_role`, which is the opposite of
      // destructive: it removes the ability to truncate.
      TRUNCATE_STATEMENT,
    ]) {
      expect(rx.test(SQL), `migration must not contain ${rx}`).toBe(false);
    }
  });

  /**
   * The narrowed TRUNCATE regex is only trustworthy if it still catches a real
   * truncate. The migration no longer contains the word at all (it revokes ALL
   * rather than naming verbs), so the control cannot come from the file — it is
   * exercised directly here instead.
   */
  it("the narrowed TRUNCATE guard catches a statement and tolerates a revoke", () => {
    expect(TRUNCATE_STATEMENT.test("truncate public.orders;")).toBe(true);
    expect(TRUNCATE_STATEMENT.test("begin;\ntruncate public.orders;")).toBe(true);
    expect(TRUNCATE_STATEMENT.test("select 1; truncate public.orders;")).toBe(true);
    expect(TRUNCATE_STATEMENT.test("revoke truncate on public.x from service_role;")).toBe(false);
  });

  it("alters no pre-existing table", () => {
    const alters = Array.from(SQL.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([\w.]+)/gi)).map(
      (m) => m[1].toLowerCase()
    );
    for (const t of alters) {
      expect(
        t.includes("couranr_delivery_request"),
        `migration alters non-canonical table "${t}"`
      ).toBe(true);
    }
  });

  it("creates exactly the two canonical tables", () => {
    const created = Array.from(
      SQL.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w.]+)/gi)
    ).map((m) => m[1].toLowerCase());
    expect(created.sort()).toEqual([
      "public.couranr_delivery_request_events",
      "public.couranr_delivery_requests",
    ]);
  });

  it("never references a legacy or later-lifecycle table as a write target", () => {
    for (const forbidden of [
      "public.orders",
      "public.deliveries",
      "public.business_jobs",
      "public.doc_requests",
      "public.delivery_admin_events",
    ]) {
      expect(SQL.includes(forbidden), `migration references ${forbidden}`).toBe(false);
    }
  });

  it("enables RLS and creates no policy", () => {
    expect(SQL).toMatch(/enable\s+row\s+level\s+security/i);
    expect(/create\s+policy/i.test(SQL)).toBe(false);
  });

  it("revokes from PUBLIC, anon and authenticated", () => {
    expect(SQL).toMatch(/revoke\s+all\s+on\s+public\.couranr_delivery_requests\s+from\s+public,\s*anon,\s*authenticated/i);
    expect(SQL).toMatch(/revoke\s+all\s+on\s+public\.couranr_delivery_request_events\s+from\s+public,\s*anon,\s*authenticated/i);
  });

  /**
   * The defect the rehearsal caught: this project's pg_default_acl grants ALL
   * to service_role on every new table, so append-only cannot be created by
   * granting a narrow set — the write verbs must be revoked.
   */
  it("revokes ALL from service_role, then grants back exactly what is needed", () => {
    expect(SQL).toMatch(/revoke\s+all\s+on\s+public\.couranr_delivery_requests\s+from\s+service_role/i);
    expect(SQL).toMatch(/revoke\s+all\s+on\s+public\.couranr_delivery_request_events\s+from\s+service_role/i);
    expect(SQL).toMatch(/grant\s+select,\s*insert,\s*update\s+on\s+public\.couranr_delivery_requests\s+to\s+service_role/i);
    expect(SQL).toMatch(/grant\s+select,\s*insert\s+on\s+public\.couranr_delivery_request_events\s+to\s+service_role/i);
    // Never grant a write verb the commands do not need.
    expect(/grant[^;]*\b(delete|truncate|references|trigger|maintain)\b[^;]*to\s+service_role/i.test(SQL)).toBe(false);
  });

  it("aborts rather than silently accepting an existing table", () => {
    expect(SQL).toMatch(/to_regclass\('public\.couranr_delivery_requests'\)\s+is\s+not\s+null/i);
    expect(SQL).toMatch(/to_regclass\('public\.couranr_delivery_request_events'\)\s+is\s+not\s+null/i);
    expect(SQL).toMatch(/raise\s+exception/i);
  });

  it("forbids persisting a payment amount in this pre-payment slice", () => {
    expect(SQL).toMatch(/couranr_dr_no_payment_due_chk\s+check\s*\(\s*payment_due_cents\s+is\s+null\s*\)/i);
  });

  it("creates no SECURITY DEFINER function", () => {
    expect(/security\s+definer/i.test(SQL)).toBe(false);
  });

  it("uses RESTRICT on every foreign key", () => {
    const fks = SQL.match(/on\s+delete\s+\w+/gi) || [];
    expect(fks.length).toBeGreaterThanOrEqual(3);
    for (const fk of fks) expect(fk.toLowerCase()).toContain("restrict");
  });

  it("rollback drops only the two canonical tables, child first", () => {
    const drops = Array.from(
      ROLL.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?([\w.]+)/gi)
    ).map((m) => m[1].toLowerCase());
    expect(drops).toEqual([
      "public.couranr_delivery_request_events",
      "public.couranr_delivery_requests",
    ]);
    expect(/alter\s+table/i.test(ROLL)).toBe(false);
    expect(/delete\s+from/i.test(ROLL)).toBe(false);
  });

  it("uses canonical STA-001 state values, not invented ones", () => {
    for (const v of [
      "draft",
      "pending_couranr_review",
      "quote_revision_required",
      "not_confirmed",
      "accepted_as_quoted",
      "requoted",
    ]) {
      expect(SQL.includes(`'${v}'`), `missing canonical state ${v}`).toBe(true);
    }
    // 'submitted' is NOT a canonical request state.
    expect(SQL.includes("'submitted'")).toBe(false);
  });
});
