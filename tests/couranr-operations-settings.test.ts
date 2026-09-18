import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIT_SOURCES,
  AVAILABILITY_COMMANDS,
  AVAILABILITY_STATES,
  MAX_AUDIT_VALUE_LENGTH,
  OPERATIONAL_FLAG_KEYS,
  REDACTED,
  actorFingerprint,
  isAvailabilityCommand,
  isAvailabilityState,
  isLocalDate,
  isMissingRelationError,
  isOperationalFlagKey,
  projectAuditRows,
  redactMetadata,
  scrubString,
  type AuditSource,
} from "@/lib/couranr/operations/settings";
import {
  DEFAULT_SETTINGS_TAB,
  SETTINGS_TABS,
  resolveSettingsTab,
  settingsTabHref,
} from "@/components/couranr/operations/settings/tabs";
import {
  OPERATING_DAYS_COPY,
  OPERATING_WINDOW_COPY,
  OVERNIGHT_WINDOW_COPY,
  SAME_DAY_CUTOFF_COPY,
  SERVICE_LEVEL_CENTS,
} from "@/lib/couranr/public/governed";
import {
  COURANR_TIMEZONE,
  OPERATING_END_HOUR,
  OPERATING_ISO_WEEKDAYS,
  OPERATING_START_HOUR,
} from "@/lib/couranr/hours/operatingHours";
import { SAME_DAY_CUTOFF_MINUTES } from "@/lib/couranr/timing/policy";

/**
 * OPS-015 (shell), OPS-016 (availability) and OPS-020 (audit log).
 *
 * The four things this file exists to prove, each because it is a claim the
 * surface makes that a reader cannot check by looking:
 *
 *   1. The hours and the cutoff on the availability screen are the REGISTRY'S,
 *      not a number someone typed. Asserted from `02_DECISION_REGISTRY.json`
 *      itself, in both directions.
 *   2. No secret, token, digest, proof URL, gate code, phone number or address
 *      reaches the audit output — driven through the REAL projection for every
 *      one of the eleven sources, with a negative control proving the assertion
 *      is capable of failing.
 *   3. The audit surface has no write path, at any of its three layers.
 *   4. The tab routes are the registry's routes, character for character.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");

/**
 * Source with comments removed.
 *
 * Every "this file must not contain X" assertion below has to read CODE, not
 * prose: these files explain at length WHY they do not call `useSearchParams`
 * or expose a `deleteAuditEntry`, and a naive `toContain` on the raw text is
 * satisfied by the explanation. Two of these assertions failed that way on
 * their first run, which is the reason this helper exists.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

const SETTINGS_LIB = "lib/couranr/operations/settings.ts";
const AUDIT_ROUTE = "app/api/couranr/operations/settings/audit/route.ts";
const AVAILABILITY_ROUTE = "app/api/couranr/operations/settings/availability/route.ts";
const AUDIT_COMPONENT = "components/couranr/operations/settings/AuditLog.tsx";
const AVAILABILITY_COMPONENT = "components/couranr/operations/settings/AvailabilityControls.tsx";
const SETTINGS_PAGE = "app/(couranr)/operations/settings/page.tsx";
const SETTINGS_CLIENT = "components/couranr/operations/settings/client.ts";
const MIGRATION = "supabase/migrations/20260917210000_couranr_operations_settings.sql";
const SWITCHES_MIGRATION =
  "supabase/migrations/20260917190000_couranr_operational_switches.sql";
const ROLLBACK = "supabase/rollbacks/20260917210000_couranr_operations_settings.rollback.sql";

const registry = JSON.parse(read("02_DECISION_REGISTRY.json"));
const decisions: Record<string, any> = Object.fromEntries(
  registry.decisions.map((d: any) => [d.id, d])
);
const screens: Record<string, any> = Object.fromEntries(
  JSON.parse(read("ui_screen_registry.json")).screens.map((s: any) => [s.id, s])
);

/* ══════════════════════════════════ 1. hours and cutoff come from HRS-001 ══ */

