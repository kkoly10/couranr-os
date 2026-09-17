import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Closure O — the generic pickup photo stops being demanded of a SECURE pickup.
 *
 * WHAT THESE TESTS ARE AND ARE NOT. Everything here reads FILES: it guards the
 * migration text, the rollback pairing and the client/server agreement. None of
 * it proves the database refuses anything — a CHECK that parses is not a CHECK
 * that refuses, and this repo has shipped a foreign key pointing at the wrong
 * table through 1230 green tests. The executed proof is §O of
 * `e2e/disposable/consumerTrustCustody.mjs`, which CALLS
 * `couranr_complete_pickup_v2` against a real PostgreSQL for every level and
 * reads what came back. Both are worth having; only one of them catches a
 * trigger body that does not fire.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const FORWARD = "supabase/migrations/20260917180000_couranr_secure_pickup_photo_burden.sql";
const ROLLBACK =
  "supabase/rollbacks/20260917180000_couranr_secure_pickup_photo_burden.rollback.sql";
const APPLIED = "supabase/migrations/20260905190000_couranr_pickup_handoff_v2.sql";

describe("closure O — the secure pickup photo burden", () => {
  const forward = read(FORWARD);
  const rollback = read(ROLLBACK);
  const applied = read(APPLIED);

  it("does not edit the migration that is already applied in production", () => {
    /* 20260905190000 is applied. Production picks up a correction only through a
       NEW forward migration, never through an edit to an applied one — an edit
       changes the repository and changes nothing about the running database. */
    expect(applied).toContain("if not exists (\n    select 1 from public.couranr_delivery_proofs");
    expect(applied).not.toContain("v_secure");
    expect(applied).not.toContain("couranr_delivery_protection_level");
  });

  it("replaces the function BY NAME with the same signature", () => {
    const signature =
      "public.couranr_complete_pickup_v2(\n" +
      "  p_delivery_id uuid,\n" +
      "  p_expected_version integer,\n" +
      "  p_actor_user_id uuid,\n" +
      "  p_latitude numeric,\n" +
      "  p_longitude numeric,\n" +
      "  p_accuracy_m numeric\n" +
      ")";
    expect(forward).toContain(`create or replace function ${signature}`);
    // A different signature would OVERLOAD rather than replace, leaving the old
    // body callable and the two disagreeing forever.
    expect(applied).toContain(`create or replace function ${signature}`);
  });

  it("uses the existing protection-level function rather than re-deriving", () => {
    expect(forward).toContain(
      "v_level := private.couranr_delivery_protection_level(p_delivery_id);"
    );
    // No second answer to "is this secure": no join to the request, no reading
    // of declared_value_cents or protection_policy_version in this file.
    expect(forward).not.toContain("declared_value_cents");
    expect(forward).not.toContain("protection_policy_version");
  });

  it("coalesces the level test, because null IN (...) is NULL and not false", () => {
    /* THE HISTORICAL SURFACE, reached by a three-valued-logic slip. With a bare
       `v_level in (...)`, an ungoverned delivery yields NULL, `if not NULL` does
       not execute, and every business and historical pickup silently STOPS
       requiring the photo. Proved by mutation: replacing this line with the bare
       IN turns §O/O3 from PASS to ACCEPTED. */
    expect(forward).toContain(
      "v_secure := coalesce(v_level in ('secure_pickup','protected_handoff'), false);"
    );
    expect(forward).toContain("if not v_secure and not exists (");
  });

  it("keeps the large-load securement rule byte-identical to the applied one", () => {
    const grab = (src: string, from: string, to: string) =>
      src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
    const rule = (src: string) =>
      grab(src, "  v_manifest := v_dlv.shipment->'pickupManifest';", "  insert into public.couranr_handoff_records(");
    // The securement photo is about the DRIVE, not the custody ceremony, so it
    // applies at every level and nothing about it moves in this migration.
    expect(rule(forward)).toBe(rule(applied));
    expect(rule(forward)).toContain("jsonb_typeof(v_manifest->'packageCount')='number'");
    expect(rule(forward)).toContain("securement_photo_required");
  });

  it("does not restate the custody sequence the trigger already owns", () => {
    /* Restating it would create a second answer to the same question and would
       miss couranr_complete_pickup (v1), which the trigger covers because it
       sits on the TRANSITION rather than inside one command. */
    /* The EXECUTABLE body only. The `comment on function` names the two photos
       on purpose — it points a reader at the rule that owns them — and a naive
       whole-file scan would read its own documentation as a duplication. */
    const body = forward.slice(
      forward.indexOf("as $fn$"),
      forward.indexOf("$fn$;", forward.indexOf("as $fn$"))
    );
    expect(body.length).toBeGreaterThan(1000);
    for (const owned of [
      "item_prepack_photo",
      "sealed_package_photo",
      "couranr_delivery_security_seals",
      "prepack_photo_must_precede_sealing",
    ]) {
      expect(body, `${owned} belongs to the custody trigger, not to this function`).not.toContain(
        owned
      );
    }
  });

  it("restates the revoke and the grant, because create-or-replace resets them", () => {
    /* pg_default_acl in this project grants EXECUTE on every new function in
       `public` to anon, authenticated AND service_role, so a replacement that
       omitted this would PUBLISH the function. Revoked from PUBLIC too: a
       privilege inherited through PUBLIC is not a grantee row and survives a
       narrower revoke. */
    const sig = "public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric)";
    for (const file of [forward, rollback]) {
      expect(file).toContain(`revoke all on function ${sig}\n  from public,anon,authenticated;`);
      expect(file).toContain(`grant execute on function ${sig}\n  to service_role;`);
    }
  });

  it("the rollback restores the applied body VERBATIM", () => {
    const start = applied.indexOf("create or replace function public.couranr_complete_pickup_v2(");
    const end = applied.indexOf("$fn$;", start) + "$fn$;".length;
    const original = applied.slice(start, end);
    expect(original.length).toBeGreaterThan(1000);
    expect(
      rollback,
      "a rollback that is not the original body leaves a half-way state nobody has run"
    ).toContain(original);
    // ...and clears the comment this migration adds, since the original set none.
    expect(rollback).toContain("comment on function public.couranr_complete_pickup_v2");
    expect(rollback).toContain("is null;");
  });

  it("is additive: no drop, no delete, no truncate", () => {
    const stripped = forward
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n")
      .map((l) => (l.indexOf("--") === -1 ? l : l.slice(0, l.indexOf("--"))))
      .join("\n");
    expect(stripped).not.toMatch(/\b(drop\s+table|drop\s+column|truncate|delete\s+from)\b/i);
  });

  it("the driver UI and the function agree on WHO owes the generic photo", () => {
    /* Both directions matter. If the UI kept demanding it the driver is blocked
       on a photo the server does not want; if the function kept demanding it and
       the UI stopped, the driver is waved through into a refusal with the sender
       standing in front of them. */
    const ui = read("components/couranr/dispatch/PickupFlow.tsx");
    expect(ui).toContain("if (!secure && !shipmentPhoto.finalized)");
    expect(ui).toContain("const secure = protection.requiresSecuritySeal;");
    // The field is not merely unblocking — it is not rendered for a secure
    // pickup, because a photo field on screen is a photo a driver takes.
    expect(ui).toContain("{secure ? null : (");
    // The securement photo survives at every level.
    expect(ui).toContain("Photo of the secured load");
  });

  it("the proof upload allow-list admits the two photos a secure pickup owes", () => {
    /* These were in the DATABASE vocabulary (couranr_dp_type_chk, 20260915090000)
       and demanded by the custody trigger, but absent from this list — so
       prepareProofUpload answered proof_type_not_valid_for_stage and neither
       photograph could be uploaded at all. Removing the generic photo without
       this leaves a secure pickup with no way to satisfy anything. */
    const proof = read("lib/couranr/driver/proof.ts");
    for (const type of ["item_prepack_photo", "sealed_package_photo", "dropoff_seal_photo"]) {
      expect(proof, `${type} is demanded by SQL and must be uploadable`).toContain(`"${type}"`);
    }
  });
});
