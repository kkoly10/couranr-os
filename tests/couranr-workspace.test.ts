import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUSINESS_CATEGORIES,
  POLICIES_VERSION,
  isWorkspaceFailure,
  normalizeWorkspaceInput,
  toSlugBase,
} from "@/lib/couranr/onboarding/workspace";

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.resolve(ROOT, "supabase/migrations");
// Rollbacks moved out of supabase/migrations/: the Supabase CLI treats any
// <timestamp>_name.sql there as a migration to APPLY, rollbacks included.
const ROLLBACKS_DIR = path.resolve(MIGRATIONS, "../rollbacks");
const MIG_NAME = readdirSync(MIGRATIONS).filter((f) =>
  f.endsWith("_couranr_merchant_workspace.sql")
)[0];
const SQL = readFileSync(path.join(MIGRATIONS, MIG_NAME), "utf8").replace(/^\s*--.*$/gm, "");

const VALID = {
  name: "Bright Cleaners",
  businessCategory: "dry_cleaning_laundry_tailoring",
  pickupAddress: { line1: "10 Market St", city: "Stafford", region: "VA", postalCode: "22554" },
  contactPhone: "540-555-0100",
  payerDefault: "merchant",
  policiesAccepted: true,
};

function codes(raw: unknown): string[] {
  const r = normalizeWorkspaceInput(raw);
  return isWorkspaceFailure(r) ? r.errors.map((e) => e.code) : [];
}

describe("merchant categories", () => {
  /**
   * The TypeScript list and the database CHECK are two enforcement points for
   * one Master Package registry. If they drift, onboarding builds a payload the
   * database then rejects at runtime.
   */
  it("match the database CHECK constraint exactly", () => {
    const start = SQL.indexOf("couranr_mw_category_chk");
    expect(start, "category constraint missing").toBeGreaterThan(-1);
    const chunk = SQL.slice(start, SQL.indexOf("))", start) + 2);
    const inSql = (chunk.match(/'([a-z_]+)'/g) || []).map((s) => s.slice(1, -1));
    expect(inSql.sort()).toEqual(BUSINESS_CATEGORIES.map((c) => c.value).sort());
  });

  it("are the eleven from the Master Package registry", () => {
    expect(BUSINESS_CATEGORIES).toHaveLength(11);
    expect(BUSINESS_CATEGORIES.map((c) => c.value)).toContain("general_local_business");
    // Every one has a human label, so no raw machine code reaches a merchant.
    for (const c of BUSINESS_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(3);
      expect(c.label).not.toMatch(/_/);
    }
  });
});

describe("toSlugBase", () => {
  it("produces a safe slug", () => {
    expect(toSlugBase("Bright Cleaners")).toBe("bright-cleaners");
    expect(toSlugBase("  Ed's Bakery & Café!  ")).toBe("ed-s-bakery-caf");
    expect(toSlugBase("A/B\\C")).toBe("a-b-c");
  });

  it("never emits a leading or trailing hyphen, even after truncation", () => {
    // 40 chars would land mid-separator without the second trim.
    const awkward = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa - tail";
    const slug = toSlugBase(awkward);
    expect(slug).not.toMatch(/^-|-$/);
    expect(slug.length).toBeLessThanOrEqual(40);
  });

  it("falls back rather than emitting an empty slug", () => {
    expect(toSlugBase("!!!")).toBe("business");
    expect(toSlugBase("")).toBe("business");
    expect(toSlugBase("   ")).toBe("business");
  });

  it("emits only characters that are safe in a URL path segment", () => {
    for (const name of ["Ünïcodé Store", "80's Vinyl", "A  B", "—dash—"]) {
      expect(toSlugBase(name)).toMatch(/^[a-z0-9-]+$/);
    }
  });
});

