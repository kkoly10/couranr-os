-- ---------------------------------------------------------------------
-- ACP-025 — versioned delivery presets.
--
-- AUTHORITY: `02_DECISION_REGISTRY.json` has NO decision about presets — all
-- 43 records scanned. Rank 2, Master Package §5:
--
--   Preset hierarchy
--     1. Couranr global category preset
--     2. Merchant-customized preset
--     3. Merchant-created preset
--   "Global updates never overwrite merchant customization. Every preset is
--    versioned. Each delivery stores preset ID, version, and immutable
--    snapshot."
--   "Presets may suggest common item, package count, handling, proof, vehicle
--    capabilities, required questions, and payer preference. They must not
--    silently assert exact weight, dimensions, value, final vehicle, final
--    price, loading availability, or safety."
--
-- Phase 4 acceptance adds: "historical preset snapshots remain."
--
-- ---------------------------------------------------------------------
-- A DEVIATION FROM THE SPEC'S TABLE LIST, STATED PLAINLY
-- ---------------------------------------------------------------------
--
-- The Master Package's "Core table groups" names FOUR preset tables:
-- `category_presets`, `category_item_presets`, `merchant_item_presets`,
-- `merchant_item_preset_versions`. This migration creates THREE.
--
-- `category_item_presets` is folded into its parent's `body` jsonb. The reason
-- is §5's own description: a preset suggests "common ITEM" — singular — plus a
-- package count, handling, proof, capabilities, questions and payer
-- preference. That is one item template per preset, not a collection, so a
-- child table would hold exactly one row per parent forever. The body's shape
-- is not freeform either: `lib/couranr/presets/fields.ts` defines it and the
-- CHECK below refuses the forbidden keys.
--
-- This is a schema-sketch line in an architecture overview, not a behavioural
-- requirement, and every behavioural requirement above IS implemented. But it
-- is a deviation from a named list and is recorded as one rather than quietly
-- absorbed. Splitting the body out later is additive.
--
-- ADDITIVE ONLY. Three new tables and four columns on
-- `couranr_delivery_requests`; nothing is dropped.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. The forbidden-key guard, shared by every preset table
-- ---------------------------------------------------------------------
--
-- Mirrors `isForbiddenPresetKey` in lib/couranr/presets/fields.ts. Enforced in
-- BOTH places deliberately: the TypeScript is what strips a field and tells
-- the merchant, this is what makes the rule true for `service_role` writes
-- that never pass through it — and `service_role` has `rolbypassrls = true`
-- here, so a CHECK is the only thing standing between a caller and the row.
--
-- IMMUTABLE and table-free so it is legal inside a CHECK constraint.
create or replace function public.couranr_preset_body_is_clean(p_body jsonb)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select p_body is null
      or not exists (
        select 1
          from jsonb_object_keys(p_body) as k(key)
         where regexp_replace(lower(k.key), '[^a-z]', '', 'g') not in (
                 'commonitem','packagecount','handling','proofmethod',
                 'vehiclecapabilities','requiredquestions','payerpreference')
           and regexp_replace(lower(k.key), '[^a-z]', '', 'g') ~
                 'weight|dimension|length|width|height|value|price|cost|amount|cents|vehicleid|vehicletype|loading|safe'
      );
$fn$;

comment on function public.couranr_preset_body_is_clean(jsonb) is
  'False when a preset body carries a key meaning exact weight, dimensions, value, price, a final vehicle, loading availability or safety (Master Package section 5). Matches the concept, not the spelling. IMMUTABLE so it is legal in a CHECK.';

-- ---------------------------------------------------------------------
-- 2. Couranr GLOBAL category presets — hierarchy level 1
-- ---------------------------------------------------------------------
create table if not exists public.couranr_category_presets (
  id                  uuid primary key default gen_random_uuid(),
  business_category   text not null,
  name                text not null,
  body                jsonb not null default '{}'::jsonb,

  -- Every preset is versioned (§5). A global edition bumps this; a merchant
  -- who customized an earlier one is NOT overwritten — they are shown that an
  -- update exists, which is MER-010's "update suggested" state.
  version             integer not null default 1,
  archived_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint couranr_cp_category_chk check (business_category in (
    'dry_cleaning_laundry_tailoring','printing_signage_promotional',
    'boutique_clothing_shoes_accessories','florists_gifts_specialty_retail',
    'repair_and_electronics','auto_parts_and_accessories',
    'furniture_and_home_goods','event_rentals_and_supplies',
    'bakeries_prepared_food_catering','books_cards_collectibles_hobby',
    'general_local_business')),
  constraint couranr_cp_name_chk    check (btrim(name) <> ''),
  constraint couranr_cp_version_chk check (version >= 1),
  constraint couranr_cp_body_chk    check (public.couranr_preset_body_is_clean(body))
);

