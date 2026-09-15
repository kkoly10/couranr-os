-- Consumer Same Day V1 — Trust, Custody & Fraud substrate.
--
-- Additive. Every new column is nullable and every new constraint is written so
-- that a row WITHOUT a protection policy version is unaffected. Historical
-- consumer and business requests stay readable and are never retroactively
-- presented as having passed a workflow that did not exist when they shipped.
--
-- WHAT THIS ADDS
--
--   1. declared_value_cents            a first-class commercial/risk fact
--   2. protection_level + version      SERVER-derived, re-derived here in SQL
--   3. sender acceptance evidence      versioned terms + electronic consent
--   4. adult attestation timestamps    sender and recipient, 18+
--   5. two proof types                 item_prepack_photo, sealed_package_photo
--   6. security seal record            serialized, applied at pickup, checked at drop-off
--   7. recipient identity verification minimal provider state, no ID imagery
--
-- THE INVARIANT THAT MATTERS MOST. `protection_level` is not a field the client
-- may choose. private.couranr_derive_protection_level re-derives it from
-- declared_value_cents, and couranr_dr_protection_derived_chk refuses any row
-- whose stored level disagrees. A tampered payload asking for 'standard' on a
-- $500 shipment fails at the database, not only in TypeScript — the browser is
-- not an enforcement point.
--
-- DECLARED VALUE IS A SENDER REPRESENTATION. Not an appraisal, not
-- authentication, not compensation, not insurance. Nothing here values goods.

begin;

/* ─────────────────────────── 1. the derivation ────────────────────────── */

-- Mirrors lib/couranr/consumer/protection.ts exactly. Cent precision, because
-- the owner decision is written that way: $30.01 begins secure pickup.
-- tests/couranr-consumer-protection-sql.test.ts compares the two tables so they
-- cannot drift into two different answers.
create or replace function private.couranr_derive_protection_level(p_cents integer)
returns text
language sql
immutable
set search_path=''
as $fn$
  select case
    when p_cents is null then null
    when p_cents < 0 then 'declined'
    when p_cents <= 3000 then 'standard'
    when p_cents <= 15000 then 'secure_pickup'
    when p_cents <= 50000 then 'protected_handoff'
    else 'declined'
  end
$fn$;

comment on function private.couranr_derive_protection_level(integer) is
  'Consumer Same Day protection level from declared value, in integer cents. '
  'The SECOND enforcement point: the client never chooses its level and the '
  'application never writes one this disagrees with. Mirrors '
  'lib/couranr/consumer/protection.ts; a test compares the two.';

revoke all on function private.couranr_derive_protection_level(integer)
  from public, anon, authenticated, service_role;

/* ────────────────────── 2. first-class request facts ──────────────────── */

alter table public.couranr_delivery_requests
  add column if not exists declared_value_cents integer,
  add column if not exists protection_level text,
  add column if not exists protection_policy_version text,
  add column if not exists sender_terms_version text,
  add column if not exists sender_terms_accepted_at timestamptz,
  add column if not exists sender_electronic_consent_at timestamptz,
  add column if not exists sender_adult_attested_at timestamptz,
  add column if not exists recipient_adult_attested_at timestamptz;

comment on column public.couranr_delivery_requests.declared_value_cents is
  'TOTAL declared value of the entire shipment, integer cents, sender '
  'representation only. Maximum 50000 ($500.00) per shipment, not per item. '
  'Deliberately NOT inside pickup_manifest: it is a commercial and risk fact, '
  'not a packing detail.';

comment on column public.couranr_delivery_requests.protection_level is
  'SERVER-DERIVED from declared_value_cents. Never client-chosen. Held equal to '
  'private.couranr_derive_protection_level by couranr_dr_protection_derived_chk.';

-- Range. Above the ceiling is refused at the database, so a direct API call
-- cannot create a $501 shipment even if every TypeScript guard were removed.
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_declared_value_range_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_declared_value_range_chk check (
    declared_value_cents is null
    or (declared_value_cents >= 0 and declared_value_cents <= 50000)
  );

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_protection_level_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_protection_level_chk check (
    protection_level is null
    or protection_level in ('standard','secure_pickup','protected_handoff')
  );