describe("workspace input normalization", () => {
  it("accepts a complete signup", () => {
    const r = normalizeWorkspaceInput(VALID);
    expect(isWorkspaceFailure(r)).toBe(false);
    if (isWorkspaceFailure(r)) return;
    expect(r.value.name).toBe("Bright Cleaners");
    expect(r.value.slugBase).toBe("bright-cleaners");
    expect(r.value.payerDefault).toBe("merchant");
  });

  /**
   * The policy version is stated by the SERVER. A merchant cannot claim to have
   * accepted a version that was never shown to them.
   */
  it("ignores any client-supplied policy version", () => {
    const r = normalizeWorkspaceInput({ ...VALID, policiesVersion: "anything-i-like" });
    expect(isWorkspaceFailure(r)).toBe(false);
    if (isWorkspaceFailure(r)) return;
    expect(r.value.policiesVersion).toBe(POLICIES_VERSION);
  });

  it("requires an explicit acceptance", () => {
    expect(codes({ ...VALID, policiesAccepted: false })).toContain("policies_not_accepted");
    const { policiesAccepted, ...without } = VALID;
    expect(codes(without)).toContain("policies_not_accepted");
  });

  it("refuses a payload carrying a money field", () => {
    expect(codes({ ...VALID, totalCents: 1 })).toEqual(["client_supplied_amount"]);
    expect(codes({ ...VALID, pickupAddress: { ...VALID.pickupAddress, price: 5 } })).toEqual([
      "client_supplied_amount",
    ]);
  });

  it("rejects an unknown category rather than defaulting", () => {
    expect(codes({ ...VALID, businessCategory: "crypto_mining" })).toContain(
      "unknown_business_category"
    );
    const { businessCategory, ...without } = VALID;
    expect(codes(without)).toContain("unknown_business_category");
  });

  it("requires a complete pickup address", () => {
    expect(codes({ ...VALID, pickupAddress: { line1: "10 Market St" } })).toContain(
      "invalid_pickup_address"
    );
    expect(codes({ ...VALID, pickupAddress: "10 Market St" })).toContain(
      "invalid_pickup_address"
    );
  });

  it("validates the phone loosely but not vacuously", () => {
    expect(codes({ ...VALID, contactPhone: "(540) 555-0100" })).toEqual([]);
    expect(codes({ ...VALID, contactPhone: "+1 540 555 0100" })).toEqual([]);
    expect(codes({ ...VALID, contactPhone: "555" })).toContain("contact_phone_invalid");
    expect(codes({ ...VALID, contactPhone: "" })).toContain("contact_phone_required");
  });

  it("rejects an unknown payer default", () => {
    expect(codes({ ...VALID, payerDefault: "couranr" })).toContain("unknown_payer_default");
  });

  it("has no owner field for a client to set", () => {
    const r = normalizeWorkspaceInput({ ...VALID, ownerUserId: "somebody-else" });
    expect(isWorkspaceFailure(r)).toBe(false);
    if (isWorkspaceFailure(r)) return;
    expect(Object.keys(r.value)).not.toContain("ownerUserId");
    expect(JSON.stringify(r.value)).not.toContain("somebody-else");
  });
});

