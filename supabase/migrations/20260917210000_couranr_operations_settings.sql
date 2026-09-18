-- OPS-015 / OPS-016: the server state the Operations settings surface needs,
-- and nothing more.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT ALREADY EXISTED, AND IS THEREFORE NOT RE-CREATED HERE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Recon before writing, not after:
--
--   `public.couranr_capacity_policies`   (20260904152329) — one row per market
--       with `active`. The market ON/OFF switch OPS-016 calls "market
--       availability" is this column. It is READ and WRITTEN by the settings
--       surface; it is not redefined.
--
--   `public.couranr_operating_closures`  (20260904152329) — (market_key,
--       local_date, reason, active). OPS-016's "closures" already exist AND
--       ARE ALREADY LOAD-BEARING: `couranr_plan_service` (20260904154559)
--       reads them when it picks a departure slot. Writing one here changes
--       real planning behaviour, which is exactly why the write is a named,
--       audited command rather than a form field.
--
--   `public.couranr_is_within_operating_hours` and friends (20260806010000) —
--       HRS-001/HRS-002's window IN THE DATABASE. Nothing here re-states an
--       hour or a cutoff. The registry owns those numbers, the two existing
--       modules already carry them, and a third copy would be a third thing
--       to keep in sync.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT DID NOT EXIST, AND WHY EACH TABLE IS HERE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1. AN OPERATIONAL MODE PER MARKET. `couranr_capacity_policies.active` is a
--    boolean: open or shut. OPS-016 declares five states — standard, scheduled
--    only, temporarily closed, weather limited, overnight enabled — and a
--    boolean cannot carry them. Verified absent:
--        grep -rn "weather_limited\|weather-limited" lib app supabase tests
--    returned nothing at dca0e855.
--
-- 2. THE FOUR FEATURE SWITCHES FLG-001 REQUIRES. `FLG-001` (root
--    02_DECISION_REGISTRY.json, category "feature flags", affected screens
--    OPS-015/OPS-016/OPS-019) names them and their launch defaults:
--        overnight_enabled      false   (§3 Hours — only when Couranr enables)
--        ai_auto_reply_enabled  false   (§18 — drafts may ship, auto-reply not)
--        request_intake_paused  false   (§18 — Operations can pause requests)
--        ai_global_kill_switch  false   (§18 — Operations can pause AI)
--    Verified absent: a grep for all four keys and for `feature_flag` across
--    supabase/, lib/, app/ and tests/ returned nothing.
--
--    FLG-002 is `unresolved`: "The storage mechanism, scope and audit model
--    for feature flags is not specified." This migration therefore CHOOSES a
--    mechanism and says so. It is deliberately the smallest choice that can be
--    superseded without a data migration: a closed key vocabulary, one row per
--    key, global scope, and every change written to an append-only audit. A
--    later FLG-002 decision that wants per-market or per-merchant scope adds a
--    column; it does not have to undo a design.
--
--    FLG-001 also states `availability_states_are_operational_not_flags:
--    true`, which is why the mode in (1) is a separate table with its own
--    vocabulary rather than four more booleans.
--
-- 3. AN AUDIT OF SETTINGS CHANGES. OPS-015's constraint is "Sensitive changes
--    require high privilege and audit," and OPS-020 must be able to show them.
--    None of the ten existing event tables has a shape that fits a settings
--    change, so this adds the eleventh, built like the other ten: append-only
--    by PRIVILEGE (no update, no delete grant), not merely by convention.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT CONTAIN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- NO plpgsql COMMAND FUNCTIONS. CLAUDE.md's execution-verification rule is
-- absolute: "A SQL command is not done until it has been CALLED against a real
-- database with a real row," and this migration is written under an explicit
-- instruction NOT to apply it. Shipping unexecuted plpgsql would be shipping
-- exactly the defect class that rule exists for — a foreign key, a %TYPE, an
-- OUT-parameter collision, all invisible to every text assertion.
--
-- So this file is DECLARATIVE ONLY: tables, constraints, indexes, grants,
-- seeds. The transition logic lives in `lib/couranr/operations/settings.ts` as
-- a named TypeScript command (the shape `lib/couranr/conversations/commands.ts`
-- already uses), and its concurrency guarantee is a single conditional UPDATE
-- — `... set version = version + 1 where key = $1 and version = $2` — which is
-- atomic in one statement and cannot be lost to a read-then-write race.
--
-- ADDITIVE ONLY. No drop, no column removal, no data deletion.

