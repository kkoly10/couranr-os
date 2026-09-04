import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

const SQL = read("supabase/migrations/20260904224500_couranr_driver_pilot_d2_messaging.sql");
const COMMANDS = read("lib/couranr/conversations/commands.ts");
const OPS_THREAD = read("app/api/couranr/operations/conversations/[id]/route.ts");
const OPS_SEND = read("app/api/couranr/operations/conversations/[id]/messages/route.ts");
const GENERIC_THREAD = read("app/api/couranr/conversations/[id]/route.ts");
const CLIENT = read("components/couranr/conversations/client.ts");
const THREAD = read("components/couranr/conversations/ConversationThread.tsx");
const INBOX = read("components/couranr/conversations/OperationsInbox.tsx");

describe("D2 delivery-chat issuance", () => {
  it("issues one chat only after a canonical BUSINESS delivery row exists", () => {
    expect(SQL).toContain("couranr_ensure_delivery_chat");
    expect(SQL).toContain("from public.couranr_deliveries d");
    expect(SQL).toContain("where d.id = p_delivery_id");
    expect(SQL).toContain("on conflict (delivery_id, kind) where delivery_id is not null");
    expect(SQL).toContain("'delivery_chat'");
    expect(SQL).toContain("if v_business_account_id is null then");
    expect(SQL).toContain("return null;");
    expect(SQL).toContain("where d.business_account_id is not null");
  });

  it("joins only TRM-002-authorized active merchant roles", () => {
    expect(SQL).toContain("bm.status = 'active'");
    expect(SQL).toContain("bm.role in ('owner','manager','dispatcher')");
    expect(SQL).not.toMatch(/bm\.role in \([^)]*viewer/);
    expect(SQL).not.toMatch(/bm\.role in \([^)]*billing/);
  });

  it("makes assignment tenure drive driver participation", () => {
    expect(SQL).toContain("couranr_join_assignment_delivery_chat");
    expect(SQL).toContain("couranr_leave_assignment_delivery_chat");
    expect(SQL).toContain("after insert or update of assignment_state, ended_at, driver_id");
    expect(SQL).toContain("new.assignment_state = 'active'");
    expect(SQL).toContain("old.assignment_state = 'active'");
    expect(SQL).toContain("set left_at = greatest");
  });

  it("never lets a messaging-hook failure roll back delivery or assignment truth", () => {
    expect(SQL).toMatch(
      /couranr_delivery_chat_after_delivery[\s\S]*?exception when others then[\s\S]*?raise warning/
    );
    expect(SQL).toMatch(
      /couranr_delivery_chat_assignment_tenure[\s\S]*?exception when others then[\s\S]*?raise warning/
    );
    expect(SQL).toContain("couranr_reconcile_delivery_chats");
  });
});

describe("D2 dual-role Operations boundary", () => {
  it("stores the real Operations human without inventing a shared participant", () => {
    expect(SQL).toContain("add column if not exists author_user_id uuid references auth.users(id)");
    expect(SQL).toContain("p.role = 'admin'");
    expect(SQL).toContain("new.author_participant_id is null and new.author_user_id is not null");
    expect(SQL).toContain("couranr_cvm_human_author_identity_chk");
    const issuance = SQL.slice(SQL.indexOf("couranr_ensure_delivery_chat"));
    expect(issuance).not.toMatch(/participant_kind[\s\S]{0,100}'operations'/);
  });

  it("Operations reads through an admin-verified RPC, not a participant row", () => {
    expect(SQL).toContain("couranr_operations_conversation_thread");
    expect(SQL).toContain("p.role = 'admin'");
    const opRead = COMMANDS.slice(
      COMMANDS.indexOf("export async function readOperationsThread"),
      COMMANDS.indexOf("/* ------------------------------------------------------------- listing */")
    );
    expect(opRead).toContain("RPC.operationsThread");
    expect(opRead).not.toContain("resolveParticipant");
    expect(opRead).toContain('viewerKind: "operations"');
  });

  it("Operations sends with author_user_id while participant sends remain unchanged", () => {
    const opSend = COMMANDS.slice(
      COMMANDS.indexOf("export async function sendOperationsMessage"),
      COMMANDS.indexOf("/* ----------------------------------------------------------------- audit */")
    );
    expect(opSend).toContain("author_participant_id: null");
    expect(opSend).toContain("author_user_id: params.userId");
    expect(opSend).toContain('actorKind: "operations"');
    expect(opSend).toContain("ops:\${params.userId}:\${rawKey}");

    const participantSend = COMMANDS.slice(
      COMMANDS.indexOf("export async function sendMessage"),
      COMMANDS.indexOf("export async function sendOperationsMessage")
    );
    expect(participantSend).toContain("author_participant_id: participant.value.id");
    expect(participantSend).not.toContain("author_user_id: params.userId");
  });

  it("the Operations HTTP surface is explicitly role-gated", () => {
    for (const route of [OPS_THREAD, OPS_SEND]) {
      expect(route).toContain("resolveRequestActor(req, null)");
      expect(route).toContain('actor.actor.kind !== "operations"');
    }
    expect(GENERIC_THREAD).toContain("resolveUserId");
    expect(GENERIC_THREAD).not.toContain("resolveRequestActor(req, null)");
  });

  it("the inbox opens the Operations route while merchant/driver keep participant routes", () => {
    expect(INBOX).toContain('context="operations"');
    expect(THREAD).toContain('context === "operations"');
    expect(THREAD).toContain("readOperationsThread");
    expect(THREAD).toContain("sendOperationsMessage");
    expect(CLIENT).toContain("/api/couranr/operations/conversations/");
    expect(CLIENT).toContain("/api/couranr/conversations/");
  });
});

describe("D2 scope controls", () => {
  it("does not add customer-driver chat, a marketplace, or a second delivery lifecycle", () => {
    expect(SQL).toContain("Consumer deliveries intentionally have no merchant participant and no");
    expect(SQL).not.toMatch(/participant_kind\s*=\s*'customer'/);
    expect(SQL).not.toMatch(/\b(gig|marketplace|bid|earnings|surge)\b/i);
    expect(SQL).not.toMatch(/insert into public\.couranr_deliveries/);
    expect(SQL).not.toMatch(/update public\.couranr_deliveries\s+set\s+fulfillment_state/i);
  });

  it("reconciles existing canonical deliveries including Pilot #1 without recreating them", () => {
    expect(SQL).toContain("select * from public.couranr_reconcile_delivery_chats()");
    expect(SQL).not.toContain("3727b5d5-96b6-41e2-96d1-71b92913da96");
    expect(SQL).not.toContain("ba21db8e-2cfa-4ab6-98bc-75d890d9faed");
  });
});
