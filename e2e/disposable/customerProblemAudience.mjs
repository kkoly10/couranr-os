/**
 * CUS-004 audience-isolation acceptance.
 * Sender and recipient Help credentials may refer to the same delivery, but
 * their reports/evidence are private audience-scoped cases. Real SQL only.
 */
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { up, down, psql } from "./up.mjs";
import { psqlTransport, seedCanonicalDeliveryChain } from "./gateAFixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rollback = readFileSync(
  path.join(ROOT, "supabase/rollbacks/20260926013000_couranr_customer_problem_audience_isolation.rollback.sql"),
  "utf8"
);
const sql = (q) => psql(q).trim();
const hash = (s) => crypto.createHash("sha256").update(s).digest("hex");
let checks = 0;
function check(name, actual, expected) {
  checks++;
  if (String(actual) !== String(expected)) throw new Error(`${name}: expected ${expected}, got ${actual}`);
}
function refuses(name, query, fragment) {
  checks++;
  try { psql(query); throw new Error(`${name}: unexpectedly succeeded`); }
  catch (e) { if (!String(e.message).includes(fragment)) throw e; }
}

async function main() {
  try {
    const info = up({ quiet: true });
    console.log(`customer problem audience: ${info.migrationsApplied} migrations applied`);
    const business = sql("insert into public.business_accounts(name,status) values ('Audience business','active') returning id");
    const actor = sql("insert into auth.users(email) values ('audience-owner@example.test') returning id");
    const chain = await seedCanonicalDeliveryChain(psqlTransport(psql), {
      businessId: business, actorUserId: actor, marker: "audience-scope", recipientName: "Audience recipient",
    });
    const makeToken = (audience) => {
      const raw = crypto.randomBytes(32).toString("base64url");
      return { raw, id: sql(`insert into public.couranr_help_access_tokens
        (token_hash,delivery_id,business_account_id,expires_at,audience)
        values ('${hash(raw)}','${chain.deliveryId}','${business}',now()+interval '14 days','${audience}') returning id`) };
    };
    const sender = makeToken("sender");
    const recipient = makeToken("recipient");
    sql(`select * from public.couranr_redeem_help_token('${hash(sender.raw)}')`);
    sql(`select * from public.couranr_redeem_help_token('${hash(recipient.raw)}')`);
    const senderReport = sql(`select id from public.couranr_save_customer_problem_draft('${sender.id}','damaged','sender private report')`);
    const recipientReport = sql(`select id from public.couranr_save_customer_problem_draft('${recipient.id}','missing','recipient private report')`);
    check("two audiences produce two reports", senderReport === recipientReport, false);
    check("sender view sees only sender report", sql(`select count(*) from public.couranr_customer_problem_report_view('${sender.id}')`), 1);
    check("recipient view sees only recipient report", sql(`select count(*) from public.couranr_customer_problem_report_view('${recipient.id}')`), 1);
    check("sender report stores sender boundary", sql(`select customer_audience from public.couranr_customer_problem_reports where id='${senderReport}'`), "sender");
    check("recipient report stores recipient boundary", sql(`select customer_audience from public.couranr_customer_problem_reports where id='${recipientReport}'`), "recipient");
    refuses("recipient cannot collect sender evidence",
      `select * from public.couranr_collect_expired_customer_problem_evidence('${recipient.id}','${senderReport}')`,
      "problem_report_not_found");
    refuses("recipient cannot submit sender report",
      `select id from public.couranr_submit_customer_problem_report('${recipient.id}','${senderReport}','wrong-audience')`,
      "problem_report_not_found");
    const sender2 = makeToken("sender");
    sql(`select * from public.couranr_redeem_help_token('${hash(sender2.raw)}')`);
    const replay = sql(`select id from public.couranr_save_customer_problem_draft('${sender2.id}','damaged','same sender audience, reissued help token')`);
    check("same-audience reissue resumes sender case", replay, senderReport);

    const sharedClientKey = "same-client-generated-submit-key";
    check(
      "sender can submit its report with a client key",
      sql(`select id from public.couranr_submit_customer_problem_report('${sender2.id}','${senderReport}','${sharedClientKey}')`),
      senderReport
    );
    check(
      "recipient may independently use the same client key",
      sql(`select id from public.couranr_submit_customer_problem_report('${recipient.id}','${recipientReport}','${sharedClientKey}')`),
      recipientReport
    );

    refuses("rollback refuses after sender/recipient semantic use", rollback,
      "customer_problem_audience_rollback_refuses_semantic_use");
    console.log(`Customer Problem Audience: ${checks} checks PASS (disposable PostgreSQL).`);
  } finally { down({ quiet: true }); }
}
main().catch((e) => { console.error(e?.stack || e); try { down({ quiet: true }); } catch {} process.exit(1); });
