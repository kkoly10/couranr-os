/**
 * Proves the disposable `/auth/v1` REFUSES, before anything is built on it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS SEPARATELY
 * ---------------------------------------------------------------------------
 *
 * `MER-012`, `DRV-008` and `OPS-005` all need a signed-in caller, and GoTrue
 * could not be obtained in this container. `gateway.mjs` therefore implements
 * the two endpoints the application calls. That is a reasonable move only if
 * the implementation genuinely refuses — an `/auth/v1` that hands out a token
 * to anyone would make every authenticated assertion downstream worthless, and
 * it would do so silently, because the screens would all render.
 *
 * So the refusals are proved FIRST, here, in isolation, with no Next build and
 * no browser. If this file does not pass, no run that depends on it may be
 * cited for anything.
 *
 * Every check calls the real endpoint over real HTTP and reads what came back.
 * The database is created empty and destroyed afterwards; no production row is
 * involved at any point.
 *
 * Run:  node e2e/disposable/authGateway.mjs
 */

import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { up, down, psql, dbUrl } from "./up.mjs";
import {
  startPostgrest,
  startGateway,
  waitForPostgrest,
  signJwt,
  verifyAccessToken,
  JWT_SECRET,
  ANON_JWT,
} from "./gateway.mjs";
import { postgrestTarget } from "../../scripts/provisionPostgrest.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Resolved by scripts/provisionPostgrest.mjs, never a session scratchpad.
// The previous default was a path inside ONE container's ephemeral
// scratchpad, so this harness aborted on every other machine — after
// applying 50 migrations, which made a missing dependency look like a
// database failure. `npm run provision:postgrest` puts it on PATH.
const PGRST_BIN = postgrestTarget();

const PASSWORD = "disposable-correct-horse-1";
const EMAIL = "e2e-auth-owner@couranr.invalid";

let passed = 0;
let failed = 0;

