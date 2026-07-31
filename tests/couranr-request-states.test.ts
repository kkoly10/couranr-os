import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMAND_RULES,
  QUEUE_STATES,
  READINESS_STATES,
  REQUEST_COMMANDS,
  REQUEST_STATES,
  REVIEW_STATES,
  SERVICE_AREA_REVIEW_STATES,
  isEditable,
  isTransitionDenied,
  resolveTransition,
  type RequestState,
} from "@/lib/couranr/requests/states";

const MIGRATIONS = path.resolve(__dirname, "../supabase/migrations");
const MIGRATION_SQL = readFileSync(
  path.join(
    MIGRATIONS,
    readdirSync(MIGRATIONS).filter((f) => f.endsWith("_couranr_delivery_requests.sql"))[0]
  ),
  "utf8"
);

describe("delivery-request state machine", () => {
  /**
   * The vocabularies here and the database CHECK constraints are two
   * enforcement points for the same rule. If they drift, the application
   * happily builds a payload the database then rejects at runtime — so they
   * are compared directly.
   */
  describe("agrees with the database CHECK constraints", () => {
    const cases: Array<[string, readonly string[]]> = [
      ["couranr_dr_request_state_chk", REQUEST_STATES],
      ["couranr_dr_readiness_state_chk", READINESS_STATES],
      ["couranr_dr_review_state_chk", REVIEW_STATES],
      ["couranr_dr_service_area_state_chk", SERVICE_AREA_REVIEW_STATES],
      ["couranr_dre_command_chk", REQUEST_COMMANDS],
    ];

    for (const [constraint, values] of cases) {
      it(`${constraint} lists exactly the TypeScript vocabulary`, () => {
        const start = MIGRATION_SQL.indexOf(constraint);
        expect(start, `${constraint} missing from the migration`).toBeGreaterThan(-1);
        // From the constraint name to the end of its `check (... in (...))`.
        const chunk = MIGRATION_SQL.slice(start, MIGRATION_SQL.indexOf("))", start) + 2);
        const inSql = (chunk.match(/'([a-z_0-9]+)'/g) || []).map((s) => s.slice(1, -1));
        expect(inSql.sort()).toEqual([...values].sort());
      });
    }
  });

  it("has a rule for every command and no command without a rule", () => {
    expect(Object.keys(COMMAND_RULES).sort()).toEqual([...REQUEST_COMMANDS].sort());
  });

  it("every rule's from/to states are canonical", () => {
    for (const [command, rule] of Object.entries(COMMAND_RULES)) {
      for (const s of rule.from) {
        expect(REQUEST_STATES, `${command} from ${s}`).toContain(s);
      }
      if (rule.to !== "unchanged") {
        expect(REQUEST_STATES, `${command} to ${rule.to}`).toContain(rule.to);
      }
    }
  });

  describe("submit_delivery_request", () => {
    it("moves a draft to pending Couranr review", () => {
      const d = resolveTransition("submit_delivery_request", "draft");
      expect(d.allowed).toBe(true);
      if (!d.allowed) return;
      expect(d.nextState).toBe("pending_couranr_review");
    });

    it("cannot be run twice", () => {
      const d = resolveTransition("submit_delivery_request", "pending_couranr_review");
      expect(isTransitionDenied(d)).toBe(true);
      if (!isTransitionDenied(d)) return;
      expect(d.reason).toBe("wrong_state");
    });

    it("cannot run from any non-draft state", () => {
      for (const s of REQUEST_STATES.filter((x) => x !== "draft")) {
        expect(resolveTransition("submit_delivery_request", s).allowed, s).toBe(false);
      }
    });
  });

  describe("calculate_delivery_request_estimate", () => {
    it("runs on a draft and leaves the state alone", () => {
      const d = resolveTransition("calculate_delivery_request_estimate", "draft");
      expect(d.allowed).toBe(true);
      if (!d.allowed) return;
      expect(d.nextState).toBe("draft");
    });

    /**
     * Re-pricing after submission would change the numbers Couranr is
     * reviewing, and the numbers the merchant agreed to look at.
     */
    it("cannot re-price a submitted request", () => {
      expect(
        resolveTransition("calculate_delivery_request_estimate", "pending_couranr_review").allowed
      ).toBe(false);
    });
  });

  describe("begin_delivery_request_review", () => {
    it("runs only on a request waiting for review", () => {
      expect(resolveTransition("begin_delivery_request_review", "pending_couranr_review").allowed).toBe(
        true
      );
      expect(resolveTransition("begin_delivery_request_review", "draft").allowed).toBe(false);
    });

    it("does not decide the outcome", () => {
      const d = resolveTransition("begin_delivery_request_review", "pending_couranr_review");
      expect(d.allowed).toBe(true);
      if (!d.allowed) return;
      expect(d.nextState).toBe("pending_couranr_review");
    });
  });

  it("create_delivery_request_draft is not reachable as a transition", () => {
    for (const s of REQUEST_STATES) {
      expect(resolveTransition("create_delivery_request_draft", s).allowed, s).toBe(false);
    }
  });

  /**
   * These states exist in the database vocabulary but no command in this slice
   * can reach them. Asserting it stops a later change from quietly making a
   * decision state reachable without a review.
   */
  it("reaches no decision state", () => {
    const reachable = new Set<RequestState>();
    for (const rule of Object.values(COMMAND_RULES)) {
      if (rule.to !== "unchanged") reachable.add(rule.to);
      for (const s of rule.from) reachable.add(s);
    }
    for (const s of [
      "awaiting_quote_acceptance",
      "quote_revision_required",
      "confirmed",
      "declined",
      "cancelled",
      "closed",
      "awaiting_merchant_confirmation",
    ] as RequestState[]) {
      expect(reachable.has(s), `${s} became reachable`).toBe(false);
    }
    expect([...reachable].sort()).toEqual(["draft", "pending_couranr_review"]);
  });

  it("only a draft is editable", () => {
    for (const s of REQUEST_STATES) {
      expect(isEditable(s), s).toBe(s === "draft");
    }
  });

  it("the queue holds exactly the state submit produces", () => {
    expect([...QUEUE_STATES]).toEqual(["pending_couranr_review"]);
  });

  it("does not invent 'submitted' as a state", () => {
    expect(REQUEST_STATES).not.toContain("submitted" as any);
  });
});