-- 'declined' is deliberately NOT storable: a declined shipment is not created.
-- The level column holds only levels a live shipment can actually be at.

-- THE ANTI-TAMPER INVARIANT.
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_protection_derived_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_protection_derived_chk check (
    protection_level is null
    or protection_level = private.couranr_derive_protection_level(declared_value_cents)
  );

-- A governed request carries the whole set or none of it. Half-governed is the
-- state that would let a $500 shipment exist with no level.
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_protection_completeness_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_protection_completeness_chk check (
    (protection_policy_version is null
      and protection_level is null
      and declared_value_cents is null)
    or (protection_policy_version is not null
      and protection_level is not null
      and declared_value_cents is not null)
  );

/* ───────────── 3. acceptance evidence, versioned not boolean ──────────── */

-- A boolean with no version and no timestamp is not evidence of what was
-- agreed. Each acceptance carries the document version it was given against.
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_terms_evidence_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_terms_evidence_chk check (
    (sender_terms_version is null and sender_terms_accepted_at is null)
    or (sender_terms_version is not null and sender_terms_accepted_at is not null)
  );

-- A GOVERNED consumer request that has been submitted must carry both
-- acceptances and both adult attestations. Version-aware: a request with no
-- policy version — every historical row — is untouched by this rule.
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_consumer_acceptance_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_consumer_acceptance_chk check (
    protection_policy_version is null
    or requester_kind <> 'consumer'
    or request_state in ('draft','awaiting_merchant_confirmation')
    or (
      sender_terms_version is not null
      and sender_terms_accepted_at is not null
      and sender_electronic_consent_at is not null
      and sender_adult_attested_at is not null
      and recipient_adult_attested_at is not null
    )
  );

/* ─────────────── 4. email-first: sender AND recipient required ────────── */

-- The existing couranr_dr_consumer_submitted_contact_chk accepts phone OR
-- email. Consumer Same Day V1 is email-first, so a governed request needs a
-- sender email and a recipient name + email. The old constraint is LEFT IN
-- PLACE and this one is added beside it: the old rule still governs historical
-- and ungoverned rows, this one governs policy-bearing ones, and neither has to
-- be relaxed for the other.
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_consumer_email_first_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_consumer_email_first_chk check (
    protection_policy_version is null
    or requester_kind <> 'consumer'
    or request_state in ('draft','awaiting_merchant_confirmation')
    or (
      nullif(btrim(consumer_contact_snapshot ->> 'email'), '') is not null
      and nullif(btrim(coalesce(recipient_name, '')), '') is not null
      and nullif(btrim(coalesce(recipient_email, '')), '') is not null
    )
  );

/* ───────────────────────── 5. the two proof types ─────────────────────── */

-- Extends the governed proof vocabulary rather than adding a second evidence
-- table. The distinction these two carry is the whole point of Secure Pickup:
--   item_prepack_photo    WHAT ITEM WAS PRESENTED, before the package was sealed
--   sealed_package_photo  WHAT SEALED PACKAGE Couranr took custody of
alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_delivery_proofs_proof_type_check;
alter table public.couranr_delivery_proofs
  add constraint couranr_delivery_proofs_proof_type_check check (
    proof_type in (
      'shipment_photo','condition_photo','securement_photo','discrepancy_evidence',
      'delivery_photo','signature','recipient_pin','return_condition_photo',
      'item_prepack_photo','sealed_package_photo'
    )
  );

/* ──────────────────────── 6. the security seal ────────────────────────── */

create table if not exists public.couranr_delivery_security_seals (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.couranr_deliveries(id)
    on update cascade on delete restrict,
  -- Serialized tamper-evident label. V1 accepts a manufacturer serial or a
  -- Couranr-format identifier; no custom branding is assumed yet.
  seal_identifier text not null,
  applied_at timestamptz not null default now(),
  applied_by_driver_id uuid,
  -- The sealed-package photograph this seal is visible in.
  sealed_package_proof_id uuid references public.couranr_delivery_proofs(id)
    on update cascade on delete restrict,
  -- Recorded at drop-off, never at pickup.
  dropoff_condition text,
  dropoff_recorded_at timestamptz,
  dropoff_recorded_by_driver_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couranr_dss_identifier_shape_chk check (
    btrim(seal_identifier) <> '' and length(btrim(seal_identifier)) between 4 and 64
  ),
  constraint couranr_dss_condition_chk check (
    dropoff_condition is null
    or dropoff_condition in ('intact','damaged','missing')
  ),
  -- A condition without the moment it was recorded is not evidence.
  constraint couranr_dss_condition_pair_chk check (
    (dropoff_condition is null and dropoff_recorded_at is null)
    or (dropoff_condition is not null and dropoff_recorded_at is not null)
  )
);