begin;

-- ═══════════════════════════════════════════════════ 1. market availability

-- One row per market, keyed to the market table that already exists so a mode
-- can never name a market capacity planning has never heard of.
--
-- `availability_state` is a CLOSED vocabulary taken from OPS-016's declared
-- states. `overnight enabled` is NOT one of them: OVN-001 makes overnight a
-- request-only capability Couranr enables, and FLG-001 makes it a FLAG. A
-- market that is "standard" with overnight enabled is two facts, not a sixth
-- state, and collapsing them would make "weather limited AND overnight" —
-- which is a real combination — unrepresentable.
create table if not exists public.couranr_market_availability (
  market_key text primary key
    references public.couranr_capacity_policies(market_key)
    on update cascade on delete restrict,

  availability_state text not null default 'standard',

  -- Why the market is in this state, for the operator who sees it next.
  -- Free text, so it is NEVER rendered by the audit surface: see
  -- `lib/couranr/operations/settings.ts`, which selects an explicit column
  -- allow-list and scrubs every string it does emit.
  state_note text,

  -- Optimistic concurrency. OPS-015 declares "policy version conflict" as a
  -- state; this is what makes it a real refusal rather than a label. Two
  -- operators editing the same market: the second one's UPDATE matches zero
  -- rows and the surface says so, instead of silently winning.
  version integer not null default 1,

  updated_at timestamptz not null default now(),
  updated_by uuid,

  constraint couranr_mavl_state_chk check (availability_state in (
    'standard',            -- OPS-016 "Standard"
    'scheduled_only',      -- OPS-016 "Scheduled only"
    'temporarily_closed',  -- OPS-016 "Temporarily closed"
    'weather_limited'      -- OPS-016 "Weather limited"
  )),
  constraint couranr_mavl_note_chk check (
    state_note is null or length(btrim(state_note)) between 1 and 500
  ),
  constraint couranr_mavl_version_chk check (version >= 1)
);

comment on table public.couranr_market_availability is
  'OPS-016. The operational MODE of a market: standard, scheduled only, '
  'temporarily closed, or weather limited. Distinct from '
  'couranr_capacity_policies.active, which is the on/off switch, and from '
  'couranr_operational_switches, which carries FLG-001''s capability switches. '
  'Hours and the same-day cutoff are NOT here: HRS-001 owns them and '
  'couranr_is_within_operating_hours is where they live in this database.';

comment on column public.couranr_market_availability.version is
  'Optimistic concurrency token for OPS-015''s "policy version conflict" '
  'state. Every accepted change increments it in the same UPDATE that matches '
  'on it, so a stale editor matches zero rows rather than overwriting.';

-- Seed the one market that exists, in its launch state. `on conflict do
-- nothing` makes re-application harmless.
insert into public.couranr_market_availability(market_key, availability_state)
select market_key, 'standard'
  from public.couranr_capacity_policies
on conflict (market_key) do nothing;

-- ═══════════════════════════════════════════════════════ 2. FLG-001 switches

-- One row per switch, global scope, closed key vocabulary.
--
-- The CHECK is the reason the vocabulary is closed rather than free: a typo'd
-- key would otherwise create a silent second flag that every reader misses and
-- every writer thinks it set. FLG-002 being unresolved is not a licence to
-- accept arbitrary keys.
/* couranr_operational_flags IS DELETED FROM THIS MIGRATION.
   It carried FLG-001's four capability switches, and 20260917190000_couranr_operational_switches
   carries the same four. The two were written in parallel and neither knew about the other.
   THAT one survives, because it is the table private.couranr_enforce_request_intake_pause
   actually reads: a console throwing a switch in a second table would have gated nothing at
   all, which is the worst possible outcome for a launch gate. This surface reads and writes
   couranr_operational_switches through couranr_set_operational_switch, which also writes the
   audit row — the direct UPDATE that used to live here changed a switch with no audit. The
   compare-and-set survives, folded into that command. */


-- ═════════════════════════════════════════════════ 3. the settings audit log

