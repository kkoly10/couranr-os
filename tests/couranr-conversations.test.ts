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

  const open = src.indexOf("{", i);
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
    // `returns table (...)` declares OUT parameters, and an OUT parameter whose
    // name collides with a column raises 42702 at call time. That shipped a
    // payment function dead in this repo once already.
    const sql = flat(SQL);
    expect(sql).toContain("returns setof public.couranr_conversation_messages");
    expect(sql).not.toMatch(/create\s+or\s+replace\s+function\s+public\.couranr_conversation_thread[\s\S]*?returns\s+table/);
  });

  it("the reader excludes ai_draft unconditionally and windows by tenure", () => {
    const sql = flat(SQL);
    expect(sql).toContain("m.authorship <> 'ai_draft'");
    expect(sql).toContain("m.created_at >= p.joined_at");
    expect(sql).toContain("p.left_at is null");
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
    const sql = flat(SQL);
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
