/**
 * PHASE 8 EXECUTABLE ACCEPTANCE MATRIX.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 *
 * Every database function this slice added or replaced is INVOKED here against
 * a real PostgreSQL with synthetic fixtures. Static tests supplement this; they
 * do not replace it.
 *
 * That rule was written in blood. A foreign key on
 * couranr_conversation_participants pointed at couranr_delivery_access_tokens
 * while couranr_redeem_help_token inserted a couranr_help_access_tokens id, so
 * every Delivery Help redemption failed — and it survived 1230 passing tests, a
 * 35-migration round trip, and a browser run, because every check was static:
 * SQL text assertions, source scans, and a browser run whose API layer was
 * stubbed. A constraint that only fires on INSERT is invisible to all of them.
 *
 * ---------------------------------------------------------------------------
 * TWO TARGETS, TWO DIFFERENT GUARANTEES
 * ---------------------------------------------------------------------------
 *
 * PROJECT MODE (the default) runs against the CONNECTED PROJECT, which holds
 * real data. Therefore:
 *
 *   * every row created here carries the marker [P8ACC] in a name field;
 *   * NOTHING REAL IS EVER MUTATED — no update, no delete, no repurposing of an
 *     existing row. Only new rows, only next to the real ones;
 *   * a PREFLIGHT refuses to seed anything the harness could not remove;
 *   * cleanup runs in a finally block and reports anything it could not remove;
 *   * real-row counts are taken before and after and asserted equal;
 *   * the service key is read from .env.local, used only in Node, and never
 *     passed to the browser, a URL, a log line or a screenshot.
 *
 * That protection is also why this file was DISARMED: `service_role` holds
 * DELETE on no `couranr_*` table — they are append-only by design — so the
 * preflight refuses, correctly, and the matrix could not be re-run on demand.
 *
 * DISPOSABLE MODE (`E2E_DISPOSABLE=1`) runs against a database that was created
 * empty and is destroyed afterwards, so cleanup is `rm -rf` rather than a
 * privilege — and the fix is a throwaway database rather than a production
 * DELETE grant or the proposed cleanup migration. In that mode the preflight
 * and the cleanup are replaced by ONE assertion that actually matters there:
 * that the target is not a Supabase-hosted project. Everything between the
 * fixtures and the teardown — every check — is identical in both modes.
 *
 * Run against the project:     node e2e/phase8Acceptance.mjs
 *                              (expects `npm run dev` on :3000)
 * Run disposable, end to end:  node e2e/disposable/acceptanceMatrix.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  gateAIntegrityIssues,
  seedCanonicalDeliveryChain,
  supabaseTransport,
} from "./disposable/gateAFixtures.mjs";

const MARK = "[P8ACC]";
const SHOTS = path.resolve("e2e/artifacts/phase8-acceptance");

/* ───────────────────────────── harness ─────────────────────────────────── */

