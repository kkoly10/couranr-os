import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMAND_RULES,
  DECLINE_REASONS,
  DECLINE_REASON_VERSION,
  QUEUE_STATES,
  READINESS_STATES,
  REQUEST_COMMANDS,
  REQUEST_EVENT_COMMANDS,
  REQUEST_STATES,
  REVIEW_OUTCOME_COMMANDS,
  RETIRED_DECLINE_REASONS,
  REVIEW_STATES,
  SERVICE_AREA_REVIEW_STATES,
  isDeclineReason,
  isEditable,
  isTransitionDenied,
  resolveTransition,
  targetStates,
  type RequestState,
} from "@/lib/couranr/requests/states";

const MIGRATIONS = path.resolve(__dirname, "../supabase/migrations");

/**
 * Forward migrations only, in version order. Rollbacks are excluded on purpose
 * — they restore OLD definitions, so including them would make the "last
 * definition wins" reading below pick up the very shape we migrated away from.
 */
const MIGRATION_SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && !f.includes(".rollback."))
  .sort()
  .map((f) => readFileSync(path.join(MIGRATIONS, f), "utf8"))
  .join("\n");

/**
 * The literals inside a named CHECK constraint's body.
 *
 * `lastIndexOf` because a constraint can be redefined by a later migration —
 * `couranr_dre_command_chk` was widened by the review-outcome migration — and
 * the EFFECTIVE definition is the last one. The body is taken by balancing
 * parentheses rather than scanning for `))`: the two constraint forms in this
 * repo (`check (x in (...))` and `check (x = any (array[...]))`) do not end
 * with the same punctuation, and the old scan silently over-captured the
 * second one.
 */
function checkConstraintLiterals(sql: string, constraint: string): string[] | null {
  const at = sql.lastIndexOf(constraint);
  if (at < 0) return null;
  const checkAt = sql.indexOf("check", at);
  if (checkAt < 0) return null;
  const open = sql.indexOf("(", checkAt);
  if (open < 0) return null;

  let depth = 0;
  let close = -1;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) return null;
  return (sql.slice(open, close + 1).match(/'([a-z_0-9]+)'/g) || []).map((s) => s.slice(1, -1));
}

