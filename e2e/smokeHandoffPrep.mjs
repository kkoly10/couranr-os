import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } });
const PW = "Smoke-" + Buffer.from(process.hrtime.bigint().toString()).toString("base64url") + "-Aa1!";

const DRIVER_EMAIL = "couranr-e2e-spare-driver+rmsb0p2g3@example.com";
const OPS_EMAIL = "couranr-e2e-ops@example.com";
const DELIVERY = "f3fd9c34-66cd-4b75-9532-4b9149757828";

async function findUser(email) {
  let page = 1;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const u = data.users.find((x) => (x.email ?? "").toLowerCase() === email.toLowerCase());
    if (u) return u;
    if (data.users.length < 200) return null;
    page++;
  }
}
const drv = await findUser(DRIVER_EMAIL);
const ops = await findUser(OPS_EMAIL);
if (!drv || !ops) throw new Error(`missing fixture: driver=${!!drv} ops=${!!ops}`);

for (const u of [drv, ops]) {
  const { error } = await admin.auth.admin.updateUserById(u.id, {
    password: PW, email_confirm: true, ban_duration: "none" });
  if (error) throw new Error(`update ${u.email}: ${error.message}`);
}
await admin.from("profiles").update({ role: "admin" }).eq("id", ops.id);
await admin.from("profiles").update({ role: "driver" }).eq("id", drv.id);

writeFileSync("e2e/.smoke.json", JSON.stringify({
  password: PW, driver: { id: drv.id, email: DRIVER_EMAIL },
  ops: { id: ops.id, email: OPS_EMAIL }, deliveryId: DELIVERY }, null, 2), { mode: 0o600 });
console.log("prepared. driver + ops usable; delivery", DELIVERY);