-- Append-only, like the ten event tables that came before it, and enforced the
-- same way: RLS on, zero policies, and a GRANT that omits UPDATE and DELETE.
-- A comment saying "append-only" is not a mechanism; a missing privilege is.
--
-- The metadata CHECK reuses `couranr_jsonb_has_no_key` (20260804150000), which
-- walks the WHOLE document rather than testing top-level keys the way jsonb `?`
-- does. OPS-020's constraint is "Redact secrets and unnecessary PII"; this
-- makes the table structurally incapable of storing the obvious carriers, so
-- the application redactor is the second line and not the only one.
create table if not exists public.couranr_operations_setting_events (
  id uuid primary key default gen_random_uuid(),

  -- Never null. A settings change is always made by a person; there is no
  -- system path that writes one, and "unknown actor" is not an audit record.
  actor_user_id uuid not null,

  scope text not null,
  -- The market_key or flag_key the change applied to. Not a foreign key: an
  -- audit row must survive the disappearance of its subject.
  subject_key text not null,
  command text not null,

  from_value text,
  to_value text not null,

  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint couranr_ose_scope_chk check (scope in (
    'market_availability', 'operational_flag', 'operating_closure', 'market_active'
  )),
  -- The COMMAND AS ISSUED, not the effect. An auditor reading
  -- `set_market_weather_limited` knows exactly what was asked for; a row
  -- saying `set_market_availability` would make them go and look up what the
  -- target had been. These ten are `AVAILABILITY_COMMANDS` in
  -- lib/couranr/operations/settings.ts, and the vocabulary is closed on both
  -- sides so neither can drift silently.
  constraint couranr_ose_command_chk check (command in (
    'set_market_standard',
    'set_market_scheduled_only',
    'set_market_temporarily_closed',
    'set_market_weather_limited',
    'enable_operational_flag',
    'disable_operational_flag',
    'open_market',
    'close_market',
    'open_operating_closure',
    'lift_operating_closure'
  )),
  constraint couranr_ose_subject_chk check (length(btrim(subject_key)) between 1 and 200),
  constraint couranr_ose_to_value_chk check (length(btrim(to_value)) between 1 and 200),
  constraint couranr_ose_from_value_chk check (
    from_value is null or length(btrim(from_value)) between 1 and 200
  ),
  constraint couranr_ose_metadata_obj_chk check (jsonb_typeof(metadata) = 'object'),

  -- Structural redaction. These key names carry the seven classes OPS-020
  -- forbids on the audit surface, at any depth.
  constraint couranr_ose_no_secret_keys_chk check (
    public.couranr_jsonb_has_no_key(metadata, array[
      'token', 'secret', 'code', 'digest', 'hash', 'url', 'href', 'signature',
      'password', 'credential', 'phone', 'address', 'email', 'key', 'pin'
    ])
  )
);

comment on table public.couranr_operations_setting_events is
  'OPS-015/OPS-020. Append-only audit of every Operations settings change. '
  'APPEND-ONLY BY PRIVILEGE: service_role holds select and insert and no '
  'update or delete, so the absence of an edit path is a grant and not a '
  'convention. Must never contain a secret, token, digest, proof URL, gate '
  'code, phone number or address — the metadata CHECK refuses the key names '
  'and lib/couranr/operations/settings.ts scrubs the values.';

create index if not exists couranr_ose_created_idx
  on public.couranr_operations_setting_events (created_at desc);

create index if not exists couranr_ose_subject_idx
  on public.couranr_operations_setting_events (scope, subject_key, created_at desc);

-- ═══════════════════════════════════════════════════════════ 4. privileges

-- Same posture as every other canonical table. `public` is named explicitly in
-- every revoke because `pg_default_acl` in this project grants arwdDxtm on
-- every new table in `public` to anon, authenticated AND service_role — a
-- revoke that omits PUBLIC is a silent no-op, and a narrow GRANT without the
-- revoke changes nothing at all.
alter table public.couranr_market_availability        enable row level security;
alter table public.couranr_operations_setting_events  enable row level security;

revoke all on table public.couranr_market_availability
  from public, anon, authenticated, service_role;
revoke all on table public.couranr_operations_setting_events
  from public, anon, authenticated, service_role;

grant select, insert, update on table public.couranr_market_availability to service_role;

-- SELECT and INSERT only. No UPDATE. No DELETE. This line is the append-only
-- guarantee OPS-020 requires, and it is the reason the audit surface can
-- truthfully say Couranr cannot edit or delete an audit record.
grant select, insert on table public.couranr_operations_setting_events to service_role;

commit;