describe("delivery-request state machine", () => {
  /**
   * The vocabularies here and the database CHECK constraints are two
   * enforcement points for the same rule. Request states/readiness/review map
   * directly. The delivery-request EVENT constraint uses the wider
   * REQUEST_EVENT_COMMANDS vocabulary because system automation writes audit
   * events that are not actor-invocable request commands.
   */
  describe("agrees with the database CHECK constraints", () => {
    const cases: Array<[string, readonly string[]]> = [
      ["couranr_dr_request_state_chk", REQUEST_STATES],
      ["couranr_dr_readiness_state_chk", READINESS_STATES],
      ["couranr_dr_review_state_chk", REVIEW_STATES],
      ["couranr_dr_service_area_state_chk", SERVICE_AREA_REVIEW_STATES],
      ["couranr_dre_command_chk", REQUEST_EVENT_COMMANDS],
    ];

    for (const [constraint, values] of cases) {
      it(`${constraint} lists exactly the TypeScript vocabulary`, () => {
        const inSql = checkConstraintLiterals(MIGRATION_SQL, constraint);
        expect(inSql, `${constraint} missing from the migrations`).not.toBeNull();
        expect(inSql.sort()).toEqual([...values].sort());
      });
    }

    /**
     * Positive control for the extractor itself. The old scan reported a
     * plausible-looking list for the `= any (array[...])` form while actually
     * over-capturing, so the parser is checked against a known answer rather
     * than trusted because the assertions above are green.
     */
    it("the constraint reader handles both CHECK forms and takes the LAST definition", () => {
      const inForm = "constraint c_x check (col in ('a','b'))";
      expect(checkConstraintLiterals(inForm, "c_x")).toEqual(["a", "b"]);

      const anyForm = "constraint c_y check (\n  col = any (array[\n 'p',\n 'q'\n ])\n);";
      expect(checkConstraintLiterals(anyForm, "c_y")).toEqual(["p", "q"]);

      const redefined = `${inForm};\nalter table t add constraint c_x check (col in ('a','b','c'));`;
      expect(checkConstraintLiterals(redefined, "c_x")).toEqual(["a", "b", "c"]);

      expect(checkConstraintLiterals(inForm, "c_absent")).toBeNull();
    });
  });

  it("has a rule for every command and no command without a rule", () => {
    expect(Object.keys(COMMAND_RULES).sort()).toEqual([...REQUEST_COMMANDS].sort());
  });

  it("every rule's from/to states are canonical", () => {
    for (const [command, rule] of Object.entries(COMMAND_RULES)) {
      for (const s of rule.from) {
        expect(REQUEST_STATES, `${command} from ${s}`).toContain(s);
      }
      for (const s of targetStates(rule.to)) {
        expect(REQUEST_STATES, `${command} to ${s}`).toContain(s);
      }
    }
  });

  it("every review-outcome rule names the review_state it sets", () => {
    for (const { command } of REVIEW_OUTCOME_COMMANDS) {
      const rule = COMMAND_RULES[command];
      expect(REVIEW_STATES, `${command} review_state`).toContain(rule.reviewState);
    }
    // And the commands that are not outcomes do not claim one.
    expect(COMMAND_RULES.begin_delivery_request_review.reviewState).toBeUndefined();
    expect(COMMAND_RULES.submit_delivery_request.reviewState).toBeUndefined();
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

  describe("hosted request lifecycle", () => {
    it("creates directly into merchant confirmation", () => {
      for (const state of REQUEST_STATES) {
        expect(resolveTransition("create_hosted_delivery_request", state).allowed, state).toBe(false);
      }
      expect(COMMAND_RULES.create_hosted_delivery_request.to).toBe(
        "awaiting_merchant_confirmation"
      );
    });

    it("merchant validation is the only modeled transition out of merchant confirmation", () => {
      const d = resolveTransition(
        "validate_hosted_delivery_request",
        "awaiting_merchant_confirmation"
      );
      expect(d.allowed).toBe(true);
      if (!d.allowed) return;
      expect(d.nextState).toBe("pending_couranr_review");

      for (const state of REQUEST_STATES.filter(
        (value) => value !== "awaiting_merchant_confirmation"
      )) {
        expect(
          resolveTransition("validate_hosted_delivery_request", state).allowed,
          state
        ).toBe(false);
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

  /* ------------------------------------------------- review outcomes --- */

  describe("accept_delivery_request_as_quoted (REV-001)", () => {
    /**
     * The owner's decision, asserted as two separate facts rather than one.
     * A merchant-paid confirm skips payer approval because the merchant
     * already approved this quote at submission; a customer-paid one cannot,
     * because the merchant is not the payer.
     */
    it("sends a merchant-paid request straight to confirmed", () => {
      const d = resolveTransition(
        "accept_delivery_request_as_quoted",
        "pending_couranr_review",
        "merchant"
      );
      expect(d.allowed).toBe(true);
      if (!d.allowed) return;
      expect(d.nextState).toBe("confirmed");
    });

    it("holds an Operations-assisted merchant-paid request for Business approval", () => {
      const d = resolveTransition(
        "accept_delivery_request_as_quoted",
        "pending_couranr_review",
        "merchant",
        { operationsAssisted: true }
      );
      expect(d.allowed).toBe(true);
      if (!d.allowed) return;
      expect(d.nextState).toBe("awaiting_quote_acceptance");
    });

    it("holds a customer-paid request at awaiting_quote_acceptance", () => {
      const d = resolveTransition(
        "accept_delivery_request_as_quoted",
        "pending_couranr_review",
        "customer"
      );
      expect(d.allowed).toBe(true);
      if (!d.allowed) return;
      expect(d.nextState).toBe("awaiting_quote_acceptance");
    });

    /**
     * The failure that matters most. Defaulting an unknown payer to `merchant`
     * would confirm a customer-paid request the customer has never seen, which
     * is precisely what the payer-dependent design exists to prevent — so an
     * absent or unrecognised payer must DENY, not guess.
     */
    it("refuses to guess when the payer type is missing or unrecognised", () => {
      for (const payer of [undefined, null, "", "MERCHANT", "business", 1, true]) {
        const d = resolveTransition(
          "accept_delivery_request_as_quoted",
          "pending_couranr_review",
          payer as any
        );
        expect(isTransitionDenied(d), `payer ${String(payer)}`).toBe(true);
        if (!isTransitionDenied(d)) return;
        expect(d.reason).toBe("payer_required");
      }
    });

    it("runs only from pending_couranr_review", () => {
      for (const s of REQUEST_STATES.filter((x) => x !== "pending_couranr_review")) {
        expect(
          resolveTransition("accept_delivery_request_as_quoted", s, "merchant").allowed,
          s
        ).toBe(false);
      }
    });
  });

  describe("requote_delivery_request", () => {
    it("moves to quote_revision_required for either payer", () => {
      for (const payer of ["merchant", "customer"] as const) {
        const d = resolveTransition("requote_delivery_request", "pending_couranr_review", payer);
        expect(d.allowed).toBe(true);
        if (!d.allowed) return;
        expect(d.nextState, payer).toBe("quote_revision_required");
      }
    });

    it("does not need a payer type, because its target does not depend on one", () => {
      const d = resolveTransition("requote_delivery_request", "pending_couranr_review");
      expect(d.allowed).toBe(true);
    });
  });

  describe("decline_delivery_request", () => {
    it("moves to declined for either payer", () => {
      for (const payer of ["merchant", "customer"] as const) {
        const d = resolveTransition("decline_delivery_request", "pending_couranr_review", payer);
        expect(d.allowed).toBe(true);
        if (!d.allowed) return;
        expect(d.nextState, payer).toBe("declined");
      }
    });

    it("cannot re-decline an already declined request", () => {
      expect(resolveTransition("decline_delivery_request", "declined").allowed).toBe(false);
    });
  });

  /**
   * REV-002 is decided: the placeholder taxonomy that shipped with the review
   * outcomes has been replaced by the owner-approved `couranr-decline-v1`.
   * The full taxonomy — copy, note rules, SQL agreement, retired codes — is
   * asserted in `couranr-request-commands.test.ts`, next to the migration it
   * has to agree with. What belongs HERE is the state-machine-level fact: the
   * vocabulary is v1, and the review triggers are not part of it.
   */
  it("uses the owner-approved v1 decline vocabulary", () => {
    expect(DECLINE_REASON_VERSION).toBe("couranr-decline-v1");
    expect([...DECLINE_REASONS]).toEqual([
      "outside_service_area",
      "requested_time_unavailable",
      "no_driver_available",
      "no_compatible_vehicle",
      "shipment_not_supported",
      "merchant_account_on_hold",
      "duplicate_or_superseded",
      "other",
    ]);
    expect(isDeclineReason("no_driver_available")).toBe(true);
    for (const junk of ["", "OTHER", "capacity_unavailable", null, undefined, 3, {}]) {
      expect(isDeclineReason(junk), String(junk)).toBe(false);
    }
  });

  /**
   * A review trigger says "this quote needs a human". A decline says "Couranr
   * will not do this work". Confusing the two tells a merchant they cannot be
   * served when the truth is that their price has to be worked out by hand,
   * so the two vocabularies must stay disjoint.
   */
  it("keeps review triggers out of the decline vocabulary", () => {
    for (const trigger of RETIRED_DECLINE_REASONS) {
      expect(DECLINE_REASONS, `${trigger} is a decline reason`).not.toContain(trigger as any);
    }
    // And no decline reason has leaked into the review-state vocabulary.
    for (const r of DECLINE_REASONS) {
      expect(REVIEW_STATES, `${r} is being used as a review state`).not.toContain(r as any);
    }
  });

  /**
   * Replaces the pre-REV-001 assertion that NO decision state was reachable.
   * The review outcomes are exactly what make three of them reachable, so the
   * guard now pins WHICH ones and by which command — and keeps the states that
   * belong to the unbuilt payment and fulfillment slices out of reach.
   */
  it("reaches exactly the decision states the review outcomes own", () => {
    const reachable = new Set<RequestState>();
    for (const rule of Object.values(COMMAND_RULES)) {
      for (const s of targetStates(rule.to)) reachable.add(s);
      for (const s of rule.from) reachable.add(s);
    }

    expect([...reachable].sort()).toEqual(
      [
        "awaiting_merchant_confirmation",
        "awaiting_quote_acceptance",
        "cancelled",
        "confirmed",
        "declined",
        "draft",
        "pending_couranr_review",
        "quote_revision_required",
      ].sort()
    );

    // `cancelled` gained its governed writer in the final closure pass and
    // hosted request creation now explicitly owns merchant confirmation.
    expect(reachable.has("closed")).toBe(false);
  });

  /**
   * `confirmed` is a review conclusion, not a payment or dispatch one. Nothing
   * in the state machine may imply otherwise — the readiness vocabulary is
   * untouched by every review outcome, which is the independence STA-001
   * protects.
   */
  it("no review outcome touches readiness", () => {
    for (const { command } of REVIEW_OUTCOME_COMMANDS) {
      const rule = COMMAND_RULES[command];
      for (const s of targetStates(rule.to)) {
        expect(READINESS_STATES, `${command} produced a readiness state`).not.toContain(s as any);
      }
    }
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
