import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTHORSHIPS,
  CONVERSATION_KINDS,
  CONVERSATION_POST_ROLES,
  CUSTOMER_TOPICS,
  DUE_SOON_MINUTES,
  MESSAGE_MAY_NOT_MUTATE,
  OVERDUE_MINUTES,
  PARTICIPANT_KINDS,
  VISIBILITIES,
  canSee,
  dueStateAt,
  isReadableInThread,
  memberMayPost,
  responseDueAt,
  type ParticipantKind,
  type Visibility,
} from "@/lib/couranr/conversations/states";
import {
  CONVERSATION_PROJECTION_FORBIDDEN_KEYS,
  toConversationNotification,
  toExportRows,
  toParticipantMessage,
  toParticipantThread,
  toRealtimeEvent,
  type MessageRow,
} from "@/lib/couranr/conversations/projection";

/**
 * P8-001's acceptance criterion, verbatim from
 * couranr_claude_code_package/08_WORK_BREAKDOWN.csv: "Participant/privacy tests
 * pass". This file is that test.
 *
 * The sentence it has to prove, from the Master Package §Conversation
 * permissions: "Internal notes and AI drafts must be excluded from initial
 * queries, realtime, exports, and notifications." Four enforcement points, and
 * there is a describe block below for each.
 *
 * WHAT THESE TESTS CANNOT DO. The strongest guarantee in this slice lives in
 * the database — no role holds SELECT on couranr_conversation_messages, so a
 * direct query raises 42501 rather than returning an internal note. A Vitest
 * suite with no database cannot observe that. It is verified instead against a
 * real PostgreSQL cluster, and the SQL-text assertions below fail if the
 * grants that produce it are edited away.
 */

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const MIGRATION_NAME = "20260804150000_couranr_conversations.sql";

const stripSql = (s: string) => s.replace(/^\s*--.*$/gm, "");
const SQL = stripSql(readFileSync(path.join(MIGRATIONS, MIGRATION_NAME), "utf8"));
const flat = (s: string) => s.replace(/\s+/g, " ").toLowerCase();

/** Every forward migration, in the order the database applies them. */
const FORWARD_SQL_FILES = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith(".sql") && !f.includes(".rollback."))
  .sort();

/**
 * The EFFECTIVE text of a `create or replace function`, taken from the LAST
 * migration that defines it.
 *
 * Asserting against a hardcoded filename is how a passing test comes to
 * validate dead code. `couranr_conversation_thread` is created in
 * 20260804150000 and REPLACED in 20260804170000, so every reader assertion
 * pinned to the 150000 text was checking a body the database no longer runs —
 * including the tenure clause, which 170000 deliberately changed. The tests
 * stayed green either way, which is the whole problem.
 *
 * Resolving by application order means a future migration that replaces a
 * function is checked, and one that leaves it alone changes nothing.
 */
function effectiveFunctionSql(name: string): string {
  let found = "";
  for (const file of FORWARD_SQL_FILES) {
    const sql = stripSql(readFileSync(path.join(MIGRATIONS, file), "utf8"));
    const re = new RegExp(
      `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?\\$\\$;`,
      "gi"
    );
    const hits = [...sql.matchAll(re)];
    if (hits.length > 0) found = hits[hits.length - 1][0];
  }
  return found;
}

/** The reader as the database actually runs it, not as one file once wrote it. */
const READER_SQL = effectiveFunctionSql("couranr_conversation_thread");

const COMMANDS_RAW = readFileSync(
  path.join(ROOT, "lib/couranr/conversations/commands.ts"),
  "utf8"
);
/** Comments legitimately name the patterns the code must not contain. */
const COMMANDS = COMMANDS_RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/**
 * Extracts one function's body by matching braces.
 *
 * The obvious `src.slice(start, src.indexOf("\n}", start))` truncates at the
 * first nested block that happens to close in column 0 — which silently made
 * two assertions here inspect three lines of a signature instead of a function
 * body, and pass for the wrong reason until they were made to fail.
 */
function functionBody(src: string, declaration: string): string {
  const start = src.indexOf(declaration);
  if (start < 0) return "";

  // Skip the parameter list. These functions take a destructured object type,
  // so the first `{` after the declaration is `{ conversationId: string; ... }`
  // — the params, not the body. Walk to the `)` that closes the argument list
  // first, tracking paren depth.
  let i = src.indexOf("(", start);
  if (i < 0) return "";
  let parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === "(") parens++;
    else if (src[i] === ")") {
      parens--;
      if (parens === 0) break;
    }
  }

  // Skip the RETURN TYPE. `Promise<ConversationResult<{ dueSoon: number }>>`
  // contains a `{` that is not the body — the third distinct way this helper
  // has been wrong, after slicing to the first "\n}" and to the parameter
  // object. Walk to the first `{` that sits outside any angle brackets.
  let angle = 0;
  let open = -1;
  for (let k = i + 1; k < src.length; k++) {
    const ch = src[k];
    if (ch === "<") angle++;
    else if (ch === ">") angle = Math.max(0, angle - 1);
    else if (ch === "{" && angle === 0) {
      open = k;
      break;
    }
  }
  if (open < 0) return "";

  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, j + 1);
    }
  }
  return src.slice(open);
}

