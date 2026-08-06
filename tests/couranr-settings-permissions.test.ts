import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MEMBER_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  SETTINGS_CAPABILITIES,
  capabilityForRoleChange,
  memberMay,
  type SettingsCapability,
} from "@/lib/couranr/settings/permissions";
import { MERCHANT_CONVERSATION_PERMISSIONS } from "@/lib/couranr/conversations/states";

/**
 * MER-014 / MER-015 — the bounded settings-and-team matrix.
 *
 * TRM-002's acceptance criterion is that "each of the five roles has an
 * explicit permission set before MER-015 ships". This file IS that
 * explicitness: the full 5 × 7 grid is written out and asserted, so a change
 * to the matrix has to change a test that states the intent in words.
 */

const ROOT = path.resolve(__dirname, "..");

/** The full grid, written independently of the module under test. */
const EXPECTED: Record<string, SettingsCapability[]> = {
  owner: [
    "settings.read",
    "settings.write",
    "team.read",
    "team.invite",
    "team.change_role",
    "team.grant_owner",
    "team.set_member_status",
  ],
  manager: [
    "settings.read",
    "settings.write",
    "team.read",
    "team.invite",
    "team.change_role",
    "team.set_member_status",
  ],
  dispatcher: ["settings.read", "team.read"],
  viewer: ["settings.read", "team.read"],
  billing: ["settings.read", "team.read"],
};

describe("the five roles have an explicit settings permission set (TRM-002 acceptance)", () => {
  it("covers exactly the five schema roles — no invented sixth", () => {
    expect([...MEMBER_ROLES].sort()).toEqual([
      "billing",
      "dispatcher",
      "manager",
      "owner",
      "viewer",
    ]);
  });

  for (const role of MEMBER_ROLES) {
    for (const cap of SETTINGS_CAPABILITIES) {
      const should = EXPECTED[role].includes(cap);
      it(`${role} ${should ? "MAY" : "may NOT"} ${cap}`, () => {
        expect(memberMay({ role, status: "active" }, cap)).toBe(should);
      });
    }
  }
});

describe("status gates every capability", () => {
  for (const status of ["invited", "disabled"]) {
    it(`an ${status} owner — the most privileged role — may do nothing`, () => {
      for (const cap of SETTINGS_CAPABILITIES) {
        expect(memberMay({ role: "owner", status }, cap)).toBe(false);
      }
    });
  }

  it("a null or unknown status is refused", () => {
    expect(memberMay({ role: "owner", status: null }, "settings.read")).toBe(false);
    expect(memberMay({ role: "owner", status: "pending" }, "settings.read")).toBe(false);
  });
});

describe("FAIL CLOSED on an unrecognised role", () => {
  // The database CHECK permits five values today. If a future migration adds a
  // sixth and this module is not updated, the new role must get NOTHING rather
  // than inherit someone else's rights.
  for (const role of ["superuser", "admin", "", "OWNER", null, undefined]) {
    it(`role ${JSON.stringify(role)} gets no capability at all`, () => {
      for (const cap of SETTINGS_CAPABILITIES) {
        expect(memberMay({ role: role as any, status: "active" }, cap)).toBe(false);
      }
    });
  }
});

describe("capabilityForRoleChange isolates the owner transition", () => {
  it("promoting to owner needs team.grant_owner", () => {
    expect(capabilityForRoleChange("manager", "owner")).toBe("team.grant_owner");
  });

  it("DEMOTING an owner also needs team.grant_owner", () => {
    // Both directions: taking the last-but-one owner's role away is as
    // consequential as handing it out, so a manager must not be able to do it.
    expect(capabilityForRoleChange("owner", "manager")).toBe("team.grant_owner");
  });

  it("any non-owner change is the ordinary capability", () => {
    expect(capabilityForRoleChange("viewer", "dispatcher")).toBe("team.change_role");
    expect(capabilityForRoleChange("billing", "viewer")).toBe("team.change_role");
  });

  it("a manager can do ordinary role changes but NOT owner ones", () => {
    const manager = { role: "manager", status: "active" };
    expect(memberMay(manager, capabilityForRoleChange("viewer", "dispatcher"))).toBe(true);
    expect(memberMay(manager, capabilityForRoleChange("manager", "owner"))).toBe(false);
    expect(memberMay(manager, capabilityForRoleChange("owner", "viewer"))).toBe(false);
  });
});

describe("role descriptions state the TRM-002 consequence, not marketing copy", () => {
  it("every role has a label and a description", () => {
    for (const role of MEMBER_ROLES) {
      expect(ROLE_LABELS[role], role).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role], role).toBeTruthy();
    }
  });

  /**
   * The one claim these strings make that a merchant could be burned by:
   * TRM-002 decided viewer and billing have NO conversation access. If that
   * decision ever changes, this test fails and the copy gets fixed with it —
   * rather than the screen quietly telling owners something untrue.
   */
  for (const role of ["viewer", "billing"] as const) {
    it(`${role}'s description says it has no message access, and the decided matrix agrees`, () => {
      const decided = MERCHANT_CONVERSATION_PERMISSIONS[role];
      expect(decided.read, `TRM-002 says ${role} may not read`).toBe(false);
      expect(decided.send, `TRM-002 says ${role} may not send`).toBe(false);
      expect(ROLE_DESCRIPTIONS[role].toLowerCase()).toContain("no access to messages");
    });
  }

  for (const role of ["owner", "manager", "dispatcher"] as const) {
    it(`${role} has message access in TRM-002 and the description says so`, () => {
      expect(MERCHANT_CONVERSATION_PERMISSIONS[role].read).toBe(true);
      expect(ROLE_DESCRIPTIONS[role].toLowerCase()).toContain("messages");
    });
  }
});

describe("the module states its own bound", () => {
  /**
   * This matrix is an implementation decision standing in for a registry
   * record that does not exist. If someone deletes the explanation, the next
   * reader will take it for decided policy — so the citation is asserted.
   */
  it("cites the TRM-002 scope gap and refuses to cite DRP-001 as its authority", () => {
    const src = readFileSync(
      path.join(ROOT, "lib/couranr/settings/permissions.ts"),
      "utf8"
    );
    expect(src).toContain("TRM-002");
    expect(src).toContain("BOUNDED IMPLEMENTATION DECISION");
    expect(src).toMatch(/Do NOT cite DRP-001/);
  });
});