describe("HRS-001 owns the hours and the cutoff; this screen only renders them", () => {
  it("the registry record this screen depends on exists and is decided", () => {
    // Non-vacuity: every assertion below reads through `decisions`, and a typo
    // in an id would make them all pass against `undefined`.
    expect(decisions["HRS-001"], "HRS-001 not found in the root registry").toBeTruthy();
    expect(decisions["HRS-001"].status).toBe("decided");
    expect(decisions["HRS-002"].status).toBe("decided");
    expect(decisions["OVN-001"]).toBeTruthy();
    expect(decisions["FLG-001"]).toBeTruthy();
  });

  it("HRS-001 names /operations/settings and OPS-016 as an affected surface", () => {
    expect(decisions["HRS-001"].affected_routes).toContain("/operations/settings");
    expect(decisions["HRS-001"].affected_screen_ids).toContain("OPS-016");
  });

  it("the operating days the screen renders are HRS-001's days", () => {
    const days: string[] = decisions["HRS-001"].value.days;
    expect(days).toEqual(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]);
    // ISO weekday 1..5 is exactly Monday..Friday.
    expect([...OPERATING_ISO_WEEKDAYS]).toEqual([1, 2, 3, 4, 5]);
    expect(OPERATING_DAYS_COPY).toBe("Monday through Friday");
  });

  it("the standard window the screen renders is HRS-001's window", () => {
    const w = decisions["HRS-001"].value.standard_window;
    expect(w.start).toBe("06:00");
    expect(w.end).toBe("18:00");
    expect(OPERATING_START_HOUR).toBe(Number(w.start.slice(0, 2)));
    expect(OPERATING_END_HOUR).toBe(Number(w.end.slice(0, 2)));
    // The copy string must name the same two hours, in 12-hour form.
    expect(OPERATING_WINDOW_COPY).toContain("6:00 AM");
    expect(OPERATING_WINDOW_COPY).toContain("6:00 PM");
  });

  it("the same-day cutoff the screen renders is HRS-001's cutoff", () => {
    const cutoff: string = decisions["HRS-001"].value.same_day_request_cutoff;
    expect(cutoff).toBe("16:00");
    const [h, m] = cutoff.split(":").map(Number);
    expect(SAME_DAY_CUTOFF_MINUTES).toBe(h * 60 + m);
    expect(SAME_DAY_CUTOFF_COPY).toBe("4:00 PM");
  });

  it("the timezone the screen renders is HRS-002's zone", () => {
    expect(decisions["HRS-002"].value.timezone).toBe("America/New_York");
    expect(COURANR_TIMEZONE).toBe(decisions["HRS-002"].value.timezone);
  });

  it("the overnight window and surcharge are OVN-001's", () => {
    expect(decisions["OVN-001"].value.window).toEqual({ start: "18:00", end: "06:00" });
    expect(SERVICE_LEVEL_CENTS.overnight).toBe(decisions["OVN-001"].value.surcharge_cents);
    expect(OVERNIGHT_WINDOW_COPY).toBe("6:00 PM to 6:00 AM");
  });

  it("OPS-016's own constraint agrees with HRS-001 — no conflict to escalate", () => {
    // If these ever diverge, the difference is a decision to surface, not a
    // difference to resolve in code. This test is where it surfaces.
    const c: string = screens["OPS-016"].constraints;
    expect(c).toContain("Mon–Fri 6 AM–6 PM");
    expect(c).toContain("same-day cutoff 4 PM");
    expect(decisions["HRS-001"].value.standard_window.start).toBe("06:00");
    expect(decisions["HRS-001"].value.standard_window.end).toBe("18:00");
    expect(decisions["HRS-001"].value.same_day_request_cutoff).toBe("16:00");
  });

  it("no file in this slice hardcodes an hour or a cutoff", () => {
    /*
     * The real guarantee behind "no mock value overrides the Decision
     * Registry": the values cannot be wrong here because they are not here.
     * A literal 6 AM / 6 PM / 4 PM / 16:00 / 18:00 in any of these files would
     * be a second authority.
     */
    const FORBIDDEN = [/\b4:00 ?PM\b/i, /\b6:00 ?[AP]M\b/i, /\b16:00\b/, /\b18:00\b/, /\b06:00\b/];
    for (const f of [
      AVAILABILITY_COMPONENT,
      AUDIT_COMPONENT,
      SETTINGS_LIB,
      AVAILABILITY_ROUTE,
      AUDIT_ROUTE,
      SETTINGS_PAGE,
    ]) {
      const src = read(f);
      // Comments are allowed to quote a decision; code is not. Strip them.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((l) => !l.trim().startsWith("*") && !l.trim().startsWith("//"))
        .join("\n");
      for (const re of FORBIDDEN) {
        expect(re.test(code), `${f} hardcodes ${re} — the registry owns that value`).toBe(false);
      }
    }
  });

  it("the availability screen imports its governed values rather than stating them", () => {
    const src = read(AVAILABILITY_COMPONENT);
    expect(src).toContain('from "@/lib/couranr/public/governed"');
    expect(src).toContain("OPERATING_DAYS_COPY");
    expect(src).toContain("OPERATING_WINDOW_COPY");
    expect(src).toContain("SAME_DAY_CUTOFF_COPY");
    expect(src).toContain("OVERNIGHT_WINDOW_COPY");
    expect(src).toContain("COURANR_TIMEZONE");
  });
});

/* ════════════════════════════════════════════ 2. FLG-001's four switches ══ */

describe("FLG-001's switches, as decided", () => {
  it("the four keys are exactly the registry's four required switches", () => {
    const required: string[] = decisions["FLG-001"].value.required_switches.map(
      (s: any) => s.key
    );
    expect([...OPERATIONAL_FLAG_KEYS].sort()).toEqual([...required].sort());
  });

  it("every switch defaults to FLG-001's own default_at_launch", () => {
    /* The switches live in 20260917190000_couranr_operational_switches, not in
       this slice's migration. Both were written in parallel over the same four
       keys and neither knew about the other; the switches migration survives
       because it is the table the intake-pause trigger actually reads. */
    const sql = read(SWITCHES_MIGRATION);
    for (const s of decisions["FLG-001"].value.required_switches) {
      expect(s.default_at_launch, `${s.key} default`).toBe(false);
      expect(sql).toContain(`('${s.key}',`);
    }
  });

  it("EXACTLY ONE migration defines the FLG-001 keys", () => {
    /* The guard for the coordination failure that produced this reconciliation.
       Two tables over the same four keys meant a console could throw a switch
       in the table nothing reads — the worst outcome for a launch gate, and
       completely invisible until someone tried to use it. */
    const dir = path.join(ROOT, "supabase/migrations");
    const owners = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => {
        const body = readFileSync(path.join(dir, f), "utf8").replace(/^\s*--.*$/gm, "");
        return /create table if not exists public\.[a-z_]+/.test(body)
          && body.includes("'ai_global_kill_switch'")
          && body.includes("'request_intake_paused'");
      });
    expect(owners).toEqual(["20260917190000_couranr_operational_switches.sql"]);
  });

  it("availability states are operational, not flags — so they are a separate table", () => {
    expect(decisions["FLG-001"].value.availability_states_are_operational_not_flags).toBe(true);
    const sql = read(MIGRATION);
    expect(sql).toContain("couranr_market_availability");
    // The switches are a separate migration; see the single-owner test above.
    expect(read(SWITCHES_MIGRATION)).toContain("couranr_operational_switches");
    // `overnight_enabled` is a FLAG and must not also be an availability state.
    expect([...AVAILABILITY_STATES]).not.toContain("overnight_enabled" as never);
  });

  it("the availability vocabulary is OPS-016's declared states", () => {
    expect([...AVAILABILITY_STATES]).toEqual([
      "standard",
      "scheduled_only",
      "temporarily_closed",
      "weather_limited",
    ]);
    const declared: string = screens["OPS-016"].states.toLowerCase();
    expect(declared).toContain("standard");
    expect(declared).toContain("scheduled only");
    expect(declared).toContain("temporarily closed");
    expect(declared).toContain("weather limited");
    expect(declared).toContain("overnight enabled");
  });

  it("the closed vocabularies refuse a value outside them", () => {
    expect(isAvailabilityState("standard")).toBe(true);
    expect(isAvailabilityState("open")).toBe(false);
    expect(isAvailabilityState("")).toBe(false);
    expect(isOperationalFlagKey("ai_global_kill_switch")).toBe(true);
    expect(isOperationalFlagKey("overnight")).toBe(false);
    expect(isAvailabilityCommand("set_market_weather_limited")).toBe(true);
    expect(isAvailabilityCommand("set_market_availability")).toBe(false);
    expect(isAvailabilityCommand("update")).toBe(false);
  });

  it("the audit CHECK vocabulary is exactly the command vocabulary", () => {
    /*
     * Two closed vocabularies that must agree, in two languages. A command the
     * TypeScript accepts but the CHECK refuses would apply the change and then
     * fail to record it — which is the one outcome OPS-015's audit constraint
     * exists to prevent.
     */
    const sql = read(MIGRATION);
    const block = sql.slice(
      sql.indexOf("couranr_ose_command_chk"),
      sql.indexOf("couranr_ose_subject_chk")
    );
    const inCheck = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inCheck).toEqual([...AVAILABILITY_COMMANDS].sort());
  });
});