-- One live seal per delivery. A second seal row would make "which seal did the
-- driver check at the door" ambiguous in exactly the dispute this evidence
-- exists to settle.
create unique index if not exists couranr_dss_one_seal_per_delivery_uniq
  on public.couranr_delivery_security_seals (delivery_id);

create index if not exists couranr_dss_identifier_idx
  on public.couranr_delivery_security_seals (seal_identifier);

comment on table public.couranr_delivery_security_seals is
  'Serialized tamper-evident seal applied at Secure Pickup and checked at '
  'drop-off. A damaged or missing seal is an exception path, never a silent '
  'happy-path completion.';

/* ─────────────── 7. recipient identity verification, minimal ──────────── */

-- Deliberately a small dedicated table rather than JSON: it holds the only
-- identity state Couranr keeps, and it needs its own retention seam.
--
-- WHAT IS DELIBERATELY ABSENT, and must stay absent: government ID photograph,
-- full driver's-license number, raw barcode payload, full date of birth, and
-- the address printed on an ID. Couranr stores the ANSWER, never the document.
create table if not exists public.couranr_recipient_identity_verifications (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.couranr_deliveries(id)
    on update cascade on delete restrict,
  provider text not null default 'stripe_identity',
  -- The provider's own reference. Not a credential and not resolvable to a
  -- document by anyone holding this row alone.
  provider_reference text,
  identity_verified boolean not null default false,
  adult_verified boolean not null default false,
  -- Whether the verified person matches the designated/authorized adult
  -- recipient named before custody began.
  authorized_recipient_match boolean not null default false,
  verification_state text not null default 'pending',
  verified_at timestamptz,
  policy_version text not null,
  -- Retention seam: set when the provider reference is purged.
  provider_reference_purged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couranr_riv_provider_chk check (provider in ('stripe_identity')),
  constraint couranr_riv_state_chk check (
    verification_state in ('pending','processing','verified','failed','unavailable','canceled')
  ),
  -- A verified row must say when. An unverified row must not claim a moment.
  constraint couranr_riv_verified_pair_chk check (
    (verification_state = 'verified' and verified_at is not null)
    or (verification_state <> 'verified' and verified_at is null)
  ),
  -- Adulthood and match are only meaningful once identity itself is verified.
  constraint couranr_riv_derived_flags_chk check (
    identity_verified
    or (adult_verified = false and authorized_recipient_match = false)
  )
);

create unique index if not exists couranr_riv_one_live_per_delivery_uniq
  on public.couranr_recipient_identity_verifications (delivery_id)
  where verification_state <> 'canceled';

comment on table public.couranr_recipient_identity_verifications is
  'Minimal recipient identity state for protected handoff. Stores the ANSWER '
  '(verified yes/no, adult yes/no, authorized-recipient match) and a provider '
  'reference — never a government ID image, full licence number, raw barcode '
  'payload, full date of birth, or ID address.';

/* ───────────────────────────── 8. grants ──────────────────────────────── */

-- pg_default_acl grants arwdDxtm to anon/authenticated/service_role on every
-- new table in public, which makes a narrow GRANT a silent no-op. Revoke first,
-- then grant only what the server needs. These tables are written exclusively
-- by governed commands.
revoke all on public.couranr_delivery_security_seals
  from public, anon, authenticated, service_role;
revoke all on public.couranr_recipient_identity_verifications
  from public, anon, authenticated, service_role;

grant select, insert, update on public.couranr_delivery_security_seals to service_role;
grant select, insert, update on public.couranr_recipient_identity_verifications to service_role;

alter table public.couranr_delivery_security_seals enable row level security;
alter table public.couranr_recipient_identity_verifications enable row level security;

commit;
