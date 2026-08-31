/** Run the read-only Gate A integrity RPC against the configured project. */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("couranr:integrity requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/couranr_foundation_integrity`, {
  method: "POST",
  headers: {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  },
  body: "{}",
  cache: "no-store",
});

if (!response.ok) {
  console.error(`couranr:integrity could not run (HTTP ${response.status})`);
  process.exit(2);
}

const issues = await response.json();
if (!Array.isArray(issues)) {
  console.error("couranr:integrity received an invalid result");
  process.exit(2);
}
if (issues.length === 0) {
  console.log("couranr:integrity PASS — no foundation invariant failures");
  process.exit(0);
}

console.error(`couranr:integrity FAIL — ${issues.length} invariant failure(s)`);
for (const issue of issues) {
  console.error(`${issue.issue_code} entity=${issue.entity_id ?? "none"} detail=${JSON.stringify(issue.detail ?? {})}`);
}
process.exit(1);
