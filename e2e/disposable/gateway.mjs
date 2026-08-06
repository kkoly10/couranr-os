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
 * WHAT IT DELIBERATELY DOES NOT PROVIDE — state this wherever a run is cited
 * ---------------------------------------------------------------------------
 *
 * NO AUTH. There is no `/auth/v1`. GoTrue could not be obtained in this
 * container — no prebuilt binary is published for linux-x64 under any release
 * name tried, the source tarball is 403 through the egress proxy, and the Go
 * module proxy serves only up to v1.11.0 (2021) because the v2 tags carry a
 * module-path mismatch. Three attempts, each with its own reason.
 *
 * So this gateway serves ONLY surfaces that need no session. That is exactly
 * `/help/[token]`, which is a public route holding a signed token: `PUB-007`,
 * and the two fragment variants `CUS-001` and `CUS-003`.
 *
 * `MER-012`, `DRV-008` and `OPS-005` all require a signed-in user, and the
 * repository's own rule is that a server route resolves the actor with
 * `supabaseAdmin.auth.getUser(token)` — a real call to GoTrue, never a local
 * decode. They CANNOT be driven here, and pretending otherwise by minting a
 * token this gateway then accepts would be the stub this file exists not to be.
 *
 * NO STORAGE API. `storage.objects` is a table here, not the storage service.
 */

import http from "node:http";
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
      "",
    ].join("\n")
  );

  const proc = spawn(binary, [conf], { stdio: ["ignore", "pipe", "pipe"] });
  proc.stdout.on("data", () => {});
  proc.stderr.on("data", () => {});
  return proc;
}

export function startGateway() {
  const server = http.createServer((req, res) => {
    // The only rewrite: strip the Supabase REST prefix.
    const target = req.url.replace(/^\/rest\/v1/, "") || "/";

    if (req.url.startsWith("/auth/v1")) {
      // Fail LOUD rather than pretending. A silent 200 here would let an
      // authenticated test appear to pass against no auth at all.
      res.writeHead(501, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          message:
            "the disposable gateway serves no /auth/v1: GoTrue is not available in this container, " +
            "so authenticated surfaces cannot be driven here",
        })
      );
      return;
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
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      }
    );
    upstream.on("error", (e) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: `gateway upstream error: ${e.message}` }));
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
