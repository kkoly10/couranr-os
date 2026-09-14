import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The resolver is the structural defence against mailing the wrong party, so
 * these tests drive the REAL function against a stubbed Supabase client rather
 * than asserting on its source. The one source-level test at the bottom is the
 * negative list, which is a property of the file and cannot be observed by
 * calling it.
 *
 * Why the defence needs to be runtime rather than a type: this repo compiles
 * with "strict": false against row types of Record<string, any>, so a branded
 * string is inert and `{ to: row.recipient_email }` — the CONSUMER's address,
 * sitting on the very row a merchant command already loaded — type-checks
 * clean.
 */

const ROOT = path.resolve(__dirname, "..");

/** Rows the stub returns, and the users the admin API returns for them. */
let members: any[] = [];
let memberError: any = null;
let users: Record<string, any> = {};

vi.mock("@/lib/supabaseAdmin", () => {
  const builder = () => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      /* The real client resolves on await; mimic that rather than a .then chain
         so the resolver's actual call shape is exercised. */
      order: () => chain,
      then: (resolve: any) => resolve({ data: members, error: memberError }),
    };
    return chain;
  };
  return {
    supabaseAdmin: {
      from: builder,
      auth: {
        admin: {
          getUserById: async (id: string) => ({
            data: { user: users[id] ?? null },
            error: null,
          }),
        },
      },
    },
  };
});

const { resolveMerchantNotificationAddress } = await import(
  "@/lib/couranr/email/recipients"
);

const ACCOUNT = "22af5caa-2254-4b07-b442-13a1210ea4d0";

beforeEach(() => {
  members = [];
  memberError = null;
  users = {};
  // The resolver logs its failure arms; keep the suite output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveMerchantNotificationAddress — the happy path", () => {
  it("returns the active owner's signup address, tagged with its source", async () => {
    members = [{ user_id: "u1", created_at: "2026-01-01T00:00:00Z", id: "m1" }];
    users.u1 = { email: "owner@example.com" };

    const got = await resolveMerchantNotificationAddress(ACCOUNT);

    expect(got).toEqual({
      audience: "merchant",
      businessAccountId: ACCOUNT,
      address: "owner@example.com",
      source: "owner_login_email",
    });
  });

  it("always carries the merchant audience discriminant", async () => {
    // The sender refuses a recipient whose audience does not match the
    // template's, so this field is the defence, not decoration.
    members = [{ user_id: "u1", created_at: "2026-01-01T00:00:00Z", id: "m1" }];
    users.u1 = { email: "owner@example.com" };
    const got = await resolveMerchantNotificationAddress(ACCOUNT);
    expect(got.audience).toBe("merchant");
  });
});