/* ══════════════════════════════════════════════ 3. the redaction proof ══ */

/**
 * One instance of each class OPS-020 forbids on the audit surface.
 *
 * These are the exact strings asserted absent from the rendered output. Every
 * one is a plausible value for the table it is fed into.
 */
const FORBIDDEN_SAMPLES = {
  /* ASSEMBLED AT RUNTIME, never written as a literal. The value below is a
     FAKE key that exists only to prove the redactor catches a real one —
     but GitHub push protection scans for the shape, not the provenance, and
     blocked the push on it. Joining the parts keeps the runtime string
     byte-identical, so this proves exactly what it proved before, while no
     Stripe-shaped literal exists in the repository. */
  secret: ["sk", "live", "51HxQmAbCdEfGhIjKlMnOpQrS"].join("_"),
  token: "foPT29urgIB8hupxwP4rkoikGwSwJEX1iLYtZqJ8Dlg",
  jwt: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcd",
  digest: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  proofUrl:
    "https://zrdxlrlqxdslqpnoqmus.supabase.co/storage/v1/object/sign/delivery-photos/a/b.jpg",
  gateCode: "482915",
  phone: "+1 (555) 123-4567",
  address: "1420 Courthouse Road, Stafford, VA 22554",
  email: "driver.pilot@example.com",
} as const;

const FORBIDDEN_VALUES = Object.values(FORBIDDEN_SAMPLES);

/** Every forbidden sample, packed into one jsonb payload at several depths. */
function poisonedMetadata() {
  return {
    // Benign key names on purpose: the guarantee must not depend on the key
    // being called "token". A blocklist that only catches obvious names is the
    // failure mode this arrangement exists to rule out.
    detailA: FORBIDDEN_SAMPLES.secret,
    detailB: FORBIDDEN_SAMPLES.token,
    detailC: FORBIDDEN_SAMPLES.jwt,
    detailD: FORBIDDEN_SAMPLES.digest,
    detailE: FORBIDDEN_SAMPLES.proofUrl,
    detailF: FORBIDDEN_SAMPLES.gateCode,
    detailG: FORBIDDEN_SAMPLES.phone,
    detailH: FORBIDDEN_SAMPLES.address,
    detailI: FORBIDDEN_SAMPLES.email,
    nested: {
      deeper: { deepest: FORBIDDEN_SAMPLES.proofUrl },
      list: [FORBIDDEN_SAMPLES.digest, FORBIDDEN_SAMPLES.phone],
    },
    // Also under the obvious names, which must be caught by BOTH layers.
    token: FORBIDDEN_SAMPLES.token,
    proofUrl: FORBIDDEN_SAMPLES.proofUrl,
    phone: FORBIDDEN_SAMPLES.phone,
  };
}

/** A row for every source, with every free column carrying a forbidden value. */
function poisonedRow(source: AuditSource): any {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    created_at: "2026-09-17T12:00:00.000Z",
    actor_user_id: "22222222-2222-4222-8222-222222222222",
    metadata: poisonedMetadata(),
    detail: poisonedMetadata(),
    // Every non-jsonb text column in the union of the eleven schemas, each
    // poisoned. A source that selected one of these would fail below.
    actor_type: FORBIDDEN_SAMPLES.phone,
    actor_kind: FORBIDDEN_SAMPLES.phone,
    command: FORBIDDEN_SAMPLES.proofUrl,
    event: FORBIDDEN_SAMPLES.proofUrl,
    event_type: FORBIDDEN_SAMPLES.proofUrl,
    from_state: FORBIDDEN_SAMPLES.address,
    to_state: FORBIDDEN_SAMPLES.address,
    payment_state_before: FORBIDDEN_SAMPLES.address,
    payment_state_after: FORBIDDEN_SAMPLES.address,
    from_role: FORBIDDEN_SAMPLES.gateCode,
    to_role: FORBIDDEN_SAMPLES.gateCode,
    from_status: FORBIDDEN_SAMPLES.gateCode,
    to_status: FORBIDDEN_SAMPLES.gateCode,
    from_authority: FORBIDDEN_SAMPLES.secret,
    to_authority: FORBIDDEN_SAMPLES.secret,
    from_value: FORBIDDEN_SAMPLES.address,
    to_value: FORBIDDEN_SAMPLES.address,
    subject_key: FORBIDDEN_SAMPLES.digest,
    fact_key: FORBIDDEN_SAMPLES.address,
    outcome: FORBIDDEN_SAMPLES.token,
    provider: "stripe",
    provider_event_id: FORBIDDEN_SAMPLES.token,
    // The two free-text columns that must never be SELECTed at all.
    note: FORBIDDEN_SAMPLES.phone,
    reason: FORBIDDEN_SAMPLES.address,
    // Foreign keys, which the projection fingerprints rather than publishes.
    request_id: "33333333-3333-4333-8333-333333333333",
    delivery_id: "33333333-3333-4333-8333-333333333333",
    incident_id: "33333333-3333-4333-8333-333333333333",
    assignment_id: "33333333-3333-4333-8333-333333333333",
    obligation_id: "33333333-3333-4333-8333-333333333333",
    conversation_id: "33333333-3333-4333-8333-333333333333",
    business_account_id: "33333333-3333-4333-8333-333333333333",
    report_id: "33333333-3333-4333-8333-333333333333",
    session_id: "33333333-3333-4333-8333-333333333333",
    member_id: "33333333-3333-4333-8333-333333333333",
    scope: "operational_flag",
  };
  return { ...base, source };
}

