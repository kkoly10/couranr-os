import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatPickupCredentialPayload,
  parsePickupCredentialPayload,
} from "@/lib/couranr/driver/pickupCredential";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const DELIVERY_A = "11111111-1111-4111-8111-111111111111";
const DELIVERY_B = "22222222-2222-4222-8222-222222222222";

describe("Pickup Handoff V2 credential payload", () => {
  it("round-trips only delivery identity plus the six-digit fallback", () => {
    const payload = formatPickupCredentialPayload(DELIVERY_A, "472915");
    expect(payload).toBe(
      "couranr-pickup-v1|11111111-1111-4111-8111-111111111111|472915"
    );
    expect(parsePickupCredentialPayload(payload, DELIVERY_A)).toEqual({
      deliveryId: DELIVERY_A,
      code: "472915",
    });
    for (const forbidden of [
      "phone",
      "address",
      "recipient",
      "merchant",
      "price",
      "tracking",
      "token",
    ]) {
      expect(payload.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("rejects a valid Couranr QR for another delivery before verification", () => {
    const payload = formatPickupCredentialPayload(DELIVERY_A, "472915");
    expect(parsePickupCredentialPayload(payload, DELIVERY_B)).toBeNull();
  });

  it("rejects malformed, non-six-digit and extra-field payloads", () => {
    expect(parsePickupCredentialPayload("couranr-pickup-v1|bad|472915")).toBeNull();
    expect(
      parsePickupCredentialPayload(
        `couranr-pickup-v1|${DELIVERY_A}|47291`,
        DELIVERY_A
      )
    ).toBeNull();
    expect(
      parsePickupCredentialPayload(
        `couranr-pickup-v1|${DELIVERY_A}|472915|extra`,
        DELIVERY_A
      )
    ).toBeNull();
    expect(() => formatPickupCredentialPayload(DELIVERY_A, "12345")).toThrow();
  });
});

describe("Pickup Handoff V2 authority fences", () => {
  const migration = read(
    "supabase/migrations/20260905190000_couranr_pickup_handoff_v2.sql"
  );

  it("makes the consumer credential issuer attributable and service-role-only", () => {
    expect(migration).toContain("couranr_hc_issuer_xor_chk");
    expect(migration).toContain(
      "check ((issued_by is null) <> (issued_by_guest_session_id is null))"
    );
    expect(migration).toMatch(
      /revoke all on function public\.couranr_issue_guest_pickup_code_cas[\s\S]*from public,anon,authenticated;/
    );
    expect(migration).toMatch(
      /grant execute on function public\.couranr_issue_guest_pickup_code_cas[\s\S]*to service_role;/
    );
    expect(migration).toContain("request_id=v_session.request_id");
  });

  it("freezes the sender manifest into a new delivery without backfilling history", () => {
    expect(migration).toContain("before insert on public.couranr_deliveries");
    expect(migration).toContain("'{pickupManifest}'");
    expect(migration).not.toMatch(
      /update\s+public\.couranr_deliveries[\s\S]{0,250}pickupManifest/i
    );
  });

  it("enforces the pickup manifest at the server request-state boundary", () => {
    expect(migration).toContain("pickup_manifest_policy_version");
    expect(migration).toContain("couranr_pickup_manifest_v2_insert_trg");
    expect(migration).toContain("couranr_pickup_manifest_v2_advance_trg");
    expect(migration).toContain("pickup_manifest_required");
    expect(migration).toContain("pickup_manifest_authority_invalid");
    expect(migration).toContain("merchant_confirmed");
    expect(migration).toContain("new.request_state not in ('cancelled','declined','closed')");

    // Existing requests are grandfathered: the marker is stamped only on new
    // INSERTs. There is deliberately no UPDATE/backfill of old request rows.
    expect(migration).toContain(
      "new.pickup_manifest_policy_version := 'pickup-handoff-v2'"
    );
    expect(migration).not.toMatch(
      /update\s+public\.couranr_delivery_requests[\s\S]{0,180}pickup_manifest_policy_version/i
    );
  });

  it("requires objective custody evidence and no routine driver restatement", () => {
    const start = migration.indexOf(
      "create or replace function public.couranr_complete_pickup_v2"
    );
    const end = migration.indexOf(
      "revoke all on function public.couranr_complete_pickup_v2",
      start
    );
    const sql = migration.slice(start, end);
    expect(sql).toContain("code_state='consumed'");
    expect(sql).toContain("proof_type='shipment_photo'");
    expect(sql).toContain("pickup_discrepancy_open");
    expect(sql).toContain("proof_type='securement_photo'");
    expect(sql).toContain("'matchedExpected',true");
    for (const legacyParameter of [
      "p_observed_package_count",
      "p_staff_first_name",
      "p_confirmed_vehicle_id",
      "p_loading_participants",
      "p_loading_equipment",
      "p_existing_damage",
      "p_driver_acknowledged",
    ]) {
      expect(sql).not.toContain(legacyParameter);
    }
  });

  it("the browser route sends version + location, not duplicated pickup facts", () => {
    const route = read(
      "app/api/couranr/driver/deliveries/[id]/complete-pickup/route.ts"
    );
    expect(route).toContain("expectedVersion");
    expect(route).toContain("latitude");
    expect(route).toContain("longitude");
    for (const legacy of [
      "observedPackageCount",
      "staffFirstName",
      "confirmedVehicleId",
      "loadingParticipants",
      "loadingEquipment",
      "existingDamage",
      "driverAcknowledged",
    ]) {
      expect(route).not.toContain(legacy);
    }
  });

  it("the driver happy path exposes the exception escape hatch instead of overwrite fields", () => {
    const ui = read("components/couranr/dispatch/PickupFlow.tsx");
    expect(ui).toContain("Something is different");
    expect(ui).toContain("Photo of the pickup");
    expect(ui).toContain("Confirm pickup");
    for (const legacyPrompt of [
      "Packages you are collecting",
      "First name of the person handing it over",
      "Photo of its condition",
      "I am loading this shipment into",
      "Who loaded the shipment",
      "Equipment used to load it",
      "Damage the shipment already has",
    ]) {
      expect(ui).not.toContain(legacyPrompt);
    }
  });

  it("records the owner amendment that supersedes the old routine checklist", () => {
    const registry = JSON.parse(read("02_DECISION_REGISTRY.json"));
    const prf1 = registry.decisions.find((d: any) => d.id === "PRF-001");
    const prf2 = registry.decisions.find((d: any) => d.id === "PRF-002");
    expect(prf1.amended_by).toContain("PRF-002");
    expect(prf2.amends).toBe("PRF-001");
    expect(prf2.value.driver_does_not_reenter).toEqual(
      expect.arrayContaining([
        "expected package count",
        "merchant or staff first name",
        "assigned vehicle",
      ])
    );
  });
});
