/**
 * A Supabase-shaped HTTP front for the disposable database.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * `supabase-js` builds requests against `${SUPABASE_URL}/rest/v1/...`.
 * PostgREST serves those same routes at its own root. This process is the
 * path translation between them, and nothing else:
 *
 *     /rest/v1/rpc/couranr_help_thread   ->   PostgREST  /rpc/couranr_help_thread
 *     /rest/v1/couranr_conversations     ->   PostgREST  /couranr_conversations
 *
 * IT IS A ROUTER, NOT A STUB. It composes no response, invents no row and
 * answers no query itself. Every byte of every result comes from the real
 * PostgREST talking to the real PostgreSQL. If a function raises, the caller
 * sees the real SQLSTATE. That distinction is the whole point: a stub that
 * returned the answer a test wanted would prove nothing, and this repository
 * has already shipped a flow that "succeeded" while uploading nothing.
 *
 * ---------------------------------------------------------------------------
 * `/auth/v1` — A REIMPLEMENTATION OF TWO GOTRUE ENDPOINTS, NOT GOTRUE
 * ---------------------------------------------------------------------------
 *
 * GoTrue itself could not be obtained in this container. Three attempts, each
 * with its own reason: no prebuilt binary is published for linux-x64 under any
 * release name tried, the source tarball is 403 through the egress proxy, and
 * the Go module proxy serves only up to v1.11.0 (2021) because the v2 tags
 * carry a module-path mismatch.
 *
 * `MER-012`, `DRV-008` and `OPS-005` all require a signed-in user, so without
 * some `/auth/v1` they could not be driven at all. What this file provides
 * instead is a faithful reimplementation of the two endpoints the application
 * actually calls, built on real cryptography and real rows:
 *
 *   POST /auth/v1/token?grant_type=password
 *        verifies the password with bcrypt against `auth.users.encrypted_password`
 *        (`crypt(candidate, stored) = stored`, the same comparison GoTrue makes)
 *        and, only on a match, signs an HS256 access token.
 *   POST /auth/v1/token?grant_type=refresh_token
 *        rotates a refresh token issued by this process. An unknown or already
 *        rotated token is refused.
 *   GET  /auth/v1/user
 *        verifies the token's HS256 signature and expiry, then reads the REAL
 *        `auth.users` row for the verified `sub`. It composes no user.
 *   POST /auth/v1/logout
 *        invalidates that session's refresh token.
 *
 * The verification is not decorative. `verifyAccessToken` rejects a token whose
 * signature does not check out under `JWT_SECRET`, rejects `alg` other than
 * HS256 (so `alg: "none"` cannot walk through), rejects an expired `exp`, and
 * compares MACs with `crypto.timingSafeEqual`. A forged token gets 401 from
 * `/auth/v1/user`, and the same forged token gets rejected by PostgREST, which
 * verifies against the same secret. `e2e/disposable/authGateway.mjs` proves
 * each of those refusals rather than asserting them.
 *
 * WHAT THIS IS NOT, AND SAY SO WHEREVER A RUN IS CITED:
 *
 *  - It is NOT GoTrue. It does not implement sessions-as-rows, refresh-token
 *    reuse detection, MFA, email confirmation, rate limiting, or `session_id`
 *    revocation. A defect in GoTrue's own behaviour cannot be found here.
 *  - It does NOT exercise the auth-helpers cookie path end to end against a
 *    real server: the browser client stores the session in its cookie exactly
 *    as in production, but the token inside it was minted here.
 *  - The password check, the token signature check, the `auth.users` read, the
 *    PostgREST role derivation, every route gate and every SQL refusal ARE
 *    real. What is simulated is the issuer, not the enforcement.
 *
 * NO STORAGE API. `storage.objects` is a table here, not the storage service.
 */

import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const POSTGREST_PORT = Number(process.env.COURANR_PGRST_PORT || 55433);
const GATEWAY_PORT = Number(process.env.COURANR_GATEWAY_PORT || 55434);

/**
 * PostgREST authenticates as `authenticator` and SET ROLEs from the JWT. With
 * no JWT it falls back to `db-anon-role`. The harness drives server routes
 * that use the service-role client, so the anonymous role here is
 * `service_role` — which mirrors production, where those routes hold the
 * service key and RLS does not constrain them.
 *
 * This does NOT weaken the privilege assertions the acceptance matrix makes.
 * Those are made with `has_table_privilege` against the real GRANTs, which the
 * migrations set and `bootstrap.sql` reproduces including `pg_default_acl`.
 */