describe("every failure arm is stated, never silently skipped", () => {
  it("no members at all -> no_active_owner", async () => {
    members = [];
    expect(await resolveMerchantNotificationAddress(ACCOUNT)).toEqual({
      audience: "none",
      businessAccountId: ACCOUNT,
      reason: "no_active_owner",
    });
  });

  it("a query error -> no_active_owner, never a throw", async () => {
    memberError = { message: "connection reset" };
    const got = await resolveMerchantNotificationAddress(ACCOUNT);
    expect(got).toMatchObject({ audience: "none", reason: "no_active_owner" });
  });

  it("owner SOFT-deleted -> not mailed", async () => {
    // deleted_at does NOT cascade, so the member row survives a soft delete and
    // a naive query would mail a deactivated account.
    members = [{ user_id: "u1", created_at: "2026-01-01T00:00:00Z", id: "m1" }];
    users.u1 = { email: "gone@example.com", deleted_at: "2026-05-01T00:00:00Z" };
    expect(await resolveMerchantNotificationAddress(ACCOUNT)).toMatchObject({
      audience: "none",
      reason: "owner_has_no_email",
    });
  });

  it("owner banned into the future -> not mailed", async () => {
    members = [{ user_id: "u1", created_at: "2026-01-01T00:00:00Z", id: "m1" }];
    users.u1 = { email: "banned@example.com", banned_until: "2999-01-01T00:00:00Z" };
    expect(await resolveMerchantNotificationAddress(ACCOUNT)).toMatchObject({
      audience: "none",
      reason: "owner_has_no_email",
    });
  });

  it("a ban that has EXPIRED does not exclude the owner", async () => {
    members = [{ user_id: "u1", created_at: "2026-01-01T00:00:00Z", id: "m1" }];
    users.u1 = { email: "reinstated@example.com", banned_until: "2020-01-01T00:00:00Z" };
    expect(await resolveMerchantNotificationAddress(ACCOUNT)).toMatchObject({
      audience: "merchant",
      address: "reinstated@example.com",
    });
  });

  it("owner with a null email -> owner_has_no_email, never invited_email", async () => {
    // auth.users.email is NULLABLE — a phone-only or anonymous signup has none.
    members = [{ user_id: "u1", created_at: "2026-01-01T00:00:00Z", id: "m1" }];
    users.u1 = { email: null };
    expect(await resolveMerchantNotificationAddress(ACCOUNT)).toMatchObject({
      audience: "none",
      reason: "owner_has_no_email",
    });
  });

  it("a malformed stored address is refused, not passed to the sender", async () => {
    members = [{ user_id: "u1", created_at: "2026-01-01T00:00:00Z", id: "m1" }];
    users.u1 = { email: "not-an-address" };
    expect(await resolveMerchantNotificationAddress(ACCOUNT)).toMatchObject({
      audience: "none",
      reason: "address_malformed",
    });
  });

  it("skips an unusable owner and uses the next usable one", async () => {
    members = [
      { user_id: "u1", created_at: "2026-01-01T00:00:00Z", id: "m1" },
      { user_id: "u2", created_at: "2026-02-01T00:00:00Z", id: "m2" },
    ];
    users.u1 = { email: "soft@example.com", deleted_at: "2026-05-01T00:00:00Z" };
    users.u2 = { email: "usable@example.com" };
    expect(await resolveMerchantNotificationAddress(ACCOUNT)).toMatchObject({
      audience: "merchant",
      address: "usable@example.com",
    });
  });

  it("never throws, whatever the admin API does", async () => {
    members = [{ user_id: "u1", created_at: "2026-01-01T00:00:00Z", id: "m1" }];
    // getUserById rejecting must not propagate — a send failure may never fail
    // the business operation that already committed.
    const mod: any = await import("@/lib/supabaseAdmin");
    mod.supabaseAdmin.auth.admin.getUserById = async () => {
      throw new Error("network");
    };
    await expect(resolveMerchantNotificationAddress(ACCOUNT)).resolves.toMatchObject({
      audience: "none",
    });
  });
});

describe("the negative list is enforced on the source, not just documented", () => {
  const SRC = readFileSync(path.join(ROOT, "lib/couranr/email/recipients.ts"), "utf8");

  /**
   * The house pattern: tracking/projection.ts keeps a forbidden-substring list
   * enforced by tests/couranr-tracking.test.ts, for this exact field. Same idea
   * — the comment says never read these, and this is what makes the comment
   * load-bearing.
   */
  it("reads none of the wrong email columns in its executable code", () => {
    const code = SRC
      // Strip block and line comments; the negative list NAMES these fields,
      // so a naive grep over the whole file would always fail.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

    for (const forbidden of [
      "recipient_email",
      "recipientEmail",
      "invited_email",
      "billing_email",
      "merchant_customers",
      "normalized_email",
    ]) {
      expect(code, `${forbidden} must never be read for a merchant send`).not.toContain(
        forbidden
      );
    }
  });

  it("orders by created_at and not the nullable joined_at", () => {
    // joined_at is NULLABLE and Postgres sorts NULLS LAST under ASC, so it is
    // not a total order and the recipient would be nondeterministic.
    expect(SRC).toContain('.order("created_at"');
    expect(SRC.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain('.order("joined_at"');
  });

  it("uses the sender's own address check rather than a second regex", () => {
    expect(SRC).toContain('import { looksLikeAnAddress } from "./send"');
    // A second regex here is how a resolver comes to accept a shape the sender
    // then refuses.
    expect(SRC.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\/\^.*@.*\//);
  });
});