describe("workspace migration", () => {
  it("is the version applied to production", () => {
    expect(MIG_NAME).toBe("20260731061356_couranr_merchant_workspace.sql");
  });

  it("creates one table and one function, and alters nothing", () => {
    expect((SQL.match(/create table public\.\w+/g) || []).length).toBe(1);
    expect((SQL.match(/create function public\.\w+/g) || []).length).toBe(1);
    for (const rx of [
      /\balter\s+table\s+public\.business_accounts/i,
      /\balter\s+table\s+public\.business_members/i,
      /\bdrop\s+table\b/i,
      /\bdrop\s+column\b/i,
      /\bdelete\s+from\b/i,
      /\bcreate\s+policy\b/i,
      /(^|;)\s*truncate\s+/i,
    ]) {
      expect(rx.test(SQL), `migration matches ${rx}`).toBe(false);
    }
    // The only ALTER is enabling RLS on the new table.
    const alters = SQL.match(/alter table [\w.]+/gi) || [];
    expect(alters).toEqual(["alter table public.couranr_merchant_workspaces"]);
  });

  it("is SECURITY INVOKER with a pinned search_path", () => {
    expect(SQL).toMatch(/language plpgsql\s+security invoker/);
    expect(/security\s+definer/i.test(SQL)).toBe(false);
    expect(SQL).toMatch(/set search_path = ''/);
  });

  it("revokes EXECUTE broadly, then grants only service_role", () => {
    expect(SQL).toMatch(
      /revoke all on function public\.couranr_create_merchant_workspace[\s\S]*?from public, anon, authenticated, service_role;/
    );
    expect(SQL).toMatch(
      /grant execute on function public\.couranr_create_merchant_workspace[\s\S]*?to service_role;/
    );
    expect(SQL).toMatch(
      /revoke all on public\.couranr_merchant_workspaces from public, anon, authenticated;/
    );
    expect(SQL).toMatch(/grant select, insert, update on public\.couranr_merchant_workspaces to service_role;/);
    expect(/\bto\s+(anon|authenticated)\b/i.test(SQL)).toBe(false);
  });

  it("enables RLS and creates no policy", () => {
    expect(SQL).toMatch(/enable row level security/);
    expect(/create policy/i.test(SQL)).toBe(false);
  });

  it("makes the creator an active owner, with no owner parameter to override it", () => {
    expect(SQL).toMatch(/'owner', 'active'/);
    // The only user id in scope is the authenticated caller.
    expect(SQL).not.toMatch(/p_role\b/);
    expect(SQL).not.toMatch(/p_status\b/);
    expect(SQL).not.toMatch(/p_member_user_id/);
    expect((SQL.match(/p_owner_user_id/g) || []).length).toBeGreaterThan(3);
  });

  it("refuses an Operations owner in the database, not only in TypeScript", () => {
    expect(SQL).toMatch(/'admin', 'operations'/);
    expect(SQL).toMatch(/errcode = 'CR403'/);
  });

  it("serializes concurrent attempts on the idempotency key", () => {
    expect(SQL).toMatch(/pg_advisory_xact_lock/);
    expect(SQL).toMatch(/couranr_mw_idempotency_uniq unique \(created_by, idempotency_key\)/);
  });

  it("resolves slug collisions against the unique index, not a prior read", () => {
    expect(SQL).toMatch(/exception when unique_violation/);
    expect(SQL).toMatch(/gen_random_uuid\(\)::text/);
  });

  it("has a rollback that drops only the new objects", () => {
    const rollback = readFileSync(
      path.join(ROLLBACKS_DIR, "20260731061356_couranr_merchant_workspace.rollback.sql"),
      "utf8"
    ).replace(/^\s*--.*$/gm, "");
    expect(rollback).toMatch(/drop function if exists public\.couranr_create_merchant_workspace/);
    expect(rollback).toMatch(/drop table if exists public\.couranr_merchant_workspaces/);
    // The rollback MENTIONS those tables, in a `raise notice` warning that
    // their rows are deliberately left behind. What it must not do is touch
    // them, so assert on statements rather than on the word.
    expect(/(drop|alter|delete\s+from|truncate|update)\s+(table\s+)?(if\s+exists\s+)?public\.business_/i.test(rollback)).toBe(false);
    expect(/delete\s+from/i.test(rollback)).toBe(false);
    expect(rollback).toMatch(/are NOT removed/);
  });
});

describe("the onboarding command", () => {
  const cmd = readFileSync(path.join(ROOT, "lib/couranr/onboarding/commands.ts"), "utf8");
  const code = cmd.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const route = readFileSync(path.join(ROOT, "app/api/couranr/me/workspace/route.ts"), "utf8");

  it("derives the owner from the verified token, never from the body", () => {
    expect(route).toMatch(/const user = await resolveUserId\(req\)/);
    expect(route).toMatch(/ownerUserId: user\.userId/);
    // No route may read an owner from the payload.
    expect(route).not.toMatch(/body\??\.\w*[Oo]wner/);
    expect(route).not.toMatch(/body\??\.\w*[Uu]serId/);
  });

  it("goes through one rpc call and performs no direct insert", () => {
    expect((code.match(/supabaseAdmin\.rpc\(/g) || []).length).toBe(1);
    expect(code).not.toMatch(/\.insert\(/);
    expect(code).not.toMatch(/\.update\(/);
    expect(code).not.toMatch(/from\("business_accounts"\)/);
    expect(code).not.toMatch(/from\("business_members"\)/);
  });

  it("blocks Operations owners before calling the database too", () => {
    expect(code).toMatch(/OPERATIONS_PROFILE_ROLES/);
    // Only `admin` exists: profiles_role_check permits customer, driver, admin.
    expect(code).toMatch(/OPERATIONS_PROFILE_ROLES = \["admin"\]/);
  });

  it("returns no raw driver detail", () => {
    expect(code).toMatch(/logServerFailure\(/);
    expect(code).not.toMatch(/details: error/);
    expect(route).not.toMatch(/error\.message/);
  });
});
