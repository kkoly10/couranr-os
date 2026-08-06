/**
 * MER-014 / MER-015 — merchant settings and team, UNSTUBBED and SIGNED IN.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS RUN PROVES
 * ---------------------------------------------------------------------------
 *
 * Every registry-required state of both screens, each asserted in the browser
 * AND against the database row it implies:
 *
 *   MER-014  saved · unsaved · verification required · permission denied
 *   MER-015  pending invitation · active · disabled · last-owner protection
 *
 * The one that cannot be proved from the UI alone is the LAST-OWNER RACE: two
 * concurrent demotes of the two remaining owners. A TypeScript guard would let
 * both through (both read "2 owners" before either writes). This run fires
 * both requests in parallel against the real routes and asserts the database
 * still holds an active owner afterwards — which is the entire reason the rule
 * is a `for update` lock in SQL rather than a check in a command.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DOES NOT PROVE — repeat wherever a run is cited
 * ---------------------------------------------------------------------------
 *
 *  1. The `/auth/v1` issuer is `gateway.mjs`'s reimplementation, not GoTrue.
 *  2. The hardening migration 20260806130000 is applied HERE but NOT in
 *     production. The privilege assertions below describe the disposable
 *     stack's post-migration state; production still holds the grants until an
 *     owner approves the apply.
 *  3. `bootstrap.sql` reproduces the production policies INCLUDING their
 *     defects, so "the fix changed something" is a real before/after — but the
 *     before state is a reproduction, not production itself.
 *
 * Run:  node e2e/disposable/merchantSettingsTeam.mjs
 */

import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { up, down, psql, dbUrl } from "./up.mjs";
import {
  startPostgrest,
  startGateway,
  waitForPostgrest,
  SERVICE_ROLE_JWT,
  ANON_JWT,
} from "./gateway.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOTS = path.join(ROOT, "e2e/screenshots/settings-team");
const DIST = ".next-disposable";
const PGRST_BIN =
  process.env.COURANR_POSTGREST ||
  "/tmp/claude-0/-home-user-couranr-os/3ba65fdb-c110-5366-92d6-85568b408343/scratchpad/prst/postgrest";

const PORT = 3315;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = "disposable-settings-1";