const msg = (over: Partial<MessageRow> = {}): MessageRow => ({
  id: "m1",
  conversation_id: "c1",
  author_participant_id: "p1",
  visibility: "participants",
  authorship: "human",
  topic: null,
  body: "hello",
  created_at: "2026-08-04T12:00:00.000Z",
  ...over,
});

/* ══════════════════════════════ the vocabularies ══════════════════════════ */

describe("vocabularies match the specification exactly", () => {
  it("visibility is the four-value closed set, in spec order", () => {
    expect([...VISIBILITIES]).toEqual([
      "participants",
      "couranr_internal",
      "driver_and_couranr",
      "merchant_and_couranr",
    ]);
  });

  it("the seven customer topics are all present and none is invented", () => {
    // "Customer may report availability, access, address concern, handoff
    // concern, unrecognized delivery, delivery problem, or other."
    expect([...CUSTOMER_TOPICS].sort()).toEqual([
      "access",
      "address_concern",
      "availability",
      "delivery_problem",
      "handoff_concern",
      "other",
      "unrecognized_delivery",
    ]);
  });

  it("delivery_problem is a topic even though CUS-004's claims workflow is deferred", () => {
    // GAT-002 defers incidents and claims. It does not defer the customer's
    // ability to say something is wrong — those are different things, and
    // conflating them would drop a topic the spec names.
    expect(CUSTOMER_TOPICS).toContain("delivery_problem");
  });

  it("the SQL CHECK constraints carry the same vocabularies as the TypeScript", () => {
    const sql = flat(SQL);
    for (const v of VISIBILITIES) expect(sql, `visibility ${v}`).toContain(`'${v}'`);
    for (const t of CUSTOMER_TOPICS) expect(sql, `topic ${t}`).toContain(`'${t}'`);
    for (const k of CONVERSATION_KINDS) expect(sql, `kind ${k}`).toContain(`'${k}'`);
    for (const p of PARTICIPANT_KINDS) expect(sql, `participant ${p}`).toContain(`'${p}'`);
    for (const a of AUTHORSHIPS) expect(sql, `authorship ${a}`).toContain(`'${a}'`);
  });

  it("no FIFTH visibility value exists anywhere", () => {
    // The CHECK constraint text, extracted and parsed rather than substring
    // matched — a new value added to the constraint but not to VISIBILITIES
    // would otherwise pass silently and then be invisible to canSee().
    const m = flat(SQL).match(/couranr_cvm_visibility_chk\s+check\s*\(\s*visibility\s+in\s*\(([^)]*)\)/);
    expect(m, "the visibility CHECK must exist").not.toBeNull();
    const inSql = m![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean)
      .sort();
    expect(inSql).toEqual([...VISIBILITIES].sort());
  });
});

/* ═══════════════════════ 1/4 — initial queries ════════════════════════════ */

describe("exclusion point 1 of 4 — initial queries", () => {
  it("NOBODY holds table-level SELECT on the message table", () => {
    const sql = flat(SQL);
    // The revoke must name all four, including `public` — a privilege held
    // through PUBLIC is invisible to grantee-row inspection.
    expect(sql).toContain(
      "revoke all on public.couranr_conversation_messages from public, anon, authenticated, service_role"
    );
    // And no bare table grant may follow it.
    expect(sql).not.toMatch(
      /grant\s+select\s+on\s+public\.couranr_conversation_messages/
    );
  });

  it("column-level SELECT is limited to the three that cannot carry content", () => {
    const m = flat(SQL).match(
      /grant\s+select\s*\(([^)]*)\)\s*on\s+public\.couranr_conversation_messages/
    );
    expect(m, "the column grant must exist").not.toBeNull();
    const cols = m![1].split(",").map((s) => s.trim()).sort();
    expect(cols).toEqual(["conversation_id", "id", "idempotency_key"]);
    // Stated as an explicit denial so the intent survives a refactor.
    for (const forbidden of ["body", "visibility", "authorship", "topic"]) {
      expect(cols, `${forbidden} must never be readable`).not.toContain(forbidden);
    }
  });

  it("the reader function is the only grantee, and anon/authenticated are revoked", () => {
    const sql = flat(SQL);
    expect(sql).toContain(
      "revoke all on function public.couranr_conversation_thread(uuid, uuid) from public, anon, authenticated, service_role"
    );
    expect(sql).toContain(
      "grant execute on function public.couranr_conversation_thread(uuid, uuid) to service_role"
    );
  });

  it("the reader returns a composite, never `returns table`", () => {
    expect(flat(READER_SQL)).toContain("returns setof public.couranr_conversation_messages");
    // `returns table (...)` declares OUT parameters, and an OUT parameter whose
    // name collides with a column raises 42702 at call time. That shipped a
    // payment function dead in this repo once already.
    const sql = flat(SQL);
    expect(sql).toContain("returns setof public.couranr_conversation_messages");
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function\s+public\.couranr_conversation_thread[\s\S]*?returns\s+table/);
  });

  it("the reader excludes ai_draft unconditionally and windows by tenure", () => {
    // Against the EFFECTIVE reader — the last migration that defines it — not
    // the file that first created it. Pinned to 20260804150000 this passed
    // while checking a body 20260804170000 had already replaced.
    expect(READER_SQL, "the reader must be resolvable").not.toBe("");
    const sql = flat(READER_SQL);
    expect(sql).toContain("m.authorship <> 'ai_draft'");
    expect(sql).toContain("m.created_at >= p.joined_at");
    expect(sql).toContain("p.left_at is null");
  });

  it("the EFFECTIVE reader is the one 20260804170000 defines, not 150000's", () => {
    // A guard on the resolver itself. If it silently fell back to the first
    // definition, every assertion above would go back to checking dead text.
    expect(flat(READER_SQL)).toContain("p.participant_kind <> 'driver'");
  });
});