const results = [];
function check(id, name, ok, detail = "") {
  results.push({ id, name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}
const redact = (s) => String(s).replace(/[A-Za-z0-9_-]{40,}/g, "<redacted>");

/**
 * Where to point.
 *
 * Explicit env wins so a disposable driver can pass its own stack without
 * writing a `.env.local` — which would be a file with a service key in it, and
 * the harness that reads one is the harness that leaks one.
 */
function env() {
  if (process.env.E2E_SUPABASE_URL && process.env.E2E_SUPABASE_SERVICE_KEY) {
    return {
      url: process.env.E2E_SUPABASE_URL,
      key: process.env.E2E_SUPABASE_SERVICE_KEY,
    };
  }
  const raw = readFileSync(".env.local", "utf8");
  const get = (k) => {
    const m = raw.match(new RegExp(`^${k}=(.+)$`, "m"));
    if (!m) throw new Error(`${k} missing from .env.local`);
    return m[1].trim();
  };
  return { url: get("NEXT_PUBLIC_SUPABASE_URL"), key: get("SUPABASE_SERVICE_ROLE_KEY") };
}

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const rawToken = () => randomBytes(32).toString("base64url");

/* ───────────────────────────── fixtures ────────────────────────────────── */

/**
 * Builds ONE complete delivery chain.
 *
 * Every NOT NULL and CHECK the schema demands is satisfied — that is not
 * incidental setup, it is the schema stating what a delivery actually requires,
 * and getting it wrong is how the help-token FK defect stayed hidden.
 *
 * Gate A moved that requirement: commercial identity now lives on an immutable
 * `couranr_quote_versions` row, and request, obligation, plan and delivery must
 * all point at the SAME one. Four hand-written inserts can no longer produce a
 * writable chain — the obligation raises CR409 payment_obligation_quote_mismatch
 * before it lands — so the chain is built by the shared fixture builder in
 * e2e/disposable/gateAFixtures.mjs, which drives the current canonical commands.
 *
 * That builder is transport-agnostic on purpose: this file must be able to run
 * against a hosted project, so it reaches the commands through supabase-js and
 * PostgREST rather than through psql.
 */
async function makeDelivery(sb, label) {
  const business = randomUUID();
  const ids = { business, request: null, obligation: null, plan: null, delivery: null };

  const r = await sb.from("business_accounts").insert({ id: business, name: `${MARK} ${label}` });
  if (r.error) throw new Error(`business: ${r.error.message}`);

  const owner = (await sb.from("profiles").select("id").limit(1).maybeSingle()).data?.id;
  if (!owner) throw new Error("no profile to own the fixture request");

  const chain = await seedCanonicalDeliveryChain(supabaseTransport(sb), {
    businessId: business,
    actorUserId: owner,
    marker: `p8acc-${randomUUID().slice(0, 8)}`,
    recipientName: `${MARK} recipient`,
    pricingPolicyVersion: "couranr-pricing-v2-2026-09-01",
  });

  ids.request = chain.requestId;
  ids.obligation = chain.obligationId;
  ids.plan = chain.planId;
  ids.delivery = chain.deliveryId;
  return ids;
}

async function cleanup(sb, chains) {
  const left = [];
  for (const ids of chains.reverse()) {
    const drop = async (label, fn) => {
      const { error } = await fn();
      if (error) left.push(`${label}: ${error.message}`);
    };
    if (ids.delivery) {
      await drop("conversations", () =>
        sb.from("couranr_conversations").delete().eq("delivery_id", ids.delivery));
      await drop("help tokens", () =>
        sb.from("couranr_help_access_tokens").delete().eq("delivery_id", ids.delivery));
      await drop("delivery", () =>
        sb.from("couranr_deliveries").delete().eq("id", ids.delivery));
    }
    if (ids.plan) await drop("plan", () => sb.from("couranr_service_plans").delete().eq("id", ids.plan));
    if (ids.obligation)
      await drop("obligation", () => sb.from("couranr_payment_obligations").delete().eq("id", ids.obligation));
    if (ids.request) {
      await drop("request events", () =>
        sb.from("couranr_delivery_request_events").delete().eq("request_id", ids.request));
      await drop("request", () => sb.from("couranr_delivery_requests").delete().eq("id", ids.request));
    }
    if (ids.business)
      await drop("business", () => sb.from("business_accounts").delete().eq("id", ids.business));
  }
  return left;
}

/* ─────────────────────────────── the matrix ─────────────────────────────── */

export async function main() {
  const { url, key } = env();
  const BASE = process.env.E2E_BASE_URL || "http://localhost:3000";
  const disposable = process.env.E2E_DISPOSABLE === "1";
  const sb = createClient(url, key, { auth: { persistSession: false } });

  // The one assertion that matters in disposable mode, made BEFORE anything is
  // written: a database that is about to be destroyed must not be a hosted
  // project. `E2E_DISPOSABLE=1` turns off the cleanup guarantees, so pointing it
  // at the connected project would disarm exactly the protection this file
  // exists to provide.
  if (disposable) {
    const host = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return "";
      }
    })();
    const local = host === "127.0.0.1" || host === "localhost" || host === "::1";
    check("Z0", "disposable mode targets a LOCAL database, never a hosted project", local, host);
    if (!local) {
      console.log("\n  REFUSING TO RUN. E2E_DISPOSABLE=1 against a non-local host.");
      process.exit(1);
    }
  }

  const before = disposable
    ? null
    : {
        orders: (await sb.from("orders").select("id", { count: "exact", head: true })).count,
        deliveries: (await sb.from("deliveries").select("id", { count: "exact", head: true })).count,
        couranrDeliveries: (await sb.from("couranr_deliveries").select("id", { count: "exact", head: true }))
          .count,
      };
  if (before) {
    console.log(`  baseline: ${before.orders} orders / ${before.deliveries} deliveries / ` +
                `${before.couranrDeliveries} couranr_deliveries\n`);
  }

  /**
   * PREFLIGHT: refuse to seed what cannot be removed.
   *
   * The first run passed all 26 behavioural checks and then failed cleanup.
   * `service_role` holds DELETE on `business_accounts` and on NO couranr_ table
   * — they are append-only by design — so two fixture chains were left in a
   * project holding 42 real orders and had to be purged by hand through a
   * privileged path.
   *
   * The first version of this probe tested `business_accounts`, which CAN be
   * deleted, so it passed and the run seeded anyway. It now probes the tables
   * that actually block cleanup.
   */
  const BLOCKERS = [
    "couranr_conversations",
    "couranr_help_access_tokens",
    "couranr_deliveries",
    "couranr_service_plans",
    "couranr_payment_obligations",
    "couranr_delivery_requests",
    // Added with the Gate A fixture cutover. The canonical chain now also
    // writes a couranr_quote_versions row — and couranr_qv_append_only_trg
    // raises on any DELETE, so a request can no longer be removed at all while
    // its quote exists — and couranr_begin_payment_capture appends a
    // couranr_payment_events row whose FK blocks removing the obligation.
    // Probing both here makes the refusal name the real reason instead of the
    // run dying later in cleanup.
    "couranr_quote_versions",
    "couranr_payment_events",
  ];
  const undeletable = [];
  // Skipped in disposable mode, and skipped for a stated reason rather than
  // quietly: the preflight asks "can I remove what I create", and there the
  // answer is `rm -rf` on the whole cluster. Running it would refuse correctly
  // and for the wrong question, since the disposable database reproduces the
  // very grants that make it refuse.
  for (const t of disposable ? [] : BLOCKERS) {
    // A delete matching zero rows still raises 42501 when the grant is absent,
    // so this is a capability probe that touches nothing.
    const r = await sb.from(t).delete().eq("id", randomUUID());
    if (r.error) undeletable.push(`${t} (${r.error.code || r.error.message})`);
  }

  if (undeletable.length > 0) {
    check("P0", "the harness can delete every table it seeds", false, undeletable.join(", "));
    console.log("\n  REFUSING TO SEED.");
    console.log("  This project holds real data and the harness cannot remove what it");
    console.log("  would create. Run against a scratch project, or grant the harness a");
    console.log("  purge path. If a previous run left residue, remove it with:");
    console.log("");
    console.log("    delete from couranr_conversation_events where conversation_id in");
    console.log("      (select id from couranr_conversations c join business_accounts b");
    console.log("        on b.id=c.business_account_id where b.name like '[P8ACC]%');");
    console.log("    -- then messages, participants, conversations, help tokens,");
    console.log("    -- deliveries, service plans, obligations, requests, businesses.");
    process.exit(1);
  }
  if (!disposable) check("P0", "the harness can delete every table it seeds", true);

  const chains = [];
  try {
    const A = await makeDelivery(sb, "chain-A");
    const B = await makeDelivery(sb, "chain-B");
    chains.push(A, B);

    /* A1 — Operations issues a help token, through the real command. */
    const tokA = rawToken();
    const issue = await sb.rpc("couranr_issue_help_token", {
      p_delivery_id: A.delivery, p_token_hash: sha(tokA), p_ttl_days: 1,
    });
    check("A1", "Operations issues a help token", !issue.error && Boolean(issue.data),
      issue.error?.message || "");
    const tokenAId = issue.data;

    /* A2 — the token is scoped to exactly one delivery. */
    const scope = await sb.from("couranr_help_access_tokens")
      .select("delivery_id").eq("id", tokenAId).single();
    check("A2", "token is scoped to exactly one delivery",
      scope.data?.delivery_id === A.delivery, `${scope.data?.delivery_id?.slice(0, 8)}`);

    /* A3 — first redemption creates the right conversation and participant. */
    const r1 = await sb.rpc("couranr_redeem_help_token", { p_token_hash: sha(tokA) });
    const row1 = Array.isArray(r1.data) ? r1.data[0] : r1.data;
    check("A3", "first redemption resolves conversation + participant",
      !r1.error && Boolean(row1?.out_conversation_id), r1.error?.message || "");
    const convA = row1?.out_conversation_id;

    const conv = await sb.from("couranr_conversations")
      .select("kind, delivery_id, business_account_id").eq("id", convA).single();
    check("A3b", "the conversation is delivery_help on the right delivery",
      conv.data?.kind === "delivery_help" && conv.data?.delivery_id === A.delivery);

    /* A4 — concurrent first redemption: no 500, no duplicates. */
    const tokC = rawToken();
    await sb.rpc("couranr_issue_help_token", {
      p_delivery_id: B.delivery, p_token_hash: sha(tokC), p_ttl_days: 1,
    });
    const conc = await Promise.all([
      sb.rpc("couranr_redeem_help_token", { p_token_hash: sha(tokC) }),
      sb.rpc("couranr_redeem_help_token", { p_token_hash: sha(tokC) }),
      sb.rpc("couranr_redeem_help_token", { p_token_hash: sha(tokC) }),
    ]);
    const errs = conc.filter((c) => c.error);
    const convIds = new Set(conc.filter((c) => !c.error)
      .map((c) => (Array.isArray(c.data) ? c.data[0] : c.data)?.out_conversation_id));
    check("A4", "concurrent first redemption: no error", errs.length === 0,
      errs.map((e) => e.error.message).join("; "));
    check("A4b", "concurrent redemption yields ONE conversation", convIds.size === 1,
      `${convIds.size} distinct`);
    const parts = await sb.from("couranr_conversation_participants")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", [...convIds][0]).is("left_at", null);
    check("A4c", "concurrent redemption yields ONE participant", parts.count === 1,
      `${parts.count} rows`);

    /* A5 — a first customer message persists and returns its own id. */
    const keyA = `p8acc-${randomUUID()}`;
    const m1 = await sb.rpc("couranr_help_post_message", {
      p_token_id: tokenAId, p_body: `${MARK} first customer message`,
      p_topic: "access", p_idempotency_key: keyA,
    });
    check("A5", "first customer message persists and returns its id",
      !m1.error && Boolean(m1.data), m1.error?.message || "");

    /* A6 — an idempotent replay returns THAT message, never another author's. */
    // Plant an Operations internal note carrying the SAME key, which is what
    // used to be returned to the customer instead of their own message.
    const opsUser = (await sb.from("profiles").select("id").eq("role", "admin").limit(1).maybeSingle()).data?.id;
    let notePlanted = false;
    if (opsUser) {
      const op = await sb.from("couranr_conversation_participants")
        .insert({ conversation_id: convA, participant_kind: "operations", user_id: opsUser })
        .select("id").single();
      if (!op.error) {
        const note = await sb.from("couranr_conversation_messages").insert({
          conversation_id: convA, author_participant_id: op.data.id,
          visibility: "couranr_internal", authorship: "human",
          body: `${MARK} INTERNAL NOTE`, idempotency_key: keyA,
        }).select("id").single();
        notePlanted = !note.error;
      }
    }
    const m2 = await sb.rpc("couranr_help_post_message", {
      p_token_id: tokenAId, p_body: `${MARK} first customer message`,
      p_topic: "access", p_idempotency_key: keyA,
    });
    check("A6", "replay returns the CUSTOMER's own message id",
      !m2.error && m2.data === m1.data, m2.error?.message || `${m2.data} vs ${m1.data}`);
    check("A6b", "the colliding internal note was really planted", notePlanted,
      notePlanted ? "" : "control not established — A6 is weaker than it looks");

    /* A7 — internal notes and AI drafts are invisible on every read path. */
    const thread = await sb.rpc("couranr_help_thread", { p_token_id: tokenAId });
    const bodies = (thread.data || []).map((m) => m.body).join(" | ");
    check("A7", "customer thread contains NO internal note",
      !bodies.includes("INTERNAL NOTE"), bodies.slice(0, 60));
    const anyInternal = (thread.data || []).some((m) => m.visibility === "couranr_internal");
    const anyDraft = (thread.data || []).some((m) => m.authorship === "ai_draft");
    check("A7b", "customer thread carries no couranr_internal row", !anyInternal);
    check("A7c", "customer thread carries no ai_draft row", !anyDraft);

    // The boundary itself: no role may read a body directly.
    const direct = await sb.from("couranr_conversation_messages").select("*").limit(1);
    check("A7d", "service_role CANNOT select * on messages", Boolean(direct.error),
      direct.error ? direct.error.code : "*** LEAKED ***");

    /* A8 — refusals are safe and indistinguishable. */
    const refusals = {};
    for (const [label, hash] of [
      ["unissued", sha(rawToken())],
      ["malformed", "not-a-sha"],
    ]) {
      const r = await sb.rpc("couranr_redeem_help_token", { p_token_hash: hash });
      refusals[label] = r.error ? r.error.message : "RESOLVED";
    }
    await sb.from("couranr_help_access_tokens")
      .update({ revoked_at: new Date().toISOString() }).eq("id", tokenAId);
    const rev = await sb.rpc("couranr_redeem_help_token", { p_token_hash: sha(tokA) });
    refusals.revoked = rev.error ? rev.error.message : "RESOLVED";

    check("A8", "a revoked token is refused", refusals.revoked !== "RESOLVED", refusals.revoked);
    check("A8b", "an unissued token is refused", refusals.unissued !== "RESOLVED");
    check("A8c", "revoked and unissued are INDISTINGUISHABLE",
      refusals.revoked === refusals.unissued, `${refusals.revoked} vs ${refusals.unissued}`);
    // Malformed is allowed to differ at the SQL layer (CR400 vs CR404) because
    // the ROUTE collapses both to one 404 body — proven separately in A12.

    /* A9 — a closed thread reopens, and a replay does not repeat it. */
    await sb.from("couranr_help_access_tokens")
      .update({ revoked_at: null }).eq("id", tokenAId);
    await sb.from("couranr_conversations").update({ status: "closed" }).eq("id", convA);
    const freshKey = `p8acc-${randomUUID()}`;
    await sb.rpc("couranr_help_post_message", {
      p_token_id: tokenAId, p_body: `${MARK} reply after close`,
      p_topic: "other", p_idempotency_key: freshKey,
    });
    const afterNew = await sb.from("couranr_conversations").select("status").eq("id", convA).single();
    check("A9", "a NEW customer message reopens a closed thread",
      afterNew.data?.status === "open", afterNew.data?.status);

    await sb.from("couranr_conversations").update({ status: "closed" }).eq("id", convA);
    await sb.rpc("couranr_help_post_message", {
      p_token_id: tokenAId, p_body: `${MARK} reply after close`,
      p_topic: "other", p_idempotency_key: freshKey,
    });
    const afterReplay = await sb.from("couranr_conversations").select("status").eq("id", convA).single();
    check("A9b", "a REPLAY does not repeat the reopen",
      afterReplay.data?.status === "closed", afterReplay.data?.status);

    /* A10 — token-participant uniqueness is enforced. */
    const dup = await sb.from("couranr_conversation_participants").insert({
      conversation_id: convA, participant_kind: "customer",
      user_id: null, access_token_id: tokenAId,
    });
    check("A10", "a duplicate customer participant is refused", Boolean(dup.error),
      dup.error ? dup.error.code : "*** ACCEPTED ***");

    /* A11 — cross-delivery / cross-tenant access fails. */
    const tokB = rawToken();
    await sb.rpc("couranr_issue_help_token", {
      p_delivery_id: B.delivery, p_token_hash: sha(tokB), p_ttl_days: 1,
    });
    const rB = await sb.rpc("couranr_redeem_help_token", { p_token_hash: sha(tokB) });
    const convB = (Array.isArray(rB.data) ? rB.data[0] : rB.data)?.out_conversation_id;
    check("A11", "a second delivery gets its OWN conversation", convB && convB !== convA);

    const tokenBId = (await sb.from("couranr_help_access_tokens")
      .select("id").eq("token_hash", sha(tokB)).single()).data?.id;
    const crossThread = await sb.rpc("couranr_help_thread", { p_token_id: tokenBId });
    const crossBodies = (crossThread.data || []).map((m) => m.body).join(" ");
    check("A11b", "delivery B's token cannot read delivery A's messages",
      !crossBodies.includes("first customer message"), crossBodies.slice(0, 50));

    /* A12 — the real browser flow, with NO stub on the Couranr API. */
    const { chromium } = await import("/opt/pw-browsers/../node_modules/playwright/index.mjs")
      .catch(() => import("/opt/node22/lib/node_modules/playwright/index.mjs"));
    const browser = await chromium.launch({ args: ["--no-proxy-server"] });
    try {
      mkdirSync(SHOTS, { recursive: true });
      const page = await browser.newPage();

      // NO page.route. Every request goes to the real route and the real database.
      //
      // NOT `networkidle`. Next prefetches every `<Link>` in view, so a page
      // that renders navigation never goes idle — see A12c below, where that
      // was a hard 30s timeout that aborted the whole matrix. Wait for the
      // element each assertion is about instead.
      await page.goto(`${BASE}/help/${tokB}`, { waitUntil: "domcontentloaded" });
      await page.locator("textarea").first().waitFor({ timeout: 15000 }).catch(() => {});
      const body = await page.innerText("body");
      // Assert the FORM, not the phrase. `/Delivery Help/i` also matches the
      // marketing navigation, so the old condition passed on a page rendering a
      // refusal — the same false pass `customerHelpFragments.mjs` C1 had, found
      // there by looking at the screenshot. The topic select and the message
      // textarea exist only in the loaded help form.
      const selects = await page.locator("select").count();
      const textareas = await page.locator("textarea").count();
      check("A12", "the real /help/[token] flow renders the help FORM unstubbed",
        selects === 1 && textareas === 1 && !/not available/i.test(body),
        `${selects} select(s), ${textareas} textarea(s)`);
      await page.screenshot({ path: path.join(SHOTS, "A12-live.png"), fullPage: true });

      const typed = `${MARK} typed in a real browser`;
      await page.selectOption("select", "availability");
      await page.fill("textarea", typed);
      await page.click('button[type="submit"]');
      await page.waitForTimeout(2000);

      const t = await sb.rpc("couranr_help_thread", { p_token_id: tokenBId });
      check("A12b", "a message typed in the browser reached the database",
        (t.data || []).some((m) => m.body === typed),
        `${(t.data || []).length} row(s)`);
      await page.screenshot({ path: path.join(SHOTS, "A12b-sent.png"), fullPage: true });

      // A refused link, through the real route, with no stub.
      const p2 = await browser.newPage();
      /* This navigation used `networkidle` and timed out at 30s EVERY run,
         which threw out of the try block and failed the matrix as "XX the
         matrix ran to completion" — 25/26, with A12c and A12d never reached.
         It was red on `main` and nobody knew, because GitHub Actions has never
         executed this file.

         The cause is not a hang: the refusal page renders the PUBLIC shell, and
         Next prefetches each `<Link>` in it, so the network keeps ticking over
         (38 requests, two per public route). `networkidle` is the wrong wait
         for any page with navigation on it. */
      await p2.goto(`${BASE}/help/${rawToken()}`, { waitUntil: "domcontentloaded" });
      /* WAIT FOR THE REFUSAL, not for a lifecycle event. The route answers 200
         with a skeleton and the refusal only appears after the client's fetch
         comes back 404, so `load` — and `domcontentloaded` before it — both
         return while the page still reads "Loading your delivery help." That
         made this assertion fail against a page that was about to say exactly
         what it was asserting. Same lesson as the `LoadingState` trap in
         CLAUDE.md: wait on content that exists only in the loaded state. */
      await p2
        .getByText(/not available/i)
        .first()
        .waitFor({ timeout: 20000 })
        .catch(() => {});
      const refused = await p2.innerText("body");
      check("A12c", "an unissued token is refused by the real route",
        /not available/i.test(refused));
      check("A12d", "the refusal names no reason", !/expired|revoked|unknown/i.test(refused));
      await p2.screenshot({ path: path.join(SHOTS, "A12c-refused.png"), fullPage: true });
      await p2.close();
      await page.close();
    } finally {
      await browser.close();
    }

    /*
     * A13 — the FIXTURES are Gate A legal, not merely accepted.
     *
     * Every assertion above would still pass on a chain whose obligation and
     * plan pointed at different immutable quotes: each write satisfies its own
     * trigger in isolation. couranr_foundation_integrity() is the permanent
     * probe for the graph as a whole.
     *
     * In disposable mode the database contains only what this run seeded, so a
     * clean probe is a statement about these fixtures. Against a hosted project
     * it also reads pre-existing rows, which is why it is reported rather than
     * asserted there.
     */
    const gateAIssues = await gateAIntegrityIssues(supabaseTransport(sb));
    if (disposable) {
      check("A13", "couranr_foundation_integrity() reports NO issue for the seeded chains",
        gateAIssues.length === 0, gateAIssues.join(",") || "clean");
    } else {
      console.log(`  (not asserted against a hosted project) integrity probe: ` +
        `${gateAIssues.length ? gateAIssues.join(",") : "clean"}`);
    }
  } catch (e) {
    check("XX", "the matrix ran to completion", false, redact(e.message));
  } finally {
    if (!disposable) {
      const left = await cleanup(sb, chains);
      check("Z1", "every seeded row was removed", left.length === 0, left.join("; "));

      const after = {
        orders: (await sb.from("orders").select("id", { count: "exact", head: true })).count,
        deliveries: (await sb.from("deliveries").select("id", { count: "exact", head: true })).count,
        couranrDeliveries: (await sb.from("couranr_deliveries").select("id", { count: "exact", head: true }))
          .count,
      };
      check("Z2", "real data is untouched",
        after.orders === before.orders && after.deliveries === before.deliveries &&
        after.couranrDeliveries === before.couranrDeliveries,
        `${after.orders}/${after.deliveries}/${after.couranrDeliveries}`);

      const stray = await sb.from("business_accounts")
        .select("id", { count: "exact", head: true }).like("name", `${MARK}%`);
      check("Z3", "no marked fixture left behind", (stray.count ?? 0) === 0, `${stray.count}`);
    }
    // In disposable mode the caller destroys the cluster. Cleanup by deletion is
    // not attempted here, because attempting it would fail on exactly the
    // append-only grants the disposable database faithfully reproduces.
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n  ${results.length - failed.length}/${results.length} acceptance checks passed`);
  console.log(`  screenshots: ${SHOTS}`);
  if (failed.length) {
    console.log("\n  FAILED:");
    for (const f of failed) console.log(`    ${f.id}  ${f.name} ${f.detail}`);
  }
  // Returned rather than `process.exit`, so a caller that owns a database can
  // tear it down before the process ends. The CLI entry below still exits
  // non-zero, so nothing that ran this file before behaves differently.
  return { total: results.length, failed: failed.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(({ failed }) => {
      if (failed) process.exit(1);
    })
    .catch((e) => {
      console.error(redact(e.stack || e.message));
      process.exit(1);
    });
}