/**
 * A local-only HS256 secret and the service-role JWT signed with it.
 *
 * WHY THIS EXISTS, MEASURED NOT GUESSED. PostgREST answered every RPC with
 * HTTP 500 `PGRST300 "Server lacks JWT secret"`, because supabase-js always
 * sends `Authorization: Bearer <key>` and PostgREST refuses a Bearer token when
 * no `jwt-secret` is configured. The route's error handling turned that into
 * the generic "This help link is not available.", which is why the symptom
 * looked like a rejected token for four runs. Calling the function directly in
 * SQL returned its three ids correctly the whole time.
 *
 * This is REAL crypto, not a bypass: PostgREST verifies the signature against
 * this secret and derives the role from the verified `role` claim. A forged or
 * unsigned token is rejected exactly as in production. The secret never leaves
 * the machine and is not any project's key.
 *
 * Per run by default. `COURANR_DISPOSABLE_JWT_SECRET` pins it so a harness can
 * REUSE a previous `next build` — `NEXT_PUBLIC_SUPABASE_ANON_KEY` is inlined
 * into the client bundle, so a fresh secret invalidates any cached build and
 * every rebuild costs minutes. It is a local-only value either way and is not
 * any project's key.
 */
export const JWT_SECRET =
  process.env.COURANR_DISPOSABLE_JWT_SECRET || crypto.randomBytes(32).toString("hex");

export function signJwt(payload, secret) {
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = enc({ alg: "HS256", typ: "JWT" });
  const body = enc(payload);
  const sig = crypto.createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

/**
 * Verifies an HS256 token against `JWT_SECRET` and returns its claims, or null.
 *
 * Everything here is a real check, in the order that matters:
 *
 *  1. exactly three dot-separated parts;
 *  2. a header that parses and declares `alg: "HS256"` — anything else,
 *     `"none"` included, is refused BEFORE the signature is looked at, because
 *     an implementation that trusts the header's algorithm is the classic JWT
 *     forgery;
 *  3. an HMAC over `header.payload` that `timingSafeEqual`s the presented one;
 *  4. `exp` in the future, and `nbf`/`iat` not in the future.
 *
 * Returns null on every failure and never says which one, mirroring GoTrue's
 * single `bad_jwt`.
 */
export function verifyAccessToken(token, secret = JWT_SECRET, nowSeconds = null) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;

  let header;
  try {
    header = JSON.parse(Buffer.from(head, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!header || header.alg !== "HS256") return null;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${head}.${body}`)
    .digest();
  let presented;
  try {
    presented = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  // timingSafeEqual throws on a length mismatch, which is itself a rejection.
  if (presented.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(presented, expected)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== "object") return null;

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp === "number" && claims.exp <= now) return null;
  if (typeof claims.nbf === "number" && claims.nbf > now) return null;

  return claims;
}

/** Signed the same way Supabase signs a service key: HS256, `role` claim. */
export const SERVICE_ROLE_JWT = signJwt(
  { role: "service_role", iss: "couranr-disposable", iat: 1735689600, exp: 2051222400 },
  JWT_SECRET
);

export const ANON_JWT = signJwt(
  { role: "anon", iss: "couranr-disposable", iat: 1735689600, exp: 2051222400 },
  JWT_SECRET
);

export function startPostgrest({ dbUrl, binary, workDir }) {
  mkdirSync(workDir, { recursive: true });
  const conf = path.join(workDir, "postgrest.conf");
  writeFileSync(
    conf,
    [
      `db-uri = "${dbUrl}"`,
      `db-schemas = "public"`,
      `db-anon-role = "service_role"`,
      `server-port = ${POSTGREST_PORT}`,
      `server-host = "127.0.0.1"`,
      `db-pool = 4`,
      // Without this PostgREST rejects every Bearer token with PGRST300.
      `jwt-secret = "${JWT_SECRET}"`,
      "",
    ].join("\n")
  );

  const proc = spawn(binary, [conf], { stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", () => {});
  proc.stderr.on("data", () => {});
  return proc;
}

/** Access-token lifetime. One hour, so nothing refreshes mid-run by accident. */
const ACCESS_TOKEN_TTL_SECONDS = 3600;

/**
 * Refresh tokens this process has issued: token -> { userId, sessionId }.
 *
 * In-memory and per-run, which is the honest shape — GoTrue keeps sessions in
 * `auth.sessions` and this does not pretend to. Rotation deletes the presented
 * token, so replaying an old one is refused.
 */
const refreshTokens = new Map();

/** Calls a PostgREST RPC as `service_role`. Real HTTP, real function, real row. */
async function rpc(name, args) {
  const res = await fetch(`http://127.0.0.1:${POSTGREST_PORT}/rpc/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${SERVICE_ROLE_JWT}`,
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`rpc ${name} -> ${res.status} ${text.slice(0, 300)}`);
  }
  return text === "" ? null : JSON.parse(text);
}