let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? `  [${detail}]` : ""}`);
}

const sql = (q) => psql(q).trim();
const esc = (s) => String(s).replace(/'/g, "''");

function fieldLabel(scope, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return scope.getByLabel(new RegExp(`^${escaped}(\\s*\\*|\\s*\\(optional\\))?$`));
}

function makeUser(email, profileRole = "customer") {
  const id = sql(`insert into auth.users (email) values ('${esc(email)}') returning id`);
  sql(`select public.couranr_disposable_set_password('${id}', '${esc(PASSWORD)}')`);
  sql(
    `insert into public.profiles (id, email, role)
     values ('${id}', '${esc(email)}', '${profileRole}')`
  );
  return id;
}

function addMember(businessId, userId, role, status = "active") {
  return sql(
    `insert into public.business_members
       (business_account_id, user_id, role, status, joined_at)
     values ('${businessId}', '${userId}', '${role}', '${status}',
             ${status === "active" ? "now()" : "null"})
     returning id`
  );
}

async function main() {
  console.log("MER-014 / MER-015 — settings and team, authenticated, unstubbed\n");
  mkdirSync(SHOTS, { recursive: true });

  let pgrst;
  let gateway;
  let appServer;
  let browser;
  const contexts = [];

  try {
    console.log("  bringing up the disposable database...");
    const info = up({ quiet: true });
    console.log(`  ${info.migrationsApplied} migrations applied`);

    pgrst = startPostgrest({
      dbUrl: dbUrl(),
      binary: PGRST_BIN,
      workDir: "/var/lib/postgresql/couranr-disposable/pgrst",
    });
    if (!(await waitForPostgrest())) throw new Error("PostgREST did not start");
    gateway = await startGateway();
    console.log(`  gateway at ${gateway.url}`);

    const env = {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: gateway.url,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_JWT,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_JWT,
      PORT: String(PORT),
      NODE_ENV: "production",
    };

    const reuse = process.env.COURANR_REUSE_BUILD === "1";
    if (reuse && !process.env.COURANR_DISPOSABLE_JWT_SECRET) {
      throw new Error(
        "COURANR_REUSE_BUILD=1 requires COURANR_DISPOSABLE_JWT_SECRET — the anon key is inlined at build time"
      );
    }
    if (!reuse) {
      rmSync(path.join(ROOT, DIST), { recursive: true, force: true });
      console.log("  building the application against the disposable stack...");
      execFileSync("npx", ["next", "build"], {
        cwd: ROOT,
        env: { ...env, COURANR_DIST_DIR: DIST },
        stdio: "ignore",
        timeout: 900_000,
      });
    }

    console.log("  starting the application against it...");
    appServer = spawn("npx", ["next", "start", "-p", String(PORT)], {
      cwd: ROOT,
      env: { ...env, COURANR_DIST_DIR: DIST },
      stdio: "ignore",
      detached: true,
    });
    const deadline = Date.now() + 120_000;
    let live = false;
    while (Date.now() < deadline && !live) {
      try {
        const r = await fetch(BASE, { redirect: "manual" });
        live = r.status < 500;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    if (!live) throw new Error("the application did not start");

    /* ─────────────────── the hardening migration, measured ─────────────── */

    console.log("Hardening migration 20260806130000 — measured, not assumed");
    {
      /*
       * NOTE ON BOOLEAN TEXT, learned the hard way twice in this repository:
       * `psql -tA` prints a bare boolean as 't'/'f', but `boolean || ','`
       * casts it to 'true'/'false'. Concatenated probes must therefore be
       * compared against the WORD, not the letter. Every multi-value probe
       * below concatenates, so every expectation reads 'true'/'false'.
       */
      const grants = sql(
        `select
           has_table_privilege('authenticated','public.business_members','INSERT') || ','
        || has_table_privilege('authenticated','public.business_members','UPDATE') || ','
        || has_table_privilege('authenticated','public.business_members','DELETE') || ','
        || has_table_privilege('anon','public.business_members','UPDATE') || ','
        || has_table_privilege('authenticated','public.business_accounts','UPDATE')`
      );
      check("H1", "anon and authenticated hold NO write grant on business_members/accounts",
        grants === "false,false,false,false,false", grants);

      const svc = sql(
        `select has_table_privilege('service_role','public.business_members','UPDATE')`
      );
      check("H2", "service_role — the only identity the commands run as — retains UPDATE",
        svc === "t", svc);

      const pol = sql(
        `select polname from pg_policy p join pg_class c on c.oid=p.polrelid
          where c.relname='business_members' and p.polcmd='*'`
      );
      check("H3", "the actor-only ALL policy is replaced by the admin-only one",
        pol === "business_members_manage_admin_only", pol);

      const ba = sql(
        `select pg_get_expr(polqual, polrelid) like '%business_accounts.id%'
           from pg_policy p join pg_class c on c.oid=p.polrelid
          where c.relname='business_accounts' and polname='business_accounts_update_owner_manager'`
      );
      check("H4", "the business_accounts policy correlates to the row, not to itself",
        ba === "t", ba);

      const teamEvents = sql(
        `select has_table_privilege('authenticated','public.couranr_team_events','SELECT') || ','
             || has_table_privilege('service_role','public.couranr_team_events','INSERT')`
      );
      check("H5", "the team audit table is service_role-only",
        teamEvents === "false,true", teamEvents);
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    console.log("  seeding synthetic identities...");

    const bizId = sql(
      `insert into public.business_accounts (name, slug, status, timezone)
       values ('[TEAM] disposable business', 'team-disposable', 'active', 'America/New_York')
       returning id`
    );

    // The identities come FIRST. An earlier version created the workspace with
    // `insert ... select ... from auth.users limit 1` before any user existed:
    // the select matched nothing, the insert wrote zero rows, and the settings
    // screen then correctly rendered "verification required" for a business
    // that was supposed to have a profile. The bug was in the fixture, and the
    // screen was right — which is exactly why the workspace row is asserted
    // below rather than assumed.
    const owner = { id: makeUser("e2e-team-owner@couranr.invalid"), email: "e2e-team-owner@couranr.invalid" };
    const owner2 = { id: makeUser("e2e-team-owner2@couranr.invalid"), email: "e2e-team-owner2@couranr.invalid" };
    const manager = { id: makeUser("e2e-team-manager@couranr.invalid"), email: "e2e-team-manager@couranr.invalid" };
    const viewer = { id: makeUser("e2e-team-viewer@couranr.invalid"), email: "e2e-team-viewer@couranr.invalid" };
    const invitee = { id: makeUser("e2e-team-invitee@couranr.invalid"), email: "e2e-team-invitee@couranr.invalid" };
    const outsider = { id: makeUser("e2e-team-outsider@couranr.invalid"), email: "e2e-team-outsider@couranr.invalid" };

    // Now that a real user exists to own it, the workspace profile — and the
    // row is ASSERTED, not assumed, because its absence is a legitimate state
    // this screen renders and a silent miss would look like a passing test.
    sql(
      `insert into public.couranr_merchant_workspaces
         (business_account_id, created_by, idempotency_key, business_category,
          pickup_address, contact_phone, payer_default, policies_version, policies_accepted_at)
       values ('${bizId}', '${owner.id}', 'team-ws-${crypto.randomUUID()}',
               'general_local_business',
               '{"line1":"1 Seed St","city":"Stafford","region":"VA","postalCode":"22554"}'::jsonb,
               '540-555-0100', 'merchant', 'couranr-policies-2026-07', now())`
    );
    if (sql(`select count(*) from public.couranr_merchant_workspaces
              where business_account_id='${bizId}'`) !== "1") {
      throw new Error("fixture failed: the workspace profile row was not created");
    }

    const ownerMemberId = addMember(bizId, owner.id, "owner");
    addMember(bizId, manager.id, "manager");
    const viewerMemberId = addMember(bizId, viewer.id, "viewer");

    // A second business with NO workspace profile — the real, reachable
    // condition behind the "verification required" state.
    const bizNoWs = sql(
      `insert into public.business_accounts (name, slug, status)
       values ('[TEAM] unverified business', 'team-unverified', 'active') returning id`
    );
    const unverifiedOwner = {
      id: makeUser("e2e-team-unverified@couranr.invalid"),
      email: "e2e-team-unverified@couranr.invalid",
    };
    addMember(bizNoWs, unverifiedOwner.id, "owner");

    console.log("  fixtures ready\n");

    /* ─────────────────────────── browser helpers ─────────────────────── */

    const { chromium } = await import("/opt/node22/lib/node_modules/playwright/index.mjs");
    browser = await chromium.launch({ args: ["--no-proxy-server"] });

    async function signIn(email) {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      await page.goto(`${BASE}/sign-in`, { waitUntil: "domcontentloaded" });
      const emailField = fieldLabel(page, "Email");
      await emailField.waitFor({ state: "visible", timeout: 45_000 });
      await emailField.fill(email);
      await fieldLabel(page, "Password").fill(PASSWORD);
      await page.getByRole("button", { name: /^Sign in$/ }).click();
      const until = Date.now() + 45_000;
      while (Date.now() < until) {
        if (!new URL(page.url()).pathname.startsWith("/sign-in")) return page;
        await page.waitForTimeout(250);
      }
      const text = await page.innerText("body").catch(() => "(no body)");
      throw new Error(`sign-in for ${email} never left /sign-in: ${text.slice(0, 300)}`);
    }

    async function tokenFor(email) {
      const r = await fetch(`${gateway.url}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: ANON_JWT },
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      if (!r.ok) throw new Error(`could not mint a token for ${email}: ${r.status}`);
      return (await r.json()).access_token;
    }

    async function api(email, pathname, init = {}) {
      const token = await tokenFor(email);
      const r = await fetch(`${BASE}${pathname}`, {
        ...init,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
          ...(init.headers || {}),
        },
      });
      let body = null;
      try {
        body = await r.json();
      } catch {
        /* no body */
      }
      return { status: r.status, body };
    }

    async function open(email, pathname) {
      const page = await signIn(email);
      await page.goto(`${BASE}${pathname}`, { waitUntil: "domcontentloaded" });
      return page;
    }

    /* ══════════════════ MER-014 — saved / unsaved ══════════════════════ */

    console.log("MER-014 — owner edits settings");
    const ownerSettings = await open(owner.email, "/business/settings");
    const nameField = fieldLabel(ownerSettings, "Business name");
    await nameField.waitFor({ state: "visible", timeout: 30_000 });

    check("S1", "the stored name is rendered from the server",
      (await nameField.inputValue()) === "[TEAM] disposable business",
      await nameField.inputValue());
    check("S2", "no unsaved badge before anything is touched",
      !(await ownerSettings.getByText("Unsaved changes").isVisible().catch(() => false)));
    check("S3", "no subscription or plan control anywhere (registry constraint)",
      !/subscription|monthly plan|upgrade your plan/i.test(await ownerSettings.innerText("body")));
    check("S4", "the policy version is displayed read-only, not editable",
      (await ownerSettings.innerText("body")).includes("couranr-policies-2026-07"));

    // REQUIRED STATE: unsaved.
    await fieldLabel(ownerSettings, "Contact phone").fill("540-555-0199");
    await ownerSettings.getByText("Unsaved changes").waitFor({ state: "visible", timeout: 10_000 });
    check("S5", "editing a field raises the UNSAVED state", true);
    await ownerSettings.screenshot({ path: path.join(SHOTS, "MER-014-unsaved.png"), fullPage: true });

    // REQUIRED STATE: saved — asserted in the browser AND in the row.
    await ownerSettings.getByRole("button", { name: "Save changes" }).click();
    await ownerSettings.getByText("Saved", { exact: true }).waitFor({ state: "visible", timeout: 20_000 });
    {
      const stored = sql(
        `select contact_phone from public.couranr_merchant_workspaces
          where business_account_id='${bizId}'`
      );
      check("S6", "SAVED state, and the row actually changed", stored === "540-555-0199", stored);
    }
    await ownerSettings.screenshot({ path: path.join(SHOTS, "MER-014-saved.png"), fullPage: true });

    /* ══════════════ MER-014 — verification required ════════════════════ */

    console.log("MER-014 — the unverified-workspace state");
    const unverified = await open(unverifiedOwner.email, "/business/settings");
    await unverified
      .getByText("This business needs Couranr verification").first()
      .waitFor({ state: "visible", timeout: 30_000 });
    check("S7", "a business with no workspace profile renders verification-required",
      true);
    check("S8", "the state is TRUE: no workspace row exists for that business",
      sql(`select count(*) from public.couranr_merchant_workspaces where business_account_id='${bizNoWs}'`) === "0");
    await unverified.screenshot({ path: path.join(SHOTS, "MER-014-verification-required.png"), fullPage: true });

    /* ══════════════ MER-014 — permission denied / read-only ════════════ */

    console.log("MER-014 — viewer is read-only, outsider is refused");
    const viewerSettings = await open(viewer.email, "/business/settings");
    await viewerSettings.getByText("You have read-only access").waitFor({ state: "visible", timeout: 30_000 });
    check("S9", "viewer sees the read-only banner and no Save control",
      (await viewerSettings.getByRole("button", { name: "Save changes" }).count()) === 0);
    {
      const r = await api(viewer.email, `/api/couranr/me/settings?businessAccountId=${bizId}`, {
        method: "PATCH",
        body: JSON.stringify({ contactPhone: "540-555-0000" }),
      });
      check("S10", "server truth: viewer's PATCH is refused", r.status === 403, `status=${r.status}`);
      const unchanged = sql(
        `select contact_phone from public.couranr_merchant_workspaces where business_account_id='${bizId}'`
      );
      check("S11", "the refused write changed nothing", unchanged === "540-555-0199", unchanged);
    }
    {
      const r = await api(outsider.email, `/api/couranr/me/settings?businessAccountId=${bizId}`);
      check("S12", "server truth: a non-member is refused the settings read",
        r.status === 403, `status=${r.status}`);
    }
    await viewerSettings.screenshot({ path: path.join(SHOTS, "MER-014-readonly.png"), fullPage: true });

    /* ══════════════════ MER-015 — invite and accept ════════════════════ */

    console.log("MER-015 — invite, pending invitation, accept");
    const ownerTeam = await open(owner.email, "/business/settings/team");
    await fieldLabel(ownerTeam, "Email address").waitFor({ state: "visible", timeout: 30_000 });

    await fieldLabel(ownerTeam, "Email address").fill(invitee.email);
    await fieldLabel(ownerTeam, "Role").selectOption("dispatcher");
    await ownerTeam.getByRole("button", { name: "Send invitation" }).click();
    // `exact` matters: the alert renders the phrase twice — once as its title
    // and once inside the sentence naming the address — and a loose match is a
    // Playwright strict-mode violation rather than a product problem.
    await ownerTeam
      .getByText("Invitation created", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });

    {
      const row = sql(
        `select role || '|' || status || '|' || coalesce(invited_email,'-') || '|' ||
                (joined_at is null)::text
           from public.business_members
          where business_account_id='${bizId}' and user_id='${invitee.id}'`
      );
      check("T1", "the invitation is a real row: dispatcher, invited, email recorded, not joined",
        row === "dispatcher|invited|e2e-team-invitee@couranr.invalid|true", row);
      const ev = sql(
        `select command || '|' || to_status from public.couranr_team_events
          where business_account_id='${bizId}' order by created_at desc limit 1`
      );
      check("T2", "the audit event records the invite", ev === "invite_member|invited", ev);
    }
    check("T3", "the UI does NOT claim an email was sent",
      !/sent you an email|email sent|check their inbox/i.test(await ownerTeam.innerText("body")));

    // REQUIRED STATE: pending invitation, shown in the team list.
    await ownerTeam.getByText("Invitation pending").first().waitFor({ state: "visible", timeout: 20_000 });
    check("T4", "the team list shows the PENDING INVITATION state", true);
    await ownerTeam.screenshot({ path: path.join(SHOTS, "MER-015-pending-invitation.png"), fullPage: true });

    // The invitee's own side: they see and accept it.
    const inviteePage = await open(invitee.email, "/business/settings/team");
    await inviteePage
      .getByText("You have been invited to [TEAM] disposable business").first()
      .waitFor({ state: "visible", timeout: 30_000 });
    check("T5", "the invitee sees their own pending invitation", true);
    await inviteePage.screenshot({ path: path.join(SHOTS, "MER-015-invitee-view.png"), fullPage: true });

    await inviteePage.getByRole("button", { name: "Accept invitation" }).click();
    {
      const until = Date.now() + 20_000;
      let row = "";
      while (Date.now() < until) {
        row = sql(
          `select status || '|' || (joined_at is not null)::text
             from public.business_members
            where business_account_id='${bizId}' and user_id='${invitee.id}'`
        );
        if (row === "active|true") break;
        await new Promise((r) => setTimeout(r, 500));
      }
      check("T6", "accepting moved the row to ACTIVE and stamped joined_at",
        row === "active|true", row);
      const ev = sql(
        `select command from public.couranr_team_events
          where business_account_id='${bizId}' order by created_at desc limit 1`
      );
      check("T7", "the acceptance is audited", ev === "accept_member_invite", ev);
    }

    /* ══════════════════ MER-015 — disable and restore ══════════════════ */

    console.log("MER-015 — disable and restore");
    {
      const r = await api(owner.email, `/api/couranr/me/team/${viewerMemberId}?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "disable" }),
      });
      check("T8", "disable succeeds for an owner", r.status === 200, `status=${r.status}`);
      const row = sql(`select status from public.business_members where id='${viewerMemberId}'`);
      check("T9", "the member is DISABLED — and the row still exists (no delete)",
        row === "disabled", row);
    }
    {
      // A disabled member holds no capability: the matrix says so, and the SQL
      // agrees. This is the assertion that "disable" really is "remove access".
      const r = await api(viewer.email, `/api/couranr/me/settings?businessAccountId=${bizId}`);
      check("T10", "a DISABLED member is refused everything", r.status === 403, `status=${r.status}`);
    }
    {
      const r = await api(owner.email, `/api/couranr/me/team/${viewerMemberId}?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "reactivate" }),
      });
      check("T11", "restore returns them to active", r.status === 200, `status=${r.status}`);
      check("T12", "the row is active again",
        sql(`select status from public.business_members where id='${viewerMemberId}'`) === "active");
    }

    /* ══════════════ MER-015 — LAST-OWNER PROTECTION ════════════════════ */

    console.log("MER-015 — last-owner protection, including the concurrent race");

    // Single sole owner: every route that could remove them must refuse.
    {
      const r = await api(owner.email, `/api/couranr/me/team/${ownerMemberId}?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "change_role", fromRole: "owner", toRole: "manager" }),
      });
      check("L1", "demoting the SOLE owner is refused with a conflict",
        r.status === 409, `status=${r.status} code=${r.body?.code}`);
      check("L2", "the sole owner is untouched",
        sql(`select role || '|' || status from public.business_members where id='${ownerMemberId}'`) === "owner|active");
    }
    {
      const r = await api(owner.email, `/api/couranr/me/team/${ownerMemberId}?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "disable" }),
      });
      check("L3", "disabling the SOLE owner is refused too", r.status === 409, `status=${r.status}`);
    }
    {
      // A manager must not be able to touch an owner at all, even with two.
      const r = await api(manager.email, `/api/couranr/me/team/${ownerMemberId}?businessAccountId=${bizId}`, {
        method: "POST",
        body: JSON.stringify({ action: "change_role", fromRole: "owner", toRole: "viewer" }),
      });
      check("L4", "a MANAGER may not change an owner's role", r.status === 403, `status=${r.status}`);
    }

    // The UI renders the refusal, not a silent no-op.
    {
      const page = await open(owner.email, "/business/settings/team");
      await page.getByText("Last owner protection").first().waitFor({ state: "visible", timeout: 30_000 });
      check("L5", "the UI explains last-owner protection BEFORE it is hit", true);
      await page.screenshot({ path: path.join(SHOTS, "MER-015-last-owner.png"), fullPage: true });
    }

    // THE RACE. Two owners, two concurrent demotes — one must lose.
    console.log("  the concurrent double-demote race");
    const owner2MemberId = addMember(bizId, owner2.id, "owner");
    check("L6", "two active owners now exist",
      sql(`select count(*) from public.business_members
            where business_account_id='${bizId}' and role='owner' and status='active'`) === "2");

    {
      const [a, b] = await Promise.all([
        api(owner.email, `/api/couranr/me/team/${ownerMemberId}?businessAccountId=${bizId}`, {
          method: "POST",
          body: JSON.stringify({ action: "change_role", fromRole: "owner", toRole: "manager" }),
        }),
        api(owner2.email, `/api/couranr/me/team/${owner2MemberId}?businessAccountId=${bizId}`, {
          method: "POST",
          body: JSON.stringify({ action: "change_role", fromRole: "owner", toRole: "manager" }),
        }),
      ]);

      const remaining = sql(
        `select count(*) from public.business_members
          where business_account_id='${bizId}' and role='owner' and status='active'`
      );
      // THE ASSERTION THIS WHOLE FILE EXISTS FOR. A TypeScript-only guard
      // leaves 0 here; the SQL lock leaves at least 1.
      check("L7", "after two CONCURRENT demotes, the business still has an active owner",
        Number(remaining) >= 1, `owners=${remaining} statuses=${a.status}/${b.status}`);
      check("L8", "exactly one of the two concurrent demotes was refused",
        [a.status, b.status].filter((s) => s === 409).length === 1,
        `${a.status}/${b.status}`);
    }

    /* ══════════════════ tenant isolation ═══════════════════════════════ */

    {
      const r = await api(unverifiedOwner.email, `/api/couranr/me/team?businessAccountId=${bizId}`);
      check("X1", "an owner of another business cannot read this team",
        r.status === 403, `status=${r.status}`);
      const anon = await fetch(`${BASE}/api/couranr/me/team?businessAccountId=${bizId}`);
      check("X2", "anonymous is refused", anon.status === 401, `status=${anon.status}`);
    }

    /* ══════════════ fail-closed on a broken team read ══════════════════ */

    console.log("Fail-closed — an errored team read never renders as an empty team");
    {
      const page = await signIn(owner.email);
      await page.route("**/api/couranr/me/team?*", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "Injected.", correlationId: "e2e-team-err" }),
        })
      );
      await page.goto(`${BASE}/business/settings/team`, { waitUntil: "domcontentloaded" });
      await page.getByText("Your team did not load").first().waitFor({ state: "visible", timeout: 30_000 });
      const body = await page.innerText("body");
      check("F1", "the error state renders with its reference", body.includes("e2e-team-err"));
      check("F2", "it does NOT claim the business has no team members",
        !/no team members|nobody has access/i.test(body));
      await page.screenshot({ path: path.join(SHOTS, "MER-015-error.png"), fullPage: true });
    }

    console.log(`\n  ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    for (const ctx of contexts) await ctx.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (appServer?.pid) {
      try {
        process.kill(-appServer.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    if (gateway?.server) gateway.server.close();
    if (pgrst) pgrst.kill("SIGTERM");
    down({ quiet: true });
    console.log("  disposable stack torn down");
  }
}

main().catch((e) => {
  console.error(e.stack || e.message || e);
  down({ quiet: true });
  process.exitCode = 1;
});