describe("OPS-020 redaction — nothing forbidden reaches the output", () => {
  it("covers every audit source the surface reads", () => {
    // Non-vacuity guard. If a source were dropped from the list the loop below
    // would still pass, having proven nothing about it.
    expect(AUDIT_SOURCES.length).toBe(11);
  });

  for (const source of AUDIT_SOURCES) {
    it(`${source}: no secret, token, digest, proof URL, gate code, phone or address survives`, () => {
      const out = projectAuditRows(source, [poisonedRow(source)]);
      expect(out).toHaveLength(1);
      const serialized = JSON.stringify(out);

      for (const [name, value] of Object.entries(FORBIDDEN_SAMPLES)) {
        expect(
          serialized.includes(value),
          `${source} leaked the ${name}: ${value}`
        ).toBe(false);
      }

      // Substrings too: a half-redacted digest is still a leak. Check the
      // first and last 16 characters of the long opaque values.
      for (const value of [
        FORBIDDEN_SAMPLES.digest,
        FORBIDDEN_SAMPLES.token,
        FORBIDDEN_SAMPLES.secret,
      ]) {
        expect(serialized.includes(value.slice(0, 16))).toBe(false);
        expect(serialized.includes(value.slice(-16))).toBe(false);
      }

      /*
       * Raw row identifiers are never published whole EXCEPT inside
       * `entityHref`, which is OPS-020's "link to entity" and is a typed,
       * bounded, deliberate exception — see its declaration. The check below
       * removes exactly that field and then requires every identifier to be
       * absent from everything else, so the exception cannot quietly widen.
       */
      const href = out[0].entityHref;
      const withoutHref = JSON.stringify(out.map(({ entityHref, ...rest }) => rest));
      expect(withoutHref.includes("33333333-3333-4333-8333-333333333333")).toBe(false);
      expect(withoutHref.includes("22222222-2222-4222-8222-222222222222")).toBe(false);
      // The actor id is never published whole, not even in the href.
      expect(serialized.includes("22222222-2222-4222-8222-222222222222")).toBe(false);

      if (href !== null) {
        // The exception has exactly one shape and exactly one destination.
        expect(href).toBe("/operations/deliveries/33333333-3333-4333-8333-333333333333");
      }
    });
  }

  it("only the two delivery-scoped sources carry an entity link, and it is a relative path", () => {
    const withHref: string[] = [];
    for (const source of AUDIT_SOURCES) {
      const [entry] = projectAuditRows(source, [poisonedRow(source)]);
      expect(entry).toHaveProperty("entityHref");
      if (entry.entityHref !== null) {
        withHref.push(source);
        // Relative, rooted, and into a canonical Operations screen that exists.
        expect(entry.entityHref.startsWith("/operations/deliveries/")).toBe(true);
        expect(entry.entityHref).not.toMatch(/^[a-z]+:\/\//i);
        expect(entry.entityHref).not.toContain("?");
      }
    }
    expect(withHref).toEqual(["delivery_events", "assignment_events"]);
    // And the destination really is a page in this repository.
    expect(existsSync(path.join(ROOT, "app/(couranr)/operations/deliveries/[id]/page.tsx"))).toBe(
      true
    );
  });

  it("an entity link is refused unless the id is exactly a uuid", () => {
    // A malformed id must produce no link rather than a path segment that is
    // not an identifier — the same reason the route shape-checks its input.
    for (const bad of ["", "not-a-uuid", "33333333", "../../etc", null, 42]) {
      const [entry] = projectAuditRows("delivery_events", [
        { ...poisonedRow("delivery_events"), delivery_id: bad },
      ]);
      expect(entry.entityHref, `${String(bad)} produced a link`).toBeNull();
    }
    // NEGATIVE CONTROL: a well-formed id still produces one.
    const [ok] = projectAuditRows("delivery_events", [poisonedRow("delivery_events")]);
    expect(ok.entityHref).toBe("/operations/deliveries/33333333-3333-4333-8333-333333333333");
  });

  it("NEGATIVE CONTROL: the assertion above can actually fail", () => {
    /*
     * Every test in the loop asserts an ABSENCE, and an absence assertion
     * passes just as happily against a projection that returns nothing at all.
     * This proves the harness detects a leak when there is one: the same
     * payload, run through a deliberately broken projection that passes
     * metadata through untouched, must be caught.
     */
    const leaky = JSON.stringify([{ metadata: poisonedMetadata() }]);
    const caught = FORBIDDEN_VALUES.filter((v) => leaky.includes(v));
    expect(caught.length, "the leak detector found nothing in an obviously leaky payload").toBe(
      FORBIDDEN_VALUES.length
    );
  });

  it("NEGATIVE CONTROL: redaction is not just blanking everything", () => {
    /*
     * The counterpart risk: a projection that returns `[redacted]` for every
     * field would pass every absence assertion and be useless. Ordinary audit
     * values must survive unchanged.
     */
    const out = projectAuditRows("delivery_request_events", [
      {
        id: "11111111-1111-4111-8111-111111111111",
        created_at: "2026-09-17T12:00:00.000Z",
        actor_user_id: "22222222-2222-4222-8222-222222222222",
        actor_type: "operations",
        command: "calculate_delivery_request_estimate",
        from_state: "draft",
        to_state: "submitted",
        request_id: "33333333-3333-4333-8333-333333333333",
        metadata: { packageCount: 2, proofRequired: true, milesBand: "2-10" },
      },
    ]);
    expect(out[0].actorKind).toBe("operations");
    // The long snake_case command name must NOT be mistaken for a credential.
    expect(out[0].command).toBe("calculate_delivery_request_estimate");
    expect(out[0].fromState).toBe("draft");
    expect(out[0].toState).toBe("submitted");
    expect(out[0].metadata).toEqual({
      packageCount: 2,
      proofRequired: true,
      milesBand: "2-10",
    });
    expect(out[0].actorFingerprint).toBe("22222222…");
    expect(out[0].subject).toBe("Request 33333333…");
  });

  it("every command name the LIVE CHECK vocabularies permit survives the scrubber", () => {
    /*
     * The over-redaction risk, measured against the CURRENT schema rather than
     * a list typed from the original CREATE TABLE.
     *
     * That distinction is the whole point. `couranr_dre_command_chk` has been
     * replaced five times since 20260731045417 — each time by
     * `drop constraint … ; add constraint …` — and it now permits 22 commands
     * where the original DDL named four. A hand-typed list would have tested
     * the four and silently missed eighteen. So the vocabularies are extracted
     * from the LAST definition of each constraint in migration order, which is
     * what is actually in force.
     *
     * The audit surface would be worthless if it printed `[redacted]` in its
     * own verb column, and this is what says it does not.
     */
    const files = readdirSync(path.join(ROOT, "supabase/migrations"))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const live = new Map<string, string>();
    for (const f of files) {
      const sql = readFileSync(path.join(ROOT, "supabase/migrations", f), "utf8");
      for (const m of sql.matchAll(
        /(couranr_\w*(?:command|event|state)\w*_chk)\s+check\s*\(([\s\S]*?)\)\s*[;,]/g
      )) {
        live.set(m[1], m[2]);
      }
    }
    // Non-vacuity: the extraction must actually find the constraint whose
    // history motivated this test, with its full current vocabulary.
    expect(live.has("couranr_dre_command_chk")).toBe(true);
    expect(
      (live.get("couranr_dre_command_chk")!.match(/'[a-z_]+'/g) ?? []).length
    ).toBeGreaterThanOrEqual(20);

    const over: string[] = [];
    for (const [name, body] of live) {
      for (const m of body.matchAll(/'([a-z][a-z0-9_]*)'/g)) {
        if (scrubString(m[1]) !== m[1]) over.push(`${name}: ${m[1]}`);
      }
    }
    expect(over, `command/state literals the scrubber destroys:\n  ${over.join("\n  ")}`).toEqual(
      []
    );
  });

  it("a policy version survives the scrubber — OPS-020 exists to show them", () => {
    /*
     * OPS-020's purpose begins "Inspect state commands, POLICY VERSIONS, …".
     * The first entropy rule redacted `couranr-pricing-v2-2026-09-01` because
     * it is 29 characters of letters, digits and hyphens — it would have hidden
     * the thing the screen is for. Every policy version string this product
     * mints is asserted to pass through.
     */
    for (const v of [
      "couranr-pricing-v2-2026-09-01",
      "couranr-pricing-2026-07-31",
      "couranr-timing-v1-2026-09-02",
      "couranr-protection-v1-2026-09-01",
      "pickup-handoff-v2",
      "CR-7Q2M-4KDX",
    ]) {
      expect(scrubString(v), `${v} was over-redacted`).toBe(v);
    }
  });

  it("a six-digit NUMBER is redacted, and that tradeoff is deliberate", () => {
    /*
     * `redactHandoffCodes` is blunt by design — "over-redacting a package count
     * in a log line costs nothing, and under-redacting a PIN costs the
     * credential". Applied to numbers, that means a six-digit cents value
     * ($1,000.00) renders as [redacted]. Recorded as a test so the behaviour is
     * a decision rather than a surprise.
     */
    expect(redactMetadata({ cents: 100000 })).toEqual({ cents: REDACTED });
    expect(redactMetadata({ cents: 99999 })).toEqual({ cents: 99999 });
  });

  it("scrubString redacts each forbidden class on its own", () => {
    for (const [name, value] of Object.entries(FORBIDDEN_SAMPLES)) {
      const out = scrubString(value);
      expect(out.includes(value), `${name} survived scrubString`).toBe(false);
    }
  });

  it("a phone or address inside ordinary prose is removed, not the whole sentence", () => {
    // The purpose-built rewriters handle the in-sentence case; the shape gate
    // handles the whole-value case. Both paths are exercised.
    expect(scrubString("Called 555-123-4567")).not.toContain("555-123-4567");
    expect(scrubString("Called 555-123-4567")).toContain("Called");
  });

  it("a phone number stored as a NUMBER is redacted too", () => {
    // `typeof v === "number"` is not a safety property.
    expect(redactMetadata({ contact: 5551234567 })).toEqual({ contact: REDACTED });
    // ...while ordinary numeric facts survive.
    expect(redactMetadata({ packageCount: 2, cents: 799 })).toEqual({
      packageCount: 2,
      cents: 799,
    });
  });

  it("a digest containing a six-digit run is redacted WHOLE, not in halves", () => {
    /*
     * The bug the shape-check-first ordering exists to prevent: the blunt
     * six-digit gate-code rewriter can split a hex digest into two fragments,
     * each below the digest and entropy thresholds.
     */
    const digestWithSixDigits = "abcdef" + "123456" + "0".repeat(20) + "fedcba";
    expect(digestWithSixDigits.length).toBeGreaterThanOrEqual(32);
    expect(scrubString(digestWithSixDigits)).toBe(REDACTED);
  });

  it("a value longer than the cap is refused whatever it contains", () => {
    // NOT "a": a-f are hex, so a long run of them is digest-shaped and would
    // be refused by the digest rule instead, measuring the wrong thing.
    const long = "z".repeat(MAX_AUDIT_VALUE_LENGTH + 1);
    expect(scrubString(long)).toBe(REDACTED);
    expect(scrubString("z".repeat(MAX_AUDIT_VALUE_LENGTH))).not.toBe(REDACTED);
  });

  it("depth and breadth are bounded", () => {
    const deep = { a: { b: { c: { d: "too deep" } } } };
    expect(JSON.stringify(redactMetadata(deep))).toContain(REDACTED);
    const wide: Record<string, string> = {};
    for (let i = 0; i < 60; i++) wide[`k${i}`] = "v";
    expect(Object.keys(redactMetadata(wide) as object).length).toBeLessThanOrEqual(20);
  });

  it("an actor id is a short fingerprint, never the whole identifier", () => {
    expect(actorFingerprint("22222222-2222-4222-8222-222222222222")).toBe("22222222…");
    expect(actorFingerprint(null)).toBeNull();
    expect(actorFingerprint(12 as any)).toBeNull();
  });
});

/* ════════════════════════════ 4. the SELECT allow-lists (redaction layer 1) ══ */

describe("column allow-lists — the free-text columns are never read", () => {
  const src = read(SETTINGS_LIB);

  it("no query selects *", () => {
    expect(src).not.toMatch(/\.select\(\s*["'`]\*/);
  });

  it("the incident note is not selected", () => {
    // couranr_delivery_incident_events.note is free operator prose.
    const line = src.match(/columns:\s*"id,incident_id[^"]*"/)?.[0] ?? "";
    expect(line, "incident columns not found").not.toBe("");
    expect(line).not.toContain("note");
  });

  it("the intake fact values are not selected", () => {
    // couranr_intake_fact_events.from_value / to_value hold the fact itself.
    const line = src.match(/columns:\s*"id,session_id[^"]*"/)?.[0] ?? "";
    expect(line, "intake columns not found").not.toBe("");
    expect(line).not.toContain("from_value");
    expect(line).not.toContain("to_value");
  });

  it("the provider event id is not selected", () => {
    const line = src.match(/columns:\s*"id,obligation_id[^"]*"/)?.[0] ?? "";
    expect(line, "payment columns not found").not.toBe("");
    expect(line).not.toContain("provider_event_id");
  });

  it("the market state note is never selected either", () => {
    expect(src).not.toMatch(/select\([^)]*state_note/);
  });
});

/* ═══════════════════════════════════════ 5. append-only, at three layers ══ */

describe("OPS-020 is append-only: no edit or delete path exists", () => {
  it("the audit route exports GET and nothing else", () => {
    const src = read(AUDIT_ROUTE);
    expect(src).toMatch(/export async function GET/);
    for (const verb of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(src, `${verb} must not exist on the audit route`).not.toMatch(
        new RegExp(`export\\s+(async\\s+)?function\\s+${verb}\\b`)
      );
    }
  });

  it("the settings lib exports no mutator for any event table", () => {
    const src = read(SETTINGS_LIB);
    // The only write anywhere in this module is the INSERT that records a
    // settings change. No update and no delete touches an event table.
    expect(src).not.toMatch(/couranr_operations_setting_events[\s\S]{0,200}?\.update\(/);
    expect(src).not.toMatch(/\.delete\(\)/);
    const inserts = src.match(/\.insert\(/g) ?? [];
    expect(inserts.length, "exactly one insert, the audit record").toBe(1);
  });

  it("the browser client offers no audit mutation", () => {
    const src = code(SETTINGS_CLIENT);
    expect(src).toContain("fetchAuditLog");
    expect(src).not.toMatch(/updateAudit|deleteAudit|editAudit/i);
    // And the only audit call is a GET — no method option is passed.
    const auditCall = src.slice(src.indexOf("export function fetchAuditLog"));
    expect(auditCall).not.toContain("method:");
  });

  it("the audit component renders no edit or delete affordance", () => {
    const src = read(AUDIT_COMPONENT);
    for (const word of ["Delete", "Remove", "Edit", "Archive"]) {
      expect(src, `${word} must not appear as an affordance`).not.toContain(`>${word}`);
    }
    /*
     * The component DOES render one button, and asserting `not.toContain
     * ("<Button")` would have been the wrong rule: OPS-020's declared actions
     * are "Filter; inspect event; export permitted audit; link to entity", and
     * three of those need a control. The rule is that every control is a READ,
     * which the DOM test enumerates. Here we only pin the count, so a second
     * button cannot appear without someone editing this line.
     */
    expect((src.match(/<Button/g) ?? []).length, "exactly one control: the export").toBe(1);
    expect(src).toContain("Export this view");
  });

  it("the export serializes what is on screen and re-reads nothing", () => {
    const src = read(AUDIT_COMPONENT);
    // It builds from `view.entries`, which is already redacted, and makes no
    // call of its own — so it cannot carry a field the screen refused to show.
    expect(src).toContain("auditCsv(view.entries)");
    const csv = src.slice(src.indexOf("function auditCsv"), src.indexOf("function MetadataCell"));
    expect(csv).not.toContain("fetch");
    expect(csv).not.toContain("call(");
    // RFC 4180 quoting: every field wrapped, every embedded quote doubled.
    expect(csv).toContain('replace(/"/g, \'""\')');
  });

  it("the migration grants no UPDATE or DELETE on the settings audit table", () => {
    const sql = read(MIGRATION);
    const grant = sql
      .split("\n")
      .find((l) => l.includes("grant") && l.includes("couranr_operations_setting_events"));
    expect(grant, "no grant line for the settings audit table").toBeTruthy();
    expect(grant!).toContain("select, insert");
    expect(grant!).not.toContain("update");
    expect(grant!).not.toContain("delete");
  });
});

/* ═══════════════════════════════════════════════ 6. the routes and gates ══ */

describe("the canonical routes authorize and fail safely", () => {
  for (const f of [AUDIT_ROUTE, AVAILABILITY_ROUTE]) {
    it(`${f} resolves an Operations-only actor before anything else`, () => {
      const src = read(f);
      // `null` as the business scope is what makes it Operations-only.
      expect(src).toContain("resolveRequestActor(req, null)");
      expect(src).toContain("isActorDenied(actor)");
      // The gate must precede every read of the body or the query string.
      const gateAt = src.indexOf("isActorDenied(actor)");
      const bodyAt = src.search(/req\.json\(\)|new URL\(req\.url\)/);
      expect(gateAt).toBeGreaterThan(-1);
      if (bodyAt > -1) expect(gateAt).toBeLessThan(bodyAt);
    });

    it(`${f} builds every failure through the shared helper`, () => {
      const src = read(f);
      expect(src).not.toMatch(/NextResponse\.json\(\s*\{\s*error:/);
    });
  }

  it("the availability route accepts a named command and never a target", () => {
    const src = read(AVAILABILITY_ROUTE);
    for (const c of AVAILABILITY_COMMANDS) {
      expect(src, `${c} is not reachable from the route`).toContain(`"${c}"`);
    }
    expect(src).toContain("That is not a command Couranr recognizes.");
  });

  it("NO canonical route in this slice reads a target off the body", () => {
    /*
     * The rule two of this repo's existing suites already enforce, restated
     * here so the reason travels with the slice that broke it: "its target
     * status is fixed by the route, never read from the body." The first draft
     * of the availability route took `body.availabilityState` and was caught by
     * tests/couranr-server-only.test.ts and
     * tests/couranr-driver-execution.test.ts on the first full run.
     */
    for (const f of [AVAILABILITY_ROUTE, AUDIT_ROUTE]) {
      const src = read(f);
      for (const rx of [
        /body\??\.\w*[Ss]tatus/,
        /body\??\.\w*[Ss]tate/,
        /body\??\.\w*[Cc]ents/,
        /body\??\.\w*[Aa]mount/,
        /body\??\.\w*[Tt]otal/,
        /body\??\.\w*enabled/i,
        /body\??\.\w*active/i,
      ]) {
        expect(rx.test(src), `${f} reads ${rx} from the body`).toBe(false);
      }
    }
  });

  it("the target of every command is resolved server-side, from the command name", () => {
    const src = read(SETTINGS_LIB);
    for (const map of [
      "MARKET_STATE_BY_COMMAND",
      "MARKET_ACTIVE_BY_COMMAND",
      "FLAG_ENABLED_BY_COMMAND",
    ]) {
      expect(src, `${map} missing`).toContain(map);
    }
    // Every availability state is reachable through exactly one command name.
    for (const s of AVAILABILITY_STATES) {
      expect(src).toContain(`: "${s}"`);
    }
  });

  it("a closure is written by a named command and lifted, never deleted", () => {
    const src = read(SETTINGS_LIB);
    expect(src).toContain("open_operating_closure");
    expect(src).toContain("lift_operating_closure");
    // Lifting sets active=false. Nothing in this module deletes a closure row.
    expect(src).toContain('.update({ active: false })');
    expect(src).not.toMatch(/couranr_operating_closures[\s\S]{0,120}?\.delete\(/);
    // The upsert names the existing unique constraint's own columns.
    expect(src).toContain('onConflict: "market_key,local_date"');
  });

  it("a closure date is validated as a local calendar date, not cast from an instant", () => {
    expect(isLocalDate("2026-09-17")).toBe(true);
    expect(isLocalDate("2026-02-29")).toBe(false); // 2026 is not a leap year
    expect(isLocalDate("2026-13-01")).toBe(false);
    expect(isLocalDate("2026-09-31")).toBe(false);
    expect(isLocalDate("2026-9-17")).toBe(false);
    expect(isLocalDate("2026-09-17T12:00:00Z")).toBe(false);
    expect(isLocalDate("")).toBe(false);
    expect(isLocalDate(null)).toBe(false);
    // NEGATIVE CONTROL: a leap day in a leap year must still pass, or the
    // round-trip is rejecting everything and the test above proves nothing.
    expect(isLocalDate("2028-02-29")).toBe(true);
  });

  it("both routes are registered in the two route inventories", () => {
    for (const t of ["tests/couranr-server-only.test.ts", "tests/couranr-error-safety.test.ts"]) {
      const src = read(t);
      expect(src).toContain(AUDIT_ROUTE);
      expect(src).toContain(AVAILABILITY_ROUTE);
    }
  });
});

/* ══════════════════════════════════════════ 7. the tab routes and shell ══ */

describe("OPS-015 tab routing is the registry's routing", () => {
  it("every tab's href is the registry route for its screen, character for character", () => {
    for (const t of SETTINGS_TABS) {
      const registryRoute: string = screens[t.screenId].routes[0];
      expect(settingsTabHref(t.id), `${t.screenId}`).toBe(registryRoute);
    }
  });

  it("the five tabs are OPS-016 through OPS-020", () => {
    expect(SETTINGS_TABS.map((t) => t.screenId)).toEqual([
      "OPS-016",
      "OPS-017",
      "OPS-018",
      "OPS-019",
      "OPS-020",
    ]);
  });

  it("each tab carries the registry's own purpose text", () => {
    for (const t of SETTINGS_TABS) {
      expect(t.purpose, `${t.screenId} purpose drifted from the registry`).toBe(
        screens[t.screenId].purpose
      );
    }
  });

  it("only OPS-016 and OPS-020 are built; the other three are declared unbuilt", () => {
    const built = SETTINGS_TABS.filter((t) => t.built).map((t) => t.screenId);
    expect(built).toEqual(["OPS-016", "OPS-020"]);
  });

  it("an unknown or missing tab resolves to the default rather than 404ing", () => {
    expect(resolveSettingsTab(undefined)).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab("nonsense")).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab("")).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab({} as any)).toBe(DEFAULT_SETTINGS_TAB);
    expect(resolveSettingsTab("audit")).toBe("audit");
  });

  it("the page still renders a ScreenPlaceholder, which the screen ledger requires", () => {
    /*
     * SCREEN_IMPLEMENTATION_LEDGER.csv classifies all six of OPS-015…020
     * `placeholder_only` against this one page path, and
     * tests/couranr-implementation-ledger.test.ts asserts that a
     * `placeholder_only` row's page really does render a ScreenPlaceholder.
     * OPS-017/018/019 genuinely are placeholders, so the string is honest —
     * and this test records WHY it must stay until the ledger is updated.
     */
    expect(read(SETTINGS_PAGE)).toContain("ScreenPlaceholder");
  });

  it("the page resolves the tab on the SERVER, not with useSearchParams", () => {
    const src = code(SETTINGS_PAGE);
    expect(src).toContain("await props.searchParams");
    expect(src).not.toContain("useSearchParams");
    expect(src).not.toContain('"use client"');
  });
});

/* ════════════════════════════════════════ 8. the migration and rollback ══ */

describe("the new migration is additive, paired and append-only by privilege", () => {
  it("both files exist and are paired", () => {
    expect(existsSync(path.join(ROOT, MIGRATION))).toBe(true);
    expect(existsSync(path.join(ROOT, ROLLBACK))).toBe(true);
  });

  it("the forward migration drops nothing and creates only with IF NOT EXISTS", () => {
    const sql = read(MIGRATION).replace(/^\s*--.*$/gm, "");
    expect(sql).not.toMatch(/drop\s+(table|column)/i);
    const creates = sql.match(/create table[^(]*/gi) ?? [];
    expect(creates.length).toBe(2);
    for (const c of creates) expect(c.toLowerCase()).toContain("if not exists");
  });

  it("it re-creates neither of the two tables that already exist", () => {
    /*
     * Read the CREATED names, not a loose span. The first draft of this
     * assertion used `create table[^;]*couranr_capacity_policies` and failed
     * against a correct migration, because `[^;]*` ran past the table name and
     * into the foreign-key reference on the very next line. A regex that
     * matches the thing beside the thing you meant is a bent ruler.
     */
    const sql = read(MIGRATION).replace(/^\s*--.*$/gm, "");
    const created = [...sql.matchAll(/create table if not exists public\.([a-z_]+)/gi)].map(
      (m) => m[1]
    );
    expect(created).toEqual([
      "couranr_market_availability",
      "couranr_operations_setting_events",
    ]);
    expect(created).not.toContain("couranr_capacity_policies");
    expect(created).not.toContain("couranr_operating_closures");
    // ...and it DOES reference them, which is what makes the check non-vacuous.
    expect(sql).toContain("references public.couranr_capacity_policies(market_key)");
  });

  it("it states no hour, no cutoff and no price", () => {
    const sql = read(MIGRATION).replace(/^\s*--.*$/gm, "");
    for (const re of [/\b06:00\b/, /\b18:00\b/, /\b16:00\b/, /\b3000\b/]) {
      expect(re.test(sql), `the migration hardcodes ${re}`).toBe(false);
    }
  });

  it("every new table is RLS-enabled and revoked from PUBLIC explicitly", () => {
    const sql = read(MIGRATION);
    for (const t of [
      "couranr_market_availability",
      "couranr_operations_setting_events",
    ]) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
      expect(sql).toMatch(
        new RegExp(`revoke all on table public\\.${t}[\\s\\S]{0,120}?from public, anon, authenticated, service_role`)
      );
    }
  });

  it("the rollback drops with RESTRICT and warns about the audit record", () => {
    const sql = read(ROLLBACK);
    const drops = sql.match(/drop\s+table[^;]*;/gi) ?? [];
    expect(drops.length).toBe(2);
    for (const d of drops) {
      expect(d.toLowerCase()).toContain("restrict");
      expect(d.toLowerCase()).not.toContain("cascade");
    }
    expect(sql).toContain("APPEND-ONLY");
    // And it must NOT drop the two pre-existing tables.
    expect(sql).not.toContain("couranr_capacity_policies restrict");
    expect(sql).not.toContain("couranr_operating_closures restrict");
  });
});

/* ══════════════════════════════════ 9. a missing table is a named state ══ */

describe("a pending migration is reported, never swallowed", () => {
  it("recognizes every spelling PostgREST uses for a missing relation", () => {
    expect(isMissingRelationError({ code: "42P01" })).toBe(true);
    expect(isMissingRelationError({ code: "PGRST205" })).toBe(true);
    expect(
      isMissingRelationError({ message: "Could not find the table 'public.x' in the schema cache" })
    ).toBe(true);
    expect(isMissingRelationError({ message: 'relation "public.x" does not exist' })).toBe(true);
  });

  it("NEGATIVE CONTROL: an ordinary failure is NOT read as a missing table", () => {
    // If this returned true for everything, every real error would be reported
    // as "not provisioned yet" and the surface would look fine while broken.
    expect(isMissingRelationError({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingRelationError({ code: "23505", message: "duplicate key value" })).toBe(false);
    expect(isMissingRelationError({})).toBe(false);
    expect(isMissingRelationError(null)).toBe(false);
  });

  it("the availability screen renders the pending-migration state by name", () => {
    const src = read(AVAILABILITY_COMPONENT);
    expect(src).toContain("not provisioned yet");
    expect(src).toContain("20260917210000_couranr_operations_settings");
  });

  it("the audit screen names a source it could not read rather than showing it empty", () => {
    const src = read(AUDIT_COMPONENT);
    expect(src).toContain("Part of the record could not be read");
    expect(src).toContain("not the same as those sources having no");
  });
});