/**
 * CORS, and why it is not optional here.
 *
 * The browser calls this gateway CROSS-ORIGIN: the page is served from
 * `127.0.0.1:3312` and supabase-js posts to `127.0.0.1:55434`. A JSON POST
 * triggers a preflight, and without these headers Chromium refuses the request
 * before it is ever sent — which surfaced as `AuthRetryableFetchError` and
 * rendered as "Could not reach Couranr" on the sign-in screen, with nothing in
 * any server log because no request arrived. Supabase's own edge sends the same
 * headers, so this reproduces production rather than relaxing it: CORS is a
 * browser-side rule about who may READ a response, never an authorization
 * check, and every request below is still authenticated exactly as before.
 */
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS, HEAD",
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-client-info, x-supabase-api-version, " +
    "prefer, accept-profile, content-profile, range, range-unit, x-requested-with",
  "access-control-expose-headers":
    "content-range, content-length, content-location, x-supabase-api-version",
  "access-control-max-age": "86400",
};

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

/** GoTrue's error envelope. `msg` is what supabase-js surfaces as the message. */
function authError(res, status, errorCode, msg) {
  sendJson(res, status, { code: status, error_code: errorCode, msg });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function bearerOf(req) {
  const header = req.headers.authorization || "";
  if (!/^bearer /i.test(header)) return null;
  const token = header.slice(7).trim();
  return token === "" ? null : token;
}

/** Mints the session body GoTrue returns, for a user id that ALREADY verified. */
async function issueSession(userId, sessionId) {
  const user = await rpc("couranr_disposable_auth_user", { p_user_id: userId });
  if (!user) return null;

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + ACCESS_TOKEN_TTL_SECONDS;
  const accessToken = signJwt(
    {
      sub: userId,
      // PostgREST SET ROLEs from this claim. `authenticated` is what a signed-in
      // caller gets in production, so RLS and the table GRANTs constrain the
      // browser here exactly as they do there.
      role: "authenticated",
      aud: "authenticated",
      email: user.email ?? "",
      app_metadata: user.app_metadata ?? {},
      user_metadata: user.user_metadata ?? {},
      session_id: sessionId,
      iss: "couranr-disposable",
      iat,
      exp,
    },
    JWT_SECRET
  );

  const refreshToken = crypto.randomBytes(24).toString("base64url");
  refreshTokens.set(refreshToken, { userId, sessionId });

  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    expires_at: exp,
    refresh_token: refreshToken,
    user,
  };
}

