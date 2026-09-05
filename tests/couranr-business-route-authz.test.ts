import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import {
  requireBusinessCapability,
  type ActorResolution,
} from "@/lib/couranr/requests/actor";
import type { MemberRole, MemberStatus, RequestActor } from "@/lib/couranr/requests/permissions";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const BIZ = "00000000-0000-4000-8000-0000000b0001";
const OTHER_BIZ = "00000000-0000-4000-8000-0000000b0002";
const USER = "00000000-0000-4000-8000-00000000a001";
const SESSION = "00000000-0000-4000-8000-00000000e001";

function memberActor(role: MemberRole, status: MemberStatus = "active", biz = BIZ): RequestActor {
  return { kind: "member", userId: USER, membership: { businessAccountId: biz, userId: USER, role, status } };
}
const nonMemberActor: RequestActor = { kind: "member", userId: USER, membership: null };
const operationsActor: RequestActor = { kind: "operations", userId: USER };

// Partial-mock the actor module so the REAL requireBusinessCapability / isActorDenied
// run against a controlled resolveRequestActor. (Mocking the whole module would
// stub out the very gate under test.)
const resolveRequestActor = vi.fn<[], Promise<ActorResolution>>();
vi.mock("@/lib/couranr/requests/actor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/couranr/requests/actor")>();
  return { ...actual, resolveRequestActor: (...args: any[]) => resolveRequestActor(...args) };
});

// Spy the paid Google budget claim so we can prove a refused caller never reaches spend.
const claimPaidApiCall = vi.fn(async () => ({ allowed: false as const, reason: "test_budget_off" }));
vi.mock("@/lib/couranr/providers/paidApiGuard", () => ({
  claimPaidApiCall: (...a: any[]) => claimPaidApiCall(...a),
}));

const asResolution = (actor: RequestActor): ActorResolution => ({ ok: true, actor, userId: USER });

beforeEach(() => {
  resolveRequestActor.mockReset();
  claimPaidApiCall.mockClear();
});

describe("requireBusinessCapability — the gate that replaces the dead anonymous check", () => {
  it("REJECTS a signed-in non-member (membership: null) — the exact attacker", () => {
    for (const cap of ["read", "create"] as const) {
      const denied = requireBusinessCapability(nonMemberActor, cap, BIZ);
      expect(denied, cap).not.toBeNull();
      expect(denied?.code).toBe("not_permitted");
    }
  });

  it("REJECTS a member of a different business and an inactive member", () => {
    expect(requireBusinessCapability(memberActor("owner", "active", OTHER_BIZ), "create", BIZ)).not.toBeNull();
    expect(requireBusinessCapability(memberActor("owner", "invited"), "create", BIZ)).not.toBeNull();
    expect(requireBusinessCapability(memberActor("owner", "disabled"), "read", BIZ)).not.toBeNull();
  });

  it("ALLOWS active create-roles for create and any active member for read", () => {
    for (const role of ["owner", "manager", "dispatcher"] as const) {
      expect(requireBusinessCapability(memberActor(role), "create", BIZ), role).toBeNull();
    }
    for (const role of ["owner", "manager", "dispatcher", "viewer", "billing"] as const) {
      expect(requireBusinessCapability(memberActor(role), "read", BIZ), role).toBeNull();
    }
  });

  it("DENIES viewer/billing create (least privilege) and operations create; allows operations read", () => {
    expect(requireBusinessCapability(memberActor("viewer"), "create", BIZ)).not.toBeNull();
    expect(requireBusinessCapability(memberActor("billing"), "create", BIZ)).not.toBeNull();
    expect(requireBusinessCapability(operationsActor, "create", BIZ)).not.toBeNull();
    expect(requireBusinessCapability(operationsActor, "read", BIZ)).toBeNull();
  });
});

