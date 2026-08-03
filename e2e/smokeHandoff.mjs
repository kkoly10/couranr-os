import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

/**
 * Handoff-credential smoke gate.
 *
 *   node e2e/smokeHandoffPrep.mjs      # marks fixtures usable, writes e2e/.smoke.json (0600, gitignored)
 *   node e2e/smokeHandoff.mjs A        # with COURANR_HANDOFF_CODE_SECRET ABSENT
 *   node e2e/smokeHandoff.mjs B        # with it present
 *
 * Phase A proves the PIN paths fail CLOSED: a sanitized internal error, no
 * credential row written, no attempt counter moved, and no configuration
 * detail in the response. Phase B proves the happy path and, critically, that
 * a caller who is not the assigned driver cannot burn an attempt — the hole
 * that shipped in the first cut of this layer.
 *
 * The raw code lives only in the issuance response. After a run, grep the
 * captured server output for any six-digit run; it must find none.
 */
const S = JSON.parse(readFileSync("e2e/.smoke.json", "utf8"));
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const pub = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const BASE = "http://localhost:3000";
const PHASE = process.argv[2];

let pass = 0, fail = 0;
const check = (id, desc, ok, detail = "") => {
  (ok ? pass++ : fail++);
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${desc}${detail ? `\n          ${detail}` : ""}`);
};

async function token(email) {
  const { data, error } = await pub.auth.signInWithPassword({ email, password: S.password });
  if (error) throw new Error(`${email}: ${error.message}`);
  return data.session.access_token;
}
async function api(tok, path, body) {
  const r = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${tok}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let payload = null;
  try { payload = await r.json(); } catch {}
  return { status: r.status, payload };
}
const codeRows = () => admin.from("couranr_handoff_codes").select("id,code_kind,generation,code_state,failed_attempts")
  .eq("delivery_id", S.deliveryId).order("generation", { ascending: true })
  .then(({ data }) => data ?? []);

const ops = await token(S.ops.email);
const drv = await token(S.driver.email);

if (PHASE === "A") {
  console.log("\nSmoke A — WITHOUT COURANR_HANDOFF_CODE_SECRET");
  const before = await codeRows();

  const iss = await api(ops, `/api/couranr/operations/deliveries/${S.deliveryId}/pickup-code`, {});
  check("A1", "PIN issuance fails closed", iss.status >= 500, `status=${iss.status}`);
  check("A2", "the failure is sanitized (no config detail, no env name)",
    !/SECRET|secret|handoff|env|placeholder|bytes/i.test(JSON.stringify(iss.payload ?? {})),
    JSON.stringify(iss.payload));
  const after = await codeRows();
  check("A3", "no credential row was written", after.length === before.length,
    `before=${before.length} after=${after.length}`);

  const ver = await api(drv, `/api/couranr/driver/deliveries/${S.deliveryId}/verify-pickup-code`, { code: "123456" });
  const after2 = await codeRows();
  check("A4", "PIN verification does not move any attempt counter",
    JSON.stringify(after2.map(r => r.failed_attempts)) === JSON.stringify(before.map(r => r.failed_attempts)),
    `status=${ver.status} counters=${JSON.stringify(after2.map(r => r.failed_attempts))}`);
  check("A5", "verification leaks no configuration detail",
    !/SECRET|handoff_secret|placeholder/i.test(JSON.stringify(ver.payload ?? {})), JSON.stringify(ver.payload));
}

if (PHASE === "B") {
  console.log("\nSmoke B — WITH the local secret");

  const iss = await api(ops, `/api/couranr/operations/deliveries/${S.deliveryId}/pickup-code`, {});
  const pickupCode = iss.payload?.handoffCode?.code;
  check("B1", "Operations issues a pickup PIN", iss.status === 200 && /^[0-9]{6}$/.test(pickupCode ?? ""),
    `status=${iss.status} shape=${/^[0-9]{6}$/.test(pickupCode ?? "") ? "six digits" : "BAD"}`);
  check("B2", "the response warns the code is shown once",
    typeof iss.payload?.handoffCode?.warning === "string" && iss.payload.handoffCode.warning.length > 20);
  check("B3", "the response carries no digest and no attempt count",
    !("digest" in (iss.payload?.handoffCode ?? {})) && !("failedAttempts" in (iss.payload?.handoffCode ?? {})) &&
    !/[0-9a-f]{64}/.test(JSON.stringify(iss.payload ?? {})));

  const wrong = await api(drv, `/api/couranr/driver/deliveries/${S.deliveryId}/verify-pickup-code`,
    { code: pickupCode === "000000" ? "111111" : "000000" });
  check("B4", "a wrong PIN returns data, not an error", wrong.status === 200 && wrong.payload?.outcome === "invalid",
    `status=${wrong.status} outcome=${wrong.payload?.outcome}`);
  const rows1 = await codeRows();
  const live1 = rows1.filter(r => r.code_kind === "merchant_pickup").at(-1);
  check("B5", "the wrong attempt incremented the persisted counter", live1?.failed_attempts === 1,
    `failed_attempts=${live1?.failed_attempts}`);

  const right = await api(drv, `/api/couranr/driver/deliveries/${S.deliveryId}/verify-pickup-code`, { code: pickupCode });
  check("B6", "the correct pickup PIN is accepted", right.payload?.outcome === "accepted",
    `outcome=${right.payload?.outcome}`);

  const iss2 = await api(ops, `/api/couranr/operations/deliveries/${S.deliveryId}/recipient-code`, {});
  const recipientCode = iss2.payload?.handoffCode?.code;
  check("B7", "Operations issues a recipient PIN", iss2.status === 200 && /^[0-9]{6}$/.test(recipientCode ?? ""));
  check("B8", "the two credentials are independent codes/generations",
    iss2.payload?.handoffCode?.kind === "recipient_dropoff" && iss.payload?.handoffCode?.kind === "merchant_pickup",
    `pickupKind=${iss.payload?.handoffCode?.kind} recipientKind=${iss2.payload?.handoffCode?.kind}`);

  const rver = await api(drv, `/api/couranr/driver/deliveries/${S.deliveryId}/verify-recipient-code`, { code: recipientCode });
  check("B9", "the correct recipient PIN is accepted", rver.payload?.outcome === "accepted",
    `outcome=${rver.payload?.outcome}`);

  const pickupAfter = (await codeRows()).filter(r => r.code_kind === "merchant_pickup").at(-1);
  check("B10", "consuming the recipient PIN did not disturb the pickup credential",
    pickupAfter?.code_state === "consumed", `pickup state=${pickupAfter?.code_state}`);

  // A stranger (ops user is not the assigned driver) must not be able to burn attempts.
  const iss3 = await api(ops, `/api/couranr/operations/deliveries/${S.deliveryId}/pickup-code`, {});
  const before3 = (await codeRows()).filter(r => r.code_kind === "merchant_pickup").at(-1);
  const strangerTry = await api(ops, `/api/couranr/driver/deliveries/${S.deliveryId}/verify-pickup-code`, { code: "999999" });
  const after3 = (await codeRows()).filter(r => r.code_kind === "merchant_pickup").at(-1);
  check("B11", "a non-assigned caller cannot burn an attempt (the fixed hole)",
    strangerTry.status === 403 && after3?.failed_attempts === before3?.failed_attempts,
    `status=${strangerTry.status} counter ${before3?.failed_attempts}->${after3?.failed_attempts}`);
  void iss3;
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
