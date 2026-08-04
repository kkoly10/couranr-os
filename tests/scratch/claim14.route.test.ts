/**
 * CLAIM 14 reproduction THROUGH THE REAL ROUTE HANDLER.
 *
 * The route module, lib/couranr/conversations/help.ts, the topic/body
 * validation and the SQL functions are all the real shipped code. The ONLY
 * substitution is the transport: `supabaseAdmin.rpc` is relayed to the live
 * local cluster via psql instead of PostgREST, because this container has no
 * PostgREST. Every RPC below really executes against PostgreSQL 16.13.
 */
import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";

function sql(text: string): any {
  const out = execFileSync(
    "psql",
    ["-h", "127.0.0.1", "-p", "5433", "-U", "postgres", "-d", "postgres", "-t", "-A", "-c", text],
    { env: { ...process.env, PGPASSWORD: "postgres" }, encoding: "utf8" }
  );
  return out.trim();
}

function lit(v: any) {
  if (v === null || v === undefined) return "null";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    async rpc(fn: string, args: Record<string, any>) {
      const order =
        fn === "couranr_help_post_message"
          ? ["p_token_id", "p_body", "p_topic", "p_idempotency_key"]
          : Object.keys(args);
      const call = `${fn}(${order.map((k) => `${k} => ${lit(args[k])}`).join(", ")})`;
      try {
        if (fn === "couranr_help_thread") {
          const j = sql(`select coalesce(jsonb_agg(t), '[]'::jsonb) from public.${call} t`);
          return { data: JSON.parse(j), error: null };
        }
        const scalar = sql(`select public.${call}`);
        return { data: scalar === "" ? null : scalar, error: null };
      } catch (e: any) {
        const msg = String(e.stderr || e.message);
        const code = /SQLSTATE|ERROR:/.test(msg) ? (msg.match(/CR\d{3}/)?.[0] ?? "P0001") : "P0001";
        return { data: null, error: { code, message: msg } };
      }
    },
  },
}));

// redeemHelpToken hashes the raw token; seed a token whose hash we control.
const RAW = "claim14relaytokenclaim14relaytokenclaim14relay";
const CONV = "ee000000-0000-0000-0000-0000000000c5";

describe("CLAIM 14 through the real POST handler", () => {
  it("returns 201 with the internal note's id and writes nothing", async () => {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha256").update(RAW, "utf8").digest("hex");
    // Point a fresh, well-formed token at the SAME participant row as the fixture.
    sql(`update public.couranr_help_access_tokens set token_hash=${lit(hash)},
           expires_at = now() + interval '14 days', revoked_at = null
         where id='0037b9e5-9563-4e12-86d1-74d2706508bd'`);

    const before = sql(`select count(*) from public.couranr_conversation_messages where conversation_id='${CONV}'`);
    const beforeEv = sql(`select count(*) from public.couranr_conversation_events
                          where conversation_id='${CONV}' and metadata->>'via'='delivery_help'`);

    const { POST } = await import("@/app/api/couranr/help/[token]/route");
    const req: any = {
      json: async () => ({
        body: "THE DRIVER IS AT THE WRONG HOUSE, PLEASE STOP HIM",
        topic: "handoff_concern",
        idempotencyKey: "ops-internal-key-001",
      }),
    };
    const res = await POST(req, { params: { token: RAW } });
    const json = await res.json();

    const after = sql(`select count(*) from public.couranr_conversation_messages where conversation_id='${CONV}'`);
    const afterEv = sql(`select count(*) from public.couranr_conversation_events
                         where conversation_id='${CONV}' and metadata->>'via'='delivery_help'`);
    const row = sql(`select jsonb_build_object('visibility',visibility,'authorship',authorship,'body',left(body,40))
                     from public.couranr_conversation_messages where id=${lit(json.messageId)}`);

    console.log("### POST status:", res.status, "returned:", JSON.stringify(json));
    console.log("### messages before:", before, "after:", after);
    console.log("### delivery_help audit events before:", beforeEv, "after:", afterEv);
    console.log("### the row whose id was handed to the customer:", row);

    expect(res.status).toBe(201);
    expect(json.messageId).toBe("8015a399-fb43-491c-88ef-7987386cde65");
    expect(after).toBe(before);
    expect(afterEv).toBe(beforeEv);
  });
});