/* ══════════════════ the participant/visibility truth table ════════════════ */

describe("the participant x visibility rule", () => {
  /**
   * The full 4x4, written out rather than computed, so the test states the
   * requirement instead of restating the implementation.
   */
  const EXPECTED: Record<Visibility, ParticipantKind[]> = {
    participants: ["merchant", "driver", "operations", "customer"],
    couranr_internal: ["operations"],
    driver_and_couranr: ["driver", "operations"],
    merchant_and_couranr: ["merchant", "operations"],
  };

  for (const visibility of VISIBILITIES) {
    for (const kind of PARTICIPANT_KINDS) {
      const should = EXPECTED[visibility].includes(kind);
      it(`${kind} ${should ? "CAN" : "CANNOT"} see ${visibility}`, () => {
        expect(canSee(kind, visibility)).toBe(should);
      });
    }
  }

  it("only operations sees an internal note", () => {
    const seers = PARTICIPANT_KINDS.filter((k) => canSee(k, "couranr_internal"));
    expect(seers).toEqual(["operations"]);
  });

  it("an unrecognised visibility FAILS CLOSED", () => {
    // If a fifth value is ever added to the CHECK and this switch is not
    // updated, the message must be hidden from everyone rather than shown to
    // everyone. This is the difference between a bug and a breach.
    for (const kind of PARTICIPANT_KINDS) {
      expect(canSee(kind, "something_new" as Visibility)).toBe(false);
    }
  });

  it("an AI draft is unreadable in a thread by EVERY viewer including operations", () => {
    expect(isReadableInThread("ai_draft")).toBe(false);
    expect(isReadableInThread("human")).toBe(true);
    expect(isReadableInThread("automated")).toBe(true);

    for (const kind of PARTICIPANT_KINDS) {
      const out = toParticipantMessage(msg({ authorship: "ai_draft" }), kind);
      expect(out, `${kind} must not receive an AI draft`).toBeNull();
    }
  });

  it("the TypeScript table and the SQL predicate agree", () => {
    // They are two expressions of one rule and must not drift. The SQL is the
    // authority; this asserts the mirror still matches it.
    const sql = flat(READER_SQL);
    expect(sql).toContain("m.visibility = 'couranr_internal' and p.participant_kind = 'operations'");
    expect(sql).toContain(
      "m.visibility = 'driver_and_couranr' and p.participant_kind in ('driver', 'operations')"
    );
    expect(sql).toContain(
      "m.visibility = 'merchant_and_couranr' and p.participant_kind in ('merchant', 'operations')"
    );
  });
});

/* ═══════════════ no unrestricted customer-driver chat ═════════════════════ */