describe("merchant/places route refuses a non-member BEFORE any paid Google call", () => {
  it("GET autocomplete: non-member → 403 and claimPaidApiCall NEVER called", async () => {
    const { GET } = await import("@/app/api/couranr/merchant/places/route");
    resolveRequestActor.mockResolvedValue(asResolution(nonMemberActor));
    const res = await GET(
      new NextRequest(`http://localhost/api/couranr/merchant/places?businessAccountId=${BIZ}&query=coffee`)
    );
    expect(res.status).toBe(403);
    expect(claimPaidApiCall).not.toHaveBeenCalled();
  });

  it("GET autocomplete: active owner passes the gate and reaches the budget claim", async () => {
    const prev = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    process.env.GOOGLE_MAPS_SERVER_API_KEY = "test-key"; // let the handler reach the budget claim
    try {
      const { GET } = await import("@/app/api/couranr/merchant/places/route");
      resolveRequestActor.mockResolvedValue(asResolution(memberActor("owner")));
      const res = await GET(
        new NextRequest(`http://localhost/api/couranr/merchant/places?businessAccountId=${BIZ}&query=coffee`)
      );
      // Gate passed → claimPaidApiCall reached (mocked to deny budget → empty suggestions, no fetch).
      expect(claimPaidApiCall).toHaveBeenCalledWith("google_places_autocomplete");
      expect(res.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
      else process.env.GOOGLE_MAPS_SERVER_API_KEY = prev;
    }
  });

  it("GET autocomplete: active viewer (non-create role) → 403, no paid call", async () => {
    const { GET } = await import("@/app/api/couranr/merchant/places/route");
    resolveRequestActor.mockResolvedValue(asResolution(memberActor("viewer")));
    const res = await GET(
      new NextRequest(`http://localhost/api/couranr/merchant/places?businessAccountId=${BIZ}&query=coffee`)
    );
    expect(res.status).toBe(403);
    expect(claimPaidApiCall).not.toHaveBeenCalled();
  });
});

describe("intake routes refuse a non-member", () => {
  it("POST /api/couranr/intake → 403 for a non-member", async () => {
    const { POST } = await import("@/app/api/couranr/intake/route");
    resolveRequestActor.mockResolvedValue(asResolution(nonMemberActor));
    const res = await POST(
      new NextRequest("http://localhost/api/couranr/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessAccountId: BIZ, description: "a box of mugs to 123 Main St" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("POST /api/couranr/intake/[id] → 403 for a non-member", async () => {
    const { POST } = await import("@/app/api/couranr/intake/[id]/route");
    resolveRequestActor.mockResolvedValue(asResolution(nonMemberActor));
    const res = await POST(
      new NextRequest(`http://localhost/api/couranr/intake/${SESSION}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessAccountId: BIZ, action: "interpret" }),
      }),
      { params: Promise.resolve({ id: SESSION }) }
    );
    expect(res.status).toBe(403);
  });

  it("GET /api/couranr/intake/[id] → 403 for a non-member (previously ungated)", async () => {
    const { GET } = await import("@/app/api/couranr/intake/[id]/route");
    resolveRequestActor.mockResolvedValue(asResolution(nonMemberActor));
    const res = await GET(
      new NextRequest(`http://localhost/api/couranr/intake/${SESSION}?businessAccountId=${BIZ}`),
      { params: Promise.resolve({ id: SESSION }) }
    );
    expect(res.status).toBe(403);
  });
});

describe("the dead-check pattern cannot silently return", () => {
  it("resolveRequestActor never returns kind: 'anonymous' (so an anonymous check is dead)", () => {
    const src = read("lib/couranr/requests/actor.ts");
    const fn = src.slice(src.indexOf("export async function resolveRequestActor"));
    expect(fn).not.toContain('kind: "anonymous"');
  });

  it("the four business routes gate via requireBusinessCapability, not a bare anonymous check", () => {
    for (const p of [
      "app/api/couranr/merchant/places/route.ts",
      "app/api/couranr/intake/route.ts",
      "app/api/couranr/intake/[id]/route.ts",
    ]) {
      const src = read(p);
      expect(src, p).toContain("requireBusinessCapability");
      // the only remaining "anonymous" mention may appear in a comment, never as a gate expression
      expect(src, p).not.toMatch(/if\s*\(\s*[A-Za-z0-9_.]*\.kind\s*===\s*["']anonymous["']\s*\)/);
    }
  });
});