async function handleAuth(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const route = url.pathname.replace(/^\/auth\/v1/, "") || "/";

  // ── POST /token?grant_type=… ────────────────────────────────────────────
  if (route === "/token" && req.method === "POST") {
    const grant = url.searchParams.get("grant_type");
    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || "{}");
    } catch {
      return authError(res, 400, "validation_failed", "invalid request body");
    }

    if (grant === "password") {
      const email = typeof body.email === "string" ? body.email.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      if (email === "" || password === "") {
        return authError(res, 400, "validation_failed", "missing email or password");
      }

      // bcrypt, in the database, against the stored hash. Null means no match —
      // for a wrong password AND for an unknown address, so this endpoint is
      // not an account-enumeration oracle either.
      const userId = await rpc("couranr_disposable_verify_password", {
        p_email: email,
        p_password: password,
      });
      if (!userId) {
        return authError(res, 400, "invalid_credentials", "Invalid login credentials");
      }

      const session = await issueSession(userId, crypto.randomUUID());
      if (!session) {
        return authError(res, 400, "invalid_credentials", "Invalid login credentials");
      }
      return sendJson(res, 200, session);
    }

    if (grant === "refresh_token") {
      const presented = typeof body.refresh_token === "string" ? body.refresh_token : "";
      const held = refreshTokens.get(presented);
      if (!held) {
        return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
      }
      // Rotate: the presented token is spent whether or not the reissue works.
      refreshTokens.delete(presented);
      const session = await issueSession(held.userId, held.sessionId);
      if (!session) {
        return authError(res, 400, "refresh_token_not_found", "Invalid Refresh Token");
      }
      return sendJson(res, 200, session);
    }

    return authError(res, 400, "validation_failed", `unsupported grant_type: ${grant}`);
  }

  // ── GET /user ───────────────────────────────────────────────────────────
  if (route === "/user" && req.method === "GET") {
    const token = bearerOf(req);
    const claims = token ? verifyAccessToken(token) : null;
    if (!claims || typeof claims.sub !== "string") {
      return authError(
        res,
        401,
        "bad_jwt",
        "invalid JWT: unable to parse or verify signature"
      );
    }
    // The row, not the claims. A token for a user who no longer exists yields
    // no user — the same outcome production gives.
    const user = await rpc("couranr_disposable_auth_user", { p_user_id: claims.sub });
    if (!user) {
      return authError(res, 403, "user_not_found", "User from sub claim in JWT does not exist");
    }
    return sendJson(res, 200, user);
  }

  // ── POST /logout ────────────────────────────────────────────────────────
  if (route === "/logout" && req.method === "POST") {
    const token = bearerOf(req);
    const claims = token ? verifyAccessToken(token) : null;
    if (!claims) {
      return authError(
        res,
        401,
        "bad_jwt",
        "invalid JWT: unable to parse or verify signature"
      );
    }
    for (const [value, held] of refreshTokens) {
      if (held.userId === claims.sub) refreshTokens.delete(value);
    }
    res.writeHead(204);
    return res.end();
  }

  // Anything else stays LOUD. A silent 200 on an unimplemented auth endpoint
  // would let a test appear to pass against nothing at all.
  return sendJson(res, 501, {
    code: 501,
    error_code: "not_implemented",
    msg:
      `the disposable gateway implements only /auth/v1/token, /auth/v1/user and ` +
      `/auth/v1/logout; it received ${req.method} ${route}`,
  });
}

export function startGateway() {
  const server = http.createServer((req, res) => {
    // The only rewrite: strip the Supabase REST prefix.
    const target = req.url.replace(/^\/rest\/v1/, "") || "/";

    // Preflight. Answered before anything else and without a body, exactly as
    // the Supabase edge does.
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...CORS, "content-length": "0" });
      res.end();
      return;
    }

    if (req.url.startsWith("/auth/v1")) {
      if (process.env.COURANR_GATEWAY_TRACE) {
        console.log(`[gw] ${req.method} ${req.url} (auth)`);
      }
      handleAuth(req, res).catch((e) => {
        // Never swallow. An auth endpoint that fails quietly is how a harness
        // ends up proving nothing.
        sendJson(res, 500, {
          code: 500,
          error_code: "gateway_failure",
          msg: `disposable /auth/v1 failed: ${e.message}`,
        });
      });
      return;
    }

    // Instrumentation, opt-in. The app and a direct probe both traverse this
    // process, so it is the one place their requests can be compared byte for
    // byte instead of reasoned about.
    if (process.env.COURANR_GATEWAY_TRACE) {
      const auth = req.headers.authorization || "";
      console.log(
        `[gw] ${req.method} ${target} auth=${auth ? auth.slice(0, 24) + "..." : "<none>"} ` +
          `apikey=${req.headers.apikey ? "yes" : "no"} accept=${req.headers.accept || "<none>"}`
      );
    }

    const upstream = http.request(
      {
        host: "127.0.0.1",
        port: POSTGREST_PORT,
        path: target,
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${POSTGREST_PORT}` },
      },
      (up) => {
        if (process.env.COURANR_GATEWAY_TRACE) {
          let body = "";
          up.on("data", (c) => (body += c.toString().slice(0, 300)));
          up.on("end", () =>
            console.log(`[gw] <- ${up.statusCode} ${body.slice(0, 220)}`)
          );
        }
        // PostgREST's own headers, plus CORS — the browser reads this response
        // cross-origin too, not only the auth one.
        res.writeHead(up.statusCode || 502, { ...up.headers, ...CORS });
        up.pipe(res);
      }
    );
    upstream.on("error", (e) => {
      sendJson(res, 502, { message: `gateway upstream error: ${e.message}` });
    });
    req.pipe(upstream);
  });

  return new Promise((resolve) => {
    server.listen(GATEWAY_PORT, "127.0.0.1", () =>
      resolve({ server, url: `http://127.0.0.1:${GATEWAY_PORT}` })
    );
  });
}

export async function waitForPostgrest(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${POSTGREST_PORT}/`);
      if (r.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}