create index if not exists couranr_cp_category_idx
  on public.couranr_category_presets (business_category)
  where archived_at is null;

comment on table public.couranr_category_presets is
  'Couranr global category presets - hierarchy level 1. Recommendations only: nothing here gates a capability, and the body cannot carry an exact weight, price, vehicle or safety claim.';

-- ---------------------------------------------------------------------
-- 3. MERCHANT presets — hierarchy levels 2 and 3
-- ---------------------------------------------------------------------
--
-- ONE table for both, distinguished by whether it points at a global preset:
--
--   source_category_preset_id IS NOT NULL  -> merchant-CUSTOMIZED (level 2)
--   source_category_preset_id IS NULL      -> merchant-CREATED    (level 3)
--
-- They are the same thing to every reader — a preset this merchant uses — and
-- splitting them would mean every list query became a union and every screen
-- carried two code paths for one concept.
create table if not exists public.couranr_merchant_presets (
  id                        uuid primary key default gen_random_uuid(),
  business_account_id       uuid not null,
  name                      text not null,
  body                      jsonb not null default '{}'::jsonb,

  -- Level 2 provenance. `source_version` is the global version this was
  -- customized FROM — the whole no-overwrite rule turns on it: when the global
  -- preset's version moves past this, an update is SUGGESTED, never applied.
  source_category_preset_id uuid,
  source_version            integer,

  version                   integer not null default 1,
  archived_at               timestamptz,
  created_by                uuid not null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint couranr_mp_business_fk
    foreign key (business_account_id) references public.business_accounts (id)
    on update cascade on delete restrict,
  constraint couranr_mp_source_fk
    foreign key (source_category_preset_id) references public.couranr_category_presets (id)
    on update cascade on delete restrict,

  constraint couranr_mp_name_chk    check (btrim(name) <> ''),
  constraint couranr_mp_version_chk check (version >= 1),
  constraint couranr_mp_body_chk    check (public.couranr_preset_body_is_clean(body)),

  -- A customization must say which VERSION it came from, and a
  -- merchant-created preset must not claim one. Without this a level-2 preset
  -- could exist with no baseline, and "has the global moved on?" would have no
  -- answer at all.
  --
  -- `source_version is not null` IS REQUIRED, and its absence was a real bug
  -- caught by executing this rather than reading it. With an id present and a
  -- NULL version the branches evaluate to `false OR (true AND NULL)` = NULL,
  -- and a CHECK only REJECTS on false — NULL passes. The constraint read
  -- correctly and enforced nothing.
  constraint couranr_mp_source_pair_chk check (
    (source_category_preset_id is null and source_version is null)
    or (source_category_preset_id is not null
        and source_version is not null
        and source_version >= 1)
  )
);

create index if not exists couranr_mp_business_idx
  on public.couranr_merchant_presets (business_account_id, updated_at desc);

-- One live preset per name per business. Archived ones are excluded so a name
-- can be reused after archiving, which is what a merchant expects.
create unique index if not exists couranr_mp_name_uniq
  on public.couranr_merchant_presets (business_account_id, lower(btrim(name)))
  where archived_at is null;

comment on table public.couranr_merchant_presets is
  'Merchant presets. source_category_preset_id set = customized from a Couranr global preset (level 2); null = merchant-created (level 3). A global update never rewrites this row.';

-- ---------------------------------------------------------------------
-- 4. VERSIONS — append-only, and the reason snapshots survive
-- ---------------------------------------------------------------------
--
-- "Every preset is versioned" and "historical preset snapshots remain". A
-- delivery stores the preset id AND version AND a body snapshot; this table is
-- what makes the version meaningful afterwards, by keeping the body that
-- version HAD.
create table if not exists public.couranr_merchant_preset_versions (
  id                  uuid primary key default gen_random_uuid(),
  merchant_preset_id  uuid not null,
  version             integer not null,
  name                text not null,
  body                jsonb not null,
  changed_by          uuid not null,
  created_at          timestamptz not null default now(),

  constraint couranr_mpv_preset_fk
    foreign key (merchant_preset_id) references public.couranr_merchant_presets (id)
    on update cascade on delete restrict,
  constraint couranr_mpv_version_chk check (version >= 1),
  constraint couranr_mpv_body_chk    check (public.couranr_preset_body_is_clean(body)),
  constraint couranr_mpv_uniq        unique (merchant_preset_id, version)
);