describe("no unrestricted customer-driver chat is a SCHEMA property", () => {
  it("no conversation kind admits both a customer and a driver", () => {
    const sql = flat(SQL);
    // merchant_support: merchant + operations. delivery_chat: merchant +
    // driver + operations. delivery_help: customer + operations. No kind lists
    // both 'customer' and 'driver'.
    const fn = sql.slice(
      sql.indexOf("couranr_cv_participant_kind_allowed"),
      sql.indexOf("alter table public.couranr_conversation_participants")
    );
    const branches = [...fn.matchAll(/when '(\w+)' then p_participant_kind in \(([^)]*)\)/g)];
    expect(branches.length, "all three kinds must have a branch").toBe(3);

    for (const [, kind, list] of branches) {
      const kinds = list.split(",").map((s) => s.trim().replace(/'/g, ""));
      const both = kinds.includes("customer") && kinds.includes("driver");
      expect(both, `${kind} must not admit both a customer and a driver`).toBe(false);
    }
  });

  it("a merchant is not a participant in Delivery Help", () => {
    // CUS-008 exists because the customer types a gate code there. A merchant
    // has no business reading it.
    const sql = flat(SQL);
    const m = sql.match(/when 'delivery_help' then p_participant_kind in \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const kinds = m![1].split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    expect(kinds).toEqual(["customer", "operations"]);
  });
});

/* ══════════════════════════ 2/4 — realtime ════════════════════════════════ */

describe("exclusion point 2 of 4 — realtime", () => {
  it("a realtime payload carries two ids and nothing else", () => {
    const event = toRealtimeEvent(msg({ visibility: "couranr_internal", body: "SECRET" }));
    expect(Object.keys(event).sort()).toEqual(["conversationId", "messageId"]);
    expect(JSON.stringify(event)).not.toContain("SECRET");
  });

  it("even an internal note's broadcast reveals nothing about it", () => {
    const internal = toRealtimeEvent(msg({ id: "m9", visibility: "couranr_internal" }));
    const ordinary = toRealtimeEvent(msg({ id: "m9", visibility: "participants" }));
    // Byte-identical: a subscriber cannot tell the two apart, so the broadcast
    // is not itself a signal that an internal note exists.
    expect(JSON.stringify(internal)).toEqual(JSON.stringify(ordinary));
  });
});

/* ═════════════════════════ 3/4 — notifications ════════════════════════════ */

describe("exclusion point 3 of 4 — notifications", () => {
  const conversation = {
    id: "c1",
    kind: "merchant_support",
    business_account_id: "b1",
    delivery_id: null,
    request_id: null,
    status: "open" as const,
    waiting_on: "couranr" as const,
    urgency: "routine" as const,
    received_at: null,
    response_due_at: null,
    first_couranr_response_at: null,
    due_state: "on_time" as const,
    updated_at: "2026-08-04T12:00:00.000Z",
    version: 1,
  };

  it("the notification type has NO field capable of holding free text", () => {
    const n = toConversationNotification(conversation, "new_message", 3);
    expect(Object.keys(n).sort()).toEqual([
      "conversationId",
      "dueState",
      "templateKey",
      "unreadCount",
      "urgency",
    ]);
    for (const value of Object.values(n)) {
      // Every value is an id, an enum member or a number. None is prose.
      expect(typeof value === "string" || typeof value === "number").toBe(true);
    }
  });

  it("a notification is built from the CONVERSATION, so a message is never in scope", () => {
    // The signature is the guarantee: you cannot leak a body through a function
    // that is never handed one. Asserted on the source so a future overload
    // that accepts a message fails this test.
    const src = readFileSync(
      path.join(ROOT, "lib/couranr/conversations/projection.ts"),
      "utf8"
    );
    const fn = src.slice(src.indexOf("export function toConversationNotification"));
    const sig = fn.slice(0, fn.indexOf("{"));
    expect(sig).not.toContain("MessageRow");
    expect(sig).not.toContain("ParticipantMessage");
  });

  it("unreadCount cannot go negative or carry a fraction", () => {
    expect(toConversationNotification(conversation, "new_message", -5).unreadCount).toBe(0);
    expect(toConversationNotification(conversation, "new_message", 2.7).unreadCount).toBe(2);
  });
});

/* ═══════════════════════════ 4/4 — exports ════════════════════════════════ */

describe("exclusion point 4 of 4 — exports", () => {
  it("an export is built from already-filtered messages, so drafts cannot reach it", () => {
    const rows: MessageRow[] = [
      msg({ id: "a", visibility: "participants", body: "ok" }),
      msg({ id: "b", visibility: "couranr_internal", body: "INTERNAL" }),
      msg({ id: "c", authorship: "ai_draft", body: "DRAFT" }),
    ];
    const merchantView = toParticipantThread(rows, "merchant");
    const exported = toExportRows("c1", merchantView);

    expect(exported.map((r) => r.messageId)).toEqual(["a"]);
    const json = JSON.stringify(exported);
    expect(json).not.toContain("INTERNAL");
    expect(json).not.toContain("DRAFT");
  });

  it("an operations export still excludes AI drafts", () => {
    const rows: MessageRow[] = [
      msg({ id: "a", visibility: "couranr_internal", body: "internal ok for ops" }),
      msg({ id: "b", authorship: "ai_draft", body: "DRAFT" }),
    ];
    const exported = toExportRows("c1", toParticipantThread(rows, "operations"));
    expect(exported.map((r) => r.messageId)).toEqual(["a"]);
    expect(JSON.stringify(exported)).not.toContain("DRAFT");
  });

  it("an export row carries no field to re-filter on", () => {
    const exported = toExportRows("c1", toParticipantThread([msg()], "merchant"));
    expect(Object.keys(exported[0]).sort()).toEqual([
      "body",
      "conversationId",
      "createdAt",
      "messageId",
      "topic",
    ]);
  });
});

/* ═════════════════════ the projection's own guarantees ════════════════════ */

describe("the participant projection", () => {
  it("never emits a forbidden key, for any viewer, over the whole matrix", () => {
    const offenders: string[] = [];
    for (const kind of PARTICIPANT_KINDS) {
      for (const visibility of VISIBILITIES) {
        for (const authorship of AUTHORSHIPS) {
          const out = toParticipantMessage(msg({ visibility, authorship }), kind);
          if (!out) continue;
          const json = JSON.stringify(out);
          for (const key of CONVERSATION_PROJECTION_FORBIDDEN_KEYS) {
            if (json.includes(`"${key}"`)) {
              offenders.push(`${kind}/${visibility}/${authorship}: ${key}`);
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not carry visibility or authorship to the client", () => {
    const out = toParticipantMessage(msg(), "merchant");
    expect(Object.keys(out!).sort()).toEqual([
      "authorParticipantId",
      "authoredByPerson",
      "body",
      "createdAt",
      "id",
      "topic",
    ]);
  });

  it("the forbidden-key list is a SUPERSET of the shipped tracking list", () => {
    // A weaker list than the one already in tree would be a regression, and
    // the tracking list was itself written against a real leak.
    const tracking = readFileSync(
      path.join(ROOT, "lib/couranr/tracking/projection.ts"),
      "utf8"
    );
    const m = tracking.match(
      /TRACKING_PROJECTION_FORBIDDEN_SUBSTRINGS[^=]*=\s*\[([\s\S]*?)\]/
    );
    expect(m).not.toBeNull();
    const theirs = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    const missing = theirs.filter(
      (k) => !CONVERSATION_PROJECTION_FORBIDDEN_KEYS.includes(k)
    );
    // Tracking guards fields a conversation genuinely has no concept of
    // (signed URLs, storage paths, capture coordinates). Those are allowed to
    // be absent; the identity and tenancy keys are not.
    const mustCarry = theirs.filter((k) =>
      /business_account|delivery_id|deliveryId|request_id|requestId|token_hash|actor_user_id/.test(k)
    );
    expect(
      mustCarry.filter((k) => !CONVERSATION_PROJECTION_FORBIDDEN_KEYS.includes(k)),
      `missing identity/tenancy keys the tracking list already guards (all missing: ${missing.join(", ")})`
    ).toEqual([]);
  });
});

/* ════════════════════════ deadlines, without a timezone ═══════════════════ */

describe("deadlines — the half that ships while HRS-002 is unresolved", () => {
  const base = new Date("2026-08-04T12:00:00.000Z");

  it("marks due soon at 10 minutes and overdue at 15, per the spec", () => {
    expect(DUE_SOON_MINUTES).toBe(10);
    expect(OVERDUE_MINUTES).toBe(15);
    expect(dueStateAt(base, new Date(base.getTime() + 9 * 60_000))).toBe("on_time");
    expect(dueStateAt(base, new Date(base.getTime() + 10 * 60_000))).toBe("due_soon");
    expect(dueStateAt(base, new Date(base.getTime() + 14 * 60_000))).toBe("due_soon");
    expect(dueStateAt(base, new Date(base.getTime() + 15 * 60_000))).toBe("overdue");
  });

  it("the response deadline is 15 minutes after receipt", () => {
    expect(responseDueAt(base).toISOString()).toBe("2026-08-04T12:15:00.000Z");
  });

  it("ships NO operating-hours cutoff logic while HRS-002 is unresolved", () => {
    // "A named IANA timezone is recorded before any cutoff logic ships."
    // Nothing in the conversation modules may compute one.
    const dir = path.join(ROOT, "lib/couranr/conversations");
    for (const file of readdirSync(dir)) {
      const src = readFileSync(path.join(dir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      expect(src, `${file} must not name a timezone`).not.toMatch(/America\/|UTC[+-]|toLocaleString/);
      expect(src, `${file} must not implement operating hours`).not.toMatch(
        /getDay\(\)|operatingHours|OPERATING_HOURS|nextOperatingPeriod/
      );
    }
  });

  it("next_operating_period_at exists in the schema but is never written", () => {
    expect(flat(SQL)).toContain("next_operating_period_at");
    expect(COMMANDS).not.toContain("next_operating_period_at");
  });
});

/* ═══════════════════════ the write path's obligations ═════════════════════ */

describe("the message write discharges Master Package:490", () => {
  it("checks the participant before writing", () => {
    const body = functionBody(COMMANDS, "export async function sendMessage");
    expect(body).toContain("resolveParticipant");
    expect(body.indexOf("resolveParticipant")).toBeLessThan(body.indexOf(".insert("));
  });

  it("is idempotent, and the replay returns an id rather than a row", () => {
    expect(flat(SQL)).toContain("unique (conversation_id, idempotency_key)");
    const send = functionBody(COMMANDS, "export async function sendMessage");
    // `returning *` on a replay would hand back ANOTHER actor's message.
    expect(send).toContain('.select("id")');
    expect(send).not.toMatch(/\.select\(\s*"\*"\s*\)/);
  });

  it("audits, and the audit cannot become a second copy of the body", () => {
    expect(COMMANDS).toContain("recordEvent");
    expect(flat(SQL)).toContain("couranr_cve_no_body_chk");
    // jsonb ? tests top-level keys only; the check must walk the document.
    expect(flat(SQL)).toContain("jsonb_path_query(p_doc, '$.**')");
  });

  it("enqueues for the assistant AFTER the write, and cannot be failed by it", () => {
    const body = functionBody(COMMANDS, "export async function sendMessage");
    expect(body.indexOf(".insert(")).toBeLessThan(body.indexOf("enqueueForAssistant"));
    // "AI failure must not block manual support, payment, fulfillment, proof,
    // tracking, authorized refunds, or state commands."
    expect(functionBody(COMMANDS, "async function enqueueForAssistant")).toContain("recordEvent");
  });

  it("refuses caller input with invalid_input, never CR422", () => {
    // CR422 maps to `internal` and therefore HTTP 500 — a refusal reported as a
    // server fault. Caller input must never take that path.
    expect(functionBody(COMMANDS, "export async function sendMessage")).toContain('code: "invalid_input"');
    expect(COMMANDS).not.toContain("CR422");
  });

  it("refuses a viewer or billing member, mirroring DRP-001", () => {
    expect([...CONVERSATION_POST_ROLES]).toEqual(["owner", "manager", "dispatcher"]);
    expect(memberMayPost("owner")).toBe(true);
    expect(memberMayPost("manager")).toBe(true);
    expect(memberMayPost("dispatcher")).toBe(true);
    expect(memberMayPost("viewer")).toBe(false);
    expect(memberMayPost("billing")).toBe(false);
    expect(memberMayPost(null)).toBe(false);
    expect(memberMayPost("admin")).toBe(false);
  });

  it("does not distinguish 'not yours' from 'does not exist'", () => {
    // Two different refusals would be an existence oracle over conversation ids.
    expect(functionBody(COMMANDS, "export async function resolveParticipant")).toContain(
      "That conversation is not available."
    );
  });
});

/* ══════════════════════ a message mutates nothing ═════════════════════════ */

describe("a message never directly mutates delivery state", () => {
  it("the union of both authorities' forbidden lists is eight items", () => {
    // Master Package names payer; UI_SCREEN_REGISTRY MER-012 names refund.
    // Neither list is a superset of the other.
    expect([...MESSAGE_MAY_NOT_MUTATE].sort()).toEqual([
      "address",
      "cancellation",
      "payer",
      "price",
      "proof",
      "refund",
      "return",
      "state",
    ]);
  });

  it("the command module writes to no table that could effect one", () => {
    const FORBIDDEN_TABLES = [
      "couranr_deliveries",
      "couranr_delivery_requests",
      "couranr_payment_obligations",
      "couranr_delivery_assignments",
      "couranr_service_plans",
      "couranr_delivery_proofs",
      "addresses",
    ];
    const offenders: string[] = [];
    for (const table of FORBIDDEN_TABLES) {
      // Any .from("<table>") followed by a mutation within a short window.
      const re = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)([\\s\\S]{0,200})`, "g");
      for (const m of COMMANDS.matchAll(re)) {
        if (/\.\s*(update|upsert|insert|delete)\s*\(/.test(m[1])) offenders.push(table);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the only tables it writes are the four conversation tables", () => {
    const written = new Set<string>();
    for (const m of COMMANDS.matchAll(
      /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)([\s\S]{0,200})/g
    )) {
      if (/\.\s*(update|upsert|insert|delete)\s*\(/.test(m[2])) written.add(m[1]);
    }
    expect([...written].sort()).toEqual([
      "couranr_conversation_events",
      "couranr_conversation_messages",
      "couranr_conversation_participants",
      "couranr_conversations",
    ]);
  });
});

/* ════════════════════════════ positive controls ═══════════════════════════ */

describe("POSITIVE CONTROLS — these assertions can actually fail", () => {
  it("canSee would reject a wrong mapping", () => {
    // If canSee returned true for everything, the truth table above would pass
    // for the CAN rows and fail for the CANNOT rows. Prove a CANNOT is real.
    expect(canSee("merchant", "couranr_internal")).toBe(false);
    expect(canSee("driver", "merchant_and_couranr")).toBe(false);
    expect(canSee("customer", "driver_and_couranr")).toBe(false);
  });

  it("the projection genuinely drops rows rather than returning them empty", () => {
    const rows = [msg({ id: "a" }), msg({ id: "b", visibility: "couranr_internal" })];
    expect(toParticipantThread(rows, "merchant")).toHaveLength(1);
    expect(toParticipantThread(rows, "operations")).toHaveLength(2);
  });

  it("the forbidden-key scan would catch a leak if one were introduced", () => {
    // Feed the scanner an object that DOES contain a forbidden key and confirm
    // the detection logic fires. Without this the matrix test above could be
    // passing because the scan is broken.
    const leaky = JSON.stringify({ id: "x", visibility: "couranr_internal" });
    const hit = CONVERSATION_PROJECTION_FORBIDDEN_KEYS.some((k) => leaky.includes(`"${k}"`));
    expect(hit).toBe(true);
  });
});

/* ═══════════════ regressions found by adversarial review ══════════════════ */

describe("REGRESSIONS — defects adversarial review found in this slice", () => {
  const FIX_NAME = "20260804170000_couranr_conversation_kind_and_tenure.sql";
  const FIX = stripSql(readFileSync(path.join(MIGRATIONS, FIX_NAME), "utf8"));

  it("the correction migration is present in the sequence", () => {
    expect(readdirSync(MIGRATIONS)).toContain(FIX_NAME);
  });

  /**
   * CRITICAL. `couranr_conversations.kind` was mutable, and both matrix gates
   * are write-time triggers on the PARTICIPANT and MESSAGE tables. So one
   * `update ... set kind = 'delivery_chat'` on a delivery_help thread stranded
   * the existing customer participant, after which a driver and a merchant
   * could be inserted cleanly — and the sanctioned reader handed the customer's
   * gate code to both. The migration claimed this was "a SCHEMA property rather
   * than a convention"; it was not.
   */
  it("a conversation kind cannot change", () => {
    const sql = flat(FIX);
    expect(sql).toContain("before update of kind on public.couranr_conversations");
    expect(sql).toContain("new.kind is distinct from old.kind");
    // CR403 -> not_permitted. A refusal, not a 500.
    expect(sql).toContain("errcode = 'cr403'");
  });

  /**
   * HIGH. `m.created_at >= p.joined_at` was documented as a driver rule but
   * carried no participant_kind qualifier, so it windowed merchants, Operations
   * and customers too. Operations escalated into an existing thread read ZERO
   * messages while the merchant in the same thread read two — which defeats
   * OPS-005's stated purpose of unifying conversations.
   */
  it("the tenure window applies to drivers ONLY", () => {
    expect(flat(FIX)).toContain(
      "(p.participant_kind <> 'driver' or m.created_at >= p.joined_at)"
    );
  });

  it("the driver window is still enforced, not merely removed", () => {
    // The fix must narrow the rule, not delete it. A driver reassigned onto a
    // delivery must not receive the history of someone else's.
    const sql = flat(FIX);
    expect(sql).toContain("m.created_at >= p.joined_at");
    expect(sql).toContain("p.participant_kind <> 'driver'");
  });

  /**
   * The customer's reader must NOT be windowed at all. A Delivery Help token
   * rotates, and a new token means a new participant row with a later
   * joined_at — windowing would hide the customer's own earlier messages from
   * them the moment their link was reissued.
   */
  it("the Delivery Help reader is not windowed by joined_at", () => {
    const help = stripSql(
      readFileSync(path.join(MIGRATIONS, "20260804160000_couranr_delivery_help.sql"), "utf8")
    );
    const fn = flat(help);
    const body = fn.slice(fn.indexOf("function public.couranr_help_thread"));
    const upTo = body.slice(0, body.indexOf("$$;"));
    expect(upTo).not.toContain("m.created_at >= p.joined_at");
    // It must still exclude drafts and non-participant visibility.
    expect(upTo).toContain("m.authorship <> 'ai_draft'");
    expect(upTo).toContain("m.visibility = 'participants'");
  });
});

/* ═══════════ defects found reviewing this slice's own work ════════════════ */

describe("SELF-REVIEW — defects found reviewing the messaging screens", () => {
  /**
   * `unreadCount` meant three different things under one name: a genuine count
   * in readThread, a 1-or-0 boolean in listConversations, and a hardcoded 0 in
   * listOperationsInbox. All three flowed into one exported summary shape, so a
   * caller rendering "you have N unread" would have got a real count on one
   * screen, always "1" on another and always "0" on the third.
   */
  it("the conversation SUMMARY carries a boolean, not a fake count", () => {
    const summary = COMMANDS.slice(COMMANDS.indexOf("export type ConversationSummary"));
    const shape = summary.slice(0, summary.indexOf("};"));
    expect(shape).toContain("hasUnread: boolean");
    expect(shape, "a summary must not claim to carry a count it cannot compute").not.toMatch(
      /unreadCount\s*:\s*number/
    );
  });

  it("no summary is built with a 1-or-0 standing in for a count", () => {
    expect(COMMANDS).not.toMatch(/unreadCount:\s*!?[A-Za-z.]+\s*\?\s*1\s*:\s*0/);
    expect(COMMANDS).not.toMatch(/unreadCount:\s*0\s*,/);
  });

  it("readThread still returns a GENUINE count", () => {
    // The one place a count is honest: those messages have already passed the
    // visibility rule, so counting them cannot reveal an invisible message.
    const body = functionBody(COMMANDS, "export async function readThread");
    expect(body).toContain("unreadCount");
    expect(body).toMatch(/\.filter\([\s\S]*?\)\.length/);
  });

  /**
   * `refreshDueStates` awaited one UPDATE per changed row inside its loop, and
   * runs on every Operations inbox GET. A busy queue meant hundreds of
   * sequential round trips inside a request a person is waiting on, and two
   * operators opening the inbox duplicated the whole pass.
   */
  it("due-state writes are batched, not one round trip per row", () => {
    const body = functionBody(COMMANDS, "export async function refreshDueStates");

    // Must address rows in sets.
    expect(body).toMatch(/\.in\(\s*["']id["']\s*,/);

    // And must NOT await an update inside a loop over the fetched rows.
    const rowLoop = body.slice(body.indexOf("for (const c of rows.data"));
    const untilNextLoop = rowLoop.slice(0, rowLoop.indexOf("for (const ["));
    expect(
      untilNextLoop,
      "an update inside the per-row loop is the amplification this fixes"
    ).not.toContain(".update(");
  });

  it("the batched update is bounded by the number of due states, not rows", () => {
    const body = functionBody(COMMANDS, "export async function refreshDueStates");
    // One update per target state — at most three, whatever the row count.
    const updates = [...body.matchAll(/\.update\(/g)];
    expect(updates.length).toBe(1);
  });
});

/* ══════════════════ the test helper needs its own test ════════════════════ */

describe("functionBody — the helper four assertions depend on", () => {
  /**
   * This helper has been wrong THREE times in this file's history, each time
   * silently: it returned a slice that did not contain the code being asserted
   * about, so the assertion passed while inspecting the wrong text.
   *
   *   1. `slice(start, indexOf("\n}"))` truncated at a nested block.
   *   2. `indexOf("{")` grabbed the destructured PARAMETER type.
   *   3. `indexOf("{")` after the parameter list grabbed the RETURN type in
   *      `Promise<ConversationResult<{ dueSoon: number }>>`.
   *
   * Each was caught only by an assertion failing for an unrelated reason. A
   * helper with that record does not get to be untested.
   */
  const SAMPLE = `
export async function alpha(params: { a: string; b: number }): Promise<Result<{ x: number }>> {
  const inner = { nested: true };
  if (inner.nested) {
    return { ok: true };
  }
  return MARKER_ALPHA;
}

export function beta() {
  return MARKER_BETA;
}
`;

  it("returns the BODY, not the parameter object", () => {
    const body = functionBody(SAMPLE, "export async function alpha");
    expect(body).toContain("MARKER_ALPHA");
    expect(body, "the parameter type is not the body").not.toContain("a: string; b: number");
  });

  it("returns the BODY, not the return-type annotation", () => {
    const body = functionBody(SAMPLE, "export async function alpha");
    expect(body, "the return type is not the body").not.toContain("Result<");
  });

  it("spans the WHOLE body, past nested blocks that close in column 0", () => {
    const body = functionBody(SAMPLE, "export async function alpha");
    // A truncating slice would stop at the `if` block and miss the last return.
    expect(body).toContain("MARKER_ALPHA");
    expect(body).toContain("nested: true");
  });

  it("does not run past the end of the function it was asked for", () => {
    const body = functionBody(SAMPLE, "export async function alpha");
    expect(body, "beta's body must not be included").not.toContain("MARKER_BETA");
  });

  it("returns empty rather than a wrong slice when the declaration is absent", () => {
    expect(functionBody(SAMPLE, "export function gamma")).toBe("");
  });
});

/* ═════════ hardening: defects from the full adversarial verification ══════ */

describe("HARDENING — defects the adversarial verification confirmed", () => {
  const HARDEN_NAME = "20260804180000_couranr_conversation_hardening.sql";
  const HARDEN = stripSql(readFileSync(path.join(MIGRATIONS, HARDEN_NAME), "utf8"));

  it("every trigger function is revoked from anon and authenticated", () => {
    // 20260804150000 revokes its three HELPER functions and says in a comment
    // that the revoke is load-bearing because pg_default_acl grants EXECUTE on
    // every new public function. It then missed the two TRIGGER functions it
    // created in the same file, and 170000 missed the third.
    const sql = flat(HARDEN);
    for (const fn of [
      "couranr_cvp_enforce_kind()",
      "couranr_cvm_enforce_visibility()",
      "couranr_cv_kind_immutable()",
      "couranr_cvp_tenure_monotone()",
    ]) {
      expect(sql, `${fn} must be revoked`).toContain(
        `revoke all on function public.${fn} from public, anon, authenticated`
      );
    }
  });

  it("participant tenure can only ever narrow", () => {
    const sql = flat(HARDEN);
    expect(sql).toContain("before update of left_at, joined_at");
    // Reopening a departed row kept its ORIGINAL joined_at, so a driver
    // unassigned and reopened read the whole history of a delivery that was
    // someone else's while they were away.
    expect(sql).toContain("old.left_at is not null and new.left_at is null");
    expect(sql).toContain("new.joined_at < old.joined_at");
  });

  it("authorship is tied to the message's own conversation", () => {
    const sql = flat(HARDEN);
    expect(sql).toContain("unique (id, conversation_id)");
    expect(sql).toContain("foreign key (author_participant_id, conversation_id)");
  });

  it("the audit guard is an ALLOW-list with a value cap, not a key denylist", () => {
    // A denylist of five key names cannot be complete: `{"topic": "<the entire
    // message>"}` passed the old one, verified on a live cluster. An allow-list
    // is complete by construction, and the length cap stops an allowed key from
    // carrying 4000 characters of body.
    const sql = flat(HARDEN);
    expect(sql).toContain("couranr_jsonb_audit_shape_ok");
    expect(sql).toContain("<> all (select lower(x) from unnest(p_keys) x)");
    expect(sql).toContain("length(node #>> '{}') > p_max_len");
  });

  it("the original denylist CHECK is kept alongside, not replaced", () => {
    // Two cheap independent checks beat one clever one.
    expect(flat(SQL)).toContain("couranr_cve_no_body_chk");
    expect(flat(HARDEN)).toContain("couranr_cve_audit_shape_chk");
    expect(flat(HARDEN), "the denylist must not be dropped").not.toContain(
      "drop constraint if exists couranr_cve_no_body_chk"
    );
  });

  it("every migration in THIS slice has a paired rollback", () => {
    // Not a repo-wide rule: 20 migrations predating this slice have no
    // rollback. This asserts consistency within the slice, which shipped
    // 150000 with one and then 160000 and 170000 without.
    const files = readdirSync(MIGRATIONS);
    const mine = files.filter(
      (f) =>
        /^202608041[5-8]0000_/.test(f) && f.endsWith(".sql") && !f.includes(".rollback.")
    );
    expect(mine.length, "the slice's migrations must be found").toBe(4);
    const missing = mine.filter(
      (f) => !files.includes(f.replace(/\.sql$/, ".rollback.sql"))
    );
    expect(missing).toEqual([]);
  });
});