function check(id, description, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${description}${detail ? ` — ${detail}` : ""}`);
}

const one = (sql) => psql(sql).trim();

async function main() {
  console.log("Disposable /auth/v1 — refusal proof\n");

  let pgrst;
  let gateway;

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
    console.log(`  gateway at ${gateway.url}\n`);

    const userId = one(
      `insert into auth.users (email) values ('${EMAIL}') returning id`
    );
    one(`select public.couranr_disposable_set_password('${userId}','${PASSWORD}')`);

    const storedHash = one(`select encrypted_password from auth.users where id='${userId}'`);

    const token = (t) => ({ authorization: `Bearer ${t}` });
    const post = (p, body, headers = {}) =>
      fetch(`${gateway.url}${p}`, {
        method: "POST",
        headers: { "content-type": "application/json", apikey: ANON_JWT, ...headers },
        body: JSON.stringify(body),
      });
    const get = (p, headers = {}) =>
      fetch(`${gateway.url}${p}`, { headers: { apikey: ANON_JWT, ...headers } });

    console.log("Password store");

    // ── A1 ────────────────────────────────────────────────────────────────
    check(
      "A1",
      "the password is stored as a bcrypt hash, not as the password",
      storedHash.startsWith("$2") && !storedHash.includes(PASSWORD),
      storedHash.slice(0, 7)
    );

    console.log("\nToken issuance");

    // ── A2 ────────────────────────────────────────────────────────────────
    const good = await post("/auth/v1/token?grant_type=password", {
      email: EMAIL,
      password: PASSWORD,
    });
    const goodBody = await good.json();
    check(
      "A2",
      "the correct password yields a session for the right user",
      good.status === 200 &&
        typeof goodBody.access_token === "string" &&
        typeof goodBody.refresh_token === "string" &&
        goodBody.user?.id === userId &&
        goodBody.user?.email === EMAIL,
      `${good.status} user=${goodBody.user?.id === userId}`
    );

    const accessToken = goodBody.access_token;

    // ── A3 ────────────────────────────────────────────────────────────────
    const wrong = await post("/auth/v1/token?grant_type=password", {
      email: EMAIL,
      password: PASSWORD + "x",
    });
    const wrongBody = await wrong.json();
    check(
      "A3",
      "a wrong password is refused and issues NO token",
      wrong.status === 400 &&
        wrongBody.error_code === "invalid_credentials" &&
        !("access_token" in wrongBody),
      `${wrong.status} ${wrongBody.error_code}`
    );

    // ── A4 ────────────────────────────────────────────────────────────────
    const unknown = await post("/auth/v1/token?grant_type=password", {
      email: "e2e-auth-nobody@couranr.invalid",
      password: PASSWORD,
    });
    const unknownBody = await unknown.json();
    check(
      "A4",
      "an unknown address is refused IDENTICALLY — no account enumeration",
      unknown.status === wrong.status &&
        JSON.stringify(unknownBody) === JSON.stringify(wrongBody),
      `${unknown.status} ${unknownBody.error_code}`
    );

    console.log("\nToken verification at /auth/v1/user");

    // ── A5 ────────────────────────────────────────────────────────────────
    const me = await get("/auth/v1/user", token(accessToken));
    const meBody = await me.json();
    check(
      "A5",
      "the issued token resolves to the REAL auth.users row",
      me.status === 200 && meBody.id === userId && meBody.email === EMAIL,
      `${me.status} ${meBody.email}`
    );

    // ── A6 ────────────────────────────────────────────────────────────────
    // Same claims, signed with a DIFFERENT secret. Structurally perfect.
    const foreign = signJwt(
      JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString()),
      crypto.randomBytes(32).toString("hex")
    );
    const forgedRes = await get("/auth/v1/user", token(foreign));
    const forgedBody = await forgedRes.json();
    check(
      "A6",
      "a token signed with a different secret is refused",
      forgedRes.status === 401 && forgedBody.error_code === "bad_jwt",
      `${forgedRes.status} ${forgedBody.error_code}`
    );

    // ── A7 ────────────────────────────────────────────────────────────────
    // The signature kept, the payload swapped for a different `sub`. This is
    // the attack a verifier that decodes-without-checking waves through.
    const [h, , s] = accessToken.split(".");
    const tamperedClaims = JSON.parse(
      Buffer.from(accessToken.split(".")[1], "base64url").toString()
    );
    tamperedClaims.sub = crypto.randomUUID();
    const tampered = `${h}.${Buffer.from(JSON.stringify(tamperedClaims)).toString("base64url")}.${s}`;
    const tamperedRes = await get("/auth/v1/user", token(tampered));
    check(
      "A7",
      "a tampered payload with the original signature is refused",
      tamperedRes.status === 401,
      String(tamperedRes.status)
    );

    // ── A8 ────────────────────────────────────────────────────────────────
    const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString(
      "base64url"
    )}.${Buffer.from(JSON.stringify({ sub: userId, role: "authenticated" })).toString(
      "base64url"
    )}.`;
    const noneRes = await get("/auth/v1/user", token(none));
    check("A8", 'an `alg: "none"` token is refused', noneRes.status === 401, String(noneRes.status));

    // ── A9 ────────────────────────────────────────────────────────────────
    const expired = signJwt(
      { sub: userId, role: "authenticated", aud: "authenticated", iat: 1735689600, exp: 1735693200 },
      JWT_SECRET
    );
    const expiredRes = await get("/auth/v1/user", token(expired));
    check(
      "A9",
      "an EXPIRED token signed with the real secret is refused",
      expiredRes.status === 401,
      String(expiredRes.status)
    );

    // ── A10 ───────────────────────────────────────────────────────────────
    // Correctly signed, unexpired, and for a user who does not exist. Proves
    // the endpoint reads a row rather than trusting the claims it verified.
    const ghost = signJwt(
      {
        sub: crypto.randomUUID(),
        role: "authenticated",
        aud: "authenticated",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 600,
      },
      JWT_SECRET
    );
    const ghostRes = await get("/auth/v1/user", token(ghost));
    check(
      "A10",
      "a validly signed token for a nonexistent user is refused",
      ghostRes.status === 403,
      String(ghostRes.status)
    );

    // ── A11 ───────────────────────────────────────────────────────────────
    const noAuth = await get("/auth/v1/user");
    check("A11", "no Authorization header is refused", noAuth.status === 401, String(noAuth.status));

    console.log("\nWhat the token grants at PostgREST");

    // ── A12 ───────────────────────────────────────────────────────────────
    const whoamiRes = await fetch(`${gateway.url}/rest/v1/rpc/couranr_disposable_whoami`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: ANON_JWT,
        authorization: `Bearer ${accessToken}`,
      },
      body: "{}",
    });
    const whoami = await whoamiRes.json();
    check(
      "A12",
      "PostgREST SET ROLEs `authenticated` and derives auth.uid() from the token",
      whoamiRes.status === 200 &&
        whoami.db_role === "authenticated" &&
        whoami.jwt_role === "authenticated" &&
        whoami.uid === userId,
      JSON.stringify(whoami)
    );

    // ── A13 ───────────────────────────────────────────────────────────────
    const foreignPgrst = await fetch(`${gateway.url}/rest/v1/rpc/couranr_disposable_whoami`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: ANON_JWT,
        authorization: `Bearer ${foreign}`,
      },
      body: "{}",
    });
    check(
      "A13",
      "PostgREST refuses the same foreign-signed token",
      foreignPgrst.status === 401,
      String(foreignPgrst.status)
    );

    // ── A14 ───────────────────────────────────────────────────────────────
    // `authenticated` must NOT be able to call the password oracle. Without the
    // revoke in bootstrap.sql, pg_default_acl would have granted it.
    const oracle = await fetch(
      `${gateway.url}/rest/v1/rpc/couranr_disposable_verify_password`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          apikey: ANON_JWT,
          authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ p_email: EMAIL, p_password: PASSWORD }),
      }
    );
    // Both halves. The HTTP refusal is what an attacker meets; the privilege is
    // why. `has_function_privilege` rather than a grantee row, because a grant
    // inherited through PUBLIC does not appear as a grantee — and that is
    // exactly the defect this check caught: revoking from `anon, authenticated`
    // alone left PUBLIC's default EXECUTE in place and the call answered 200.
    const oracleAcl = one(`select
        has_function_privilege('anon','public.couranr_disposable_verify_password(text,text)','EXECUTE')
     || '/' ||
        has_function_privilege('authenticated','public.couranr_disposable_verify_password(text,text)','EXECUTE')
     || '/' ||
        has_function_privilege('service_role','public.couranr_disposable_verify_password(text,text)','EXECUTE')`);
    check(
      "A14",
      "`authenticated` cannot reach the password helper, by privilege and over HTTP",
      (oracle.status === 401 || oracle.status === 403 || oracle.status === 404) &&
        oracleAcl === "false/false/true",
      `http=${oracle.status} anon/auth/service=${oracleAcl}`
    );

    console.log("\nRefresh and logout");

    // ── A15 ───────────────────────────────────────────────────────────────
    const refreshed = await post("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: goodBody.refresh_token,
    });
    const refreshedBody = await refreshed.json();
    const rotatedOk =
      refreshed.status === 200 &&
      refreshedBody.user?.id === userId &&
      refreshedBody.refresh_token !== goodBody.refresh_token;
    check("A15", "a refresh token rotates into a new session", rotatedOk, String(refreshed.status));

    // ── A16 ───────────────────────────────────────────────────────────────
    const replay = await post("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: goodBody.refresh_token,
    });
    check(
      "A16",
      "replaying the spent refresh token is refused",
      replay.status === 400,
      String(replay.status)
    );

    // ── A17 ───────────────────────────────────────────────────────────────
    const bogusRefresh = await post("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: crypto.randomBytes(24).toString("base64url"),
    });
    check(
      "A17",
      "an invented refresh token is refused",
      bogusRefresh.status === 400,
      String(bogusRefresh.status)
    );

    // ── A18 ───────────────────────────────────────────────────────────────
    const loggedOut = await post("/auth/v1/logout", {}, token(refreshedBody.access_token));
    const afterLogout = await post("/auth/v1/token?grant_type=refresh_token", {
      refresh_token: refreshedBody.refresh_token,
    });
    check(
      "A18",
      "logout invalidates that user's refresh tokens",
      loggedOut.status === 204 && afterLogout.status === 400,
      `logout=${loggedOut.status} refresh=${afterLogout.status}`
    );

    // ── A19 ───────────────────────────────────────────────────────────────
    const unimplemented = await post("/auth/v1/magiclink", { email: EMAIL });
    check(
      "A19",
      "an unimplemented auth endpoint fails LOUD rather than pretending",
      unimplemented.status === 501,
      String(unimplemented.status)
    );

    // ── A20 ───────────────────────────────────────────────────────────────
    // The verifier used by the gateway, exercised directly on the edges that
    // an HTTP check cannot reach: a two-part token and a length-mismatched MAC.
    check(
      "A20",
      "verifyAccessToken rejects malformed tokens without throwing",
      verifyAccessToken("a.b") === null &&
        verifyAccessToken("") === null &&
        verifyAccessToken(`${accessToken}extra`) === null &&
        verifyAccessToken(accessToken) !== null,
      "4 edge cases"
    );
  } finally {
    if (gateway?.server) gateway.server.close();
    if (pgrst) {
      try {
        process.kill(pgrst.pid, "SIGTERM");
      } catch {
        /* already gone */
      }
    }
    down({ quiet: true });
    console.log("\n  disposable database destroyed");
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    down({ quiet: true });
    process.exit(130);
  });
}

main().catch((e) => {
  console.error(e.stack || e.message || e);
  down({ quiet: true });
  process.exitCode = 1;
});