create index if not exists couranr_mpv_preset_idx
  on public.couranr_merchant_preset_versions (merchant_preset_id, version desc);

comment on table public.couranr_merchant_preset_versions is
  'Append-only history of every merchant preset version. Never updated and never deleted: a delivery that recorded version 3 must still be able to show what version 3 said.';

-- ---------------------------------------------------------------------
-- 5. The delivery's IMMUTABLE SNAPSHOT
-- ---------------------------------------------------------------------
--
-- §5: "Each delivery stores preset ID, version, and immutable snapshot."
--
-- The SNAPSHOT is the point. The id and version alone would leave a delivery
-- describing itself by reference to a row that can still change; the snapshot
-- is what the merchant actually saw and used, frozen. It is written once, on
-- the request, and nothing rewrites it.
alter table public.couranr_delivery_requests
  add column if not exists preset_id uuid,
  add column if not exists preset_version integer,
  add column if not exists preset_snapshot jsonb,
  add column if not exists preset_source text;

do $$
begin
  -- All four move together or none do. A snapshot with no id, or an id with no
  -- snapshot, is a half-recorded provenance that reads as complete.
  if not exists (select 1 from pg_constraint where conname = 'couranr_dr_preset_pair_chk') then
    alter table public.couranr_delivery_requests
      add constraint couranr_dr_preset_pair_chk check (
        (preset_id is null and preset_version is null
           and preset_snapshot is null and preset_source is null)
        or (preset_id is not null and preset_version >= 1
           and preset_snapshot is not null and preset_source is not null)
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'couranr_dr_preset_source_chk') then
    alter table public.couranr_delivery_requests
      add constraint couranr_dr_preset_source_chk check (
        preset_source is null or preset_source in ('couranr_global', 'merchant')
      );
  end if;

  if not exists (select 1 from pg_constraint where conname = 'couranr_dr_preset_body_chk') then
    alter table public.couranr_delivery_requests
      add constraint couranr_dr_preset_body_chk
      check (public.couranr_preset_body_is_clean(preset_snapshot));
  end if;
end
$$;

comment on column public.couranr_delivery_requests.preset_snapshot is
  'The preset body AS USED, frozen. Never rewritten when the preset changes - that is the whole point of storing it rather than a reference.';

-- ---------------------------------------------------------------------
-- 6. RLS and grants
-- ---------------------------------------------------------------------
alter table public.couranr_category_presets          enable row level security;
alter table public.couranr_merchant_presets          enable row level security;
alter table public.couranr_merchant_preset_versions  enable row level security;

-- House posture: no policies, service_role only, and `public` NAMED in every
-- revoke. `pg_default_acl` on this project grants ALL to anon, authenticated
-- AND service_role on every new table in `public`, so revoking from the two
-- browser roles alone is a silent no-op — they keep what they inherit through
-- PUBLIC.
--
-- SERVICE_ROLE IS REVOKED TOO, and that was the second bug execution found.
-- The default ACL had already granted it ALL, so a narrower `grant select,
-- insert` added nothing and left UPDATE and DELETE in place — "append-only"
-- was a comment, not a privilege. Revoke first, then grant back exactly what
-- each table needs.
revoke all on table public.couranr_category_presets         from public, anon, authenticated, service_role;
revoke all on table public.couranr_merchant_presets         from public, anon, authenticated, service_role;
revoke all on table public.couranr_merchant_preset_versions from public, anon, authenticated, service_role;

grant select, insert, update on table public.couranr_category_presets to service_role;
grant select, insert, update on table public.couranr_merchant_presets to service_role;
-- APPEND-ONLY, enforced by PRIVILEGE: insert and select, never update or
-- delete. A version that can be rewritten is not a history, and a delivery
-- citing version 3 could then be shown a version 3 that never existed.
grant select, insert on table public.couranr_merchant_preset_versions to service_role;

revoke all on function public.couranr_preset_body_is_clean(jsonb) from public, anon, authenticated;
-- Not revoked from service_role: this function is invoked from CHECKs on four
-- tables, and service_role is the identity doing the writing.
grant execute on function public.couranr_preset_body_is_clean(jsonb) to service_role;
