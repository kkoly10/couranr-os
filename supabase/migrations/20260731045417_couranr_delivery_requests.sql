-- =====================================================================
-- Couranr canonical delivery-request lifecycle — ADDITIVE MIGRATION
--
-- Creates exactly two new tables:
--   public.couranr_delivery_requests
--   public.couranr_delivery_request_events
--
-- ADDITIVE ONLY. This migration contains no DROP TABLE, no DROP COLUMN, no
-- ALTER of any existing table, no DELETE, no TRUNCATE, and no change to any
-- existing policy, grant or row. `orders`, `deliveries`, `business_jobs`, the
-- document-service tables and the audit tables are untouched.
--
-- State vocabularies are taken verbatim from 02_DECISION_REGISTRY.json
-- STA-001 (request / readiness / review) which derives from
-- Couranr_Claude_Code_Master_Package.md §8. No replacement vocabulary is
-- invented here.
--
-- SECURITY POSTURE (matches the Security-DB P0 containment already applied):
--   * RLS enabled immediately on both tables
--   * no policies created, so both are deny-all for every non-bypassing role
--   * all privileges revoked from PUBLIC, anon and authenticated
--   * service_role retains access, so named server commands still work
--   * no SECURITY DEFINER function is created — none is required, because all
--     reads and writes go through authorized server commands
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- HARD GUARD. `create table if not exists` would silently accept an
-- existing table of a DIFFERENT shape, leaving the database looking
-- migrated while missing columns or constraints. Abort instead.
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.couranr_delivery_requests') is not null then
    raise exception
      'couranr_delivery_requests already exists. Refusing to run: its shape has not been verified. Inspect it and roll back before re-applying.';
  end if;
  if to_regclass('public.couranr_delivery_request_events') is not null then
    raise exception
      'couranr_delivery_request_events already exists. Refusing to run: its shape has not been verified. Inspect it and roll back before re-applying.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1. couranr_delivery_requests
-- ---------------------------------------------------------------------
create table if not exists public.couranr_delivery_requests (
  -- Identity and tenancy -------------------------------------------------
  id                       uuid primary key default gen_random_uuid(),
  business_account_id      uuid not null,
  created_by               uuid not null,
  idempotency_key          text not null,
  source                   text not null default 'merchant_portal',
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  submitted_at             timestamptz,
  -- Optimistic concurrency. Every command must compare-and-set this.
  version                  integer not null default 1,

  -- Lifecycle (STA-001) --------------------------------------------------
  request_state            text not null default 'draft',
  readiness_state          text not null default 'not_confirmed',
  review_state             text not null default 'not_required',
  -- SVC-002 is unresolved: market boundaries are undefined, so every request
  -- is captured and marked pending rather than auto-accepted or rejected.
  service_area_review_state text not null default 'pending',
  payer_type               text not null default 'merchant',
  quote_status             text not null default 'not_quoted',

  -- Shipment -------------------------------------------------------------
  recipient_name           text,
  recipient_phone          text,
  recipient_email          text,
  loaded_miles             numeric(8,3),
  weight_lb                numeric(8,2),
  additional_stops         integer not null default 0,
  service_level            text not null default 'standard',
  signature_required       boolean not null default false,
  proof_method             text not null default 'photo_or_pin',

  -- Pricing snapshot — server-computed only ------------------------------
  pricing_policy_version   text,
  delivery_subtotal_cents  integer,
  included_loaded_miles    integer,
  billable_loaded_miles    numeric(8,3),
  -- PRC-004 and TAX-001 are unresolved. These columns exist so the snapshot
  -- is explicit, and are constrained false so no code can quietly flip them.
  rounding_applied         boolean not null default false,
  tax_included             boolean not null default false,
  -- Never set by this slice: no payment decision is made before capture.
  payment_due_cents        integer,
  quote_line_items         jsonb not null default '[]'::jsonb,
  review_reasons           jsonb not null default '[]'::jsonb,

  -- Structured snapshots -------------------------------------------------
  -- Immutable request-time address snapshots. Typed columns above remain
  -- authoritative for status, money and anything queryable.
  pickup_address              jsonb,
  dropoff_address             jsonb,
  normalized_request_payload  jsonb not null default '{}'::jsonb,

  -- Tenancy + idempotency ------------------------------------------------
  constraint couranr_delivery_requests_idempotency_uniq
    unique (business_account_id, idempotency_key),

  -- Foreign keys. RESTRICT: deleting a business or a user must never
  -- silently destroy a submitted request.
  constraint couranr_delivery_requests_business_fk
    foreign key (business_account_id) references public.business_accounts (id)
    on update cascade on delete restrict,
  constraint couranr_delivery_requests_created_by_fk
    foreign key (created_by) references auth.users (id)
    on update cascade on delete restrict,

  -- Canonical state checks (STA-001) -------------------------------------
  constraint couranr_dr_request_state_chk check (request_state in (
    'draft','awaiting_merchant_confirmation','awaiting_quote_acceptance',
    'pending_couranr_review','quote_revision_required','confirmed',
    'declined','cancelled','closed')),
  constraint couranr_dr_readiness_state_chk check (readiness_state in (
    'not_confirmed','preparing','ready','not_ready','unavailable')),
  constraint couranr_dr_review_state_chk check (review_state in (
    'not_required','pending','accepted_as_quoted','requoted','declined')),
  constraint couranr_dr_service_area_state_chk check (service_area_review_state in (
    'pending','in_area','out_of_area_review','declined')),
  constraint couranr_dr_payer_type_chk check (payer_type in ('merchant','customer')),
  constraint couranr_dr_quote_status_chk check (quote_status in (
    'not_quoted','estimated','manual_review_required','invalid')),

  -- Commit G service levels. Overnight is deliberately absent.
  constraint couranr_dr_service_level_chk check (service_level in (
    'standard','priority','rush')),
  constraint couranr_dr_proof_method_chk check (proof_method in (
    'photo_or_pin','signature','leave_at_door')),
  constraint couranr_dr_source_chk check (source in (
    'merchant_portal','smart_intake','hosted_request','operations')),

  -- Non-negativity and wholeness ----------------------------------------
  constraint couranr_dr_miles_nonneg_chk check (loaded_miles is null or loaded_miles >= 0),
  constraint couranr_dr_weight_nonneg_chk check (weight_lb is null or weight_lb >= 0),
  constraint couranr_dr_stops_nonneg_chk check (additional_stops >= 0),
  constraint couranr_dr_subtotal_nonneg_chk
    check (delivery_subtotal_cents is null or delivery_subtotal_cents >= 0),
  constraint couranr_dr_payment_due_nonneg_chk
    check (payment_due_cents is null or payment_due_cents >= 0),
  constraint couranr_dr_included_miles_nonneg_chk
    check (included_loaded_miles is null or included_loaded_miles >= 0),
  constraint couranr_dr_billable_miles_nonneg_chk
    check (billable_loaded_miles is null or billable_loaded_miles >= 0),
  constraint couranr_dr_version_positive_chk check (version >= 1),

  -- PRC-004 / TAX-001 remain unresolved: neither may be asserted true.
  constraint couranr_dr_no_rounding_chk check (rounding_applied = false),
  constraint couranr_dr_no_tax_chk check (tax_included = false),

  -- This slice is pre-payment. No payment decision is made, so no payment
  -- amount may be persisted. Enforced in the database, not only in the
  -- pricing types, so no future route can quietly begin writing an amount
  -- before the payment decision (PAY-001) is made. Dropping this constraint
  -- is the deliberate act that opens the payment slice.
  constraint couranr_dr_no_payment_due_chk check (payment_due_cents is null),

  -- A submitted request must record when it was submitted, and a draft
  -- must not claim to have been.
  constraint couranr_dr_submitted_at_chk check (
    (request_state in ('draft','awaiting_merchant_confirmation') and submitted_at is null)
    or (request_state not in ('draft','awaiting_merchant_confirmation') and submitted_at is not null)
  ),

  -- An estimated quote must carry the server-computed subtotal AND the
  -- policy version that produced it. A manual-review quote may carry neither.
  constraint couranr_dr_estimate_completeness_chk check (
    (quote_status = 'estimated'
       and delivery_subtotal_cents is not null
       and pricing_policy_version is not null)
    or (quote_status <> 'estimated')
  ),
  constraint couranr_dr_manual_review_chk check (
    quote_status <> 'manual_review_required'
    or delivery_subtotal_cents is null
  ),

  -- JSONB shape guards. Line items and reasons are arrays; the snapshots
  -- are objects. Prevents a scalar being written into a structural column.
  constraint couranr_dr_line_items_is_array_chk
    check (jsonb_typeof(quote_line_items) = 'array'),
  constraint couranr_dr_review_reasons_is_array_chk
    check (jsonb_typeof(review_reasons) = 'array'),
  constraint couranr_dr_normalized_is_object_chk
    check (jsonb_typeof(normalized_request_payload) = 'object'),
  constraint couranr_dr_pickup_is_object_chk
    check (pickup_address is null or jsonb_typeof(pickup_address) = 'object'),
  constraint couranr_dr_dropoff_is_object_chk
    check (dropoff_address is null or jsonb_typeof(dropoff_address) = 'object')
);

comment on table public.couranr_delivery_requests is
  'Canonical Couranr delivery request. Pre-order lifecycle only: a submitted request creates no order and no delivery row. Typed columns are authoritative for status, money and queryable fields; JSONB columns hold immutable request-time snapshots.';
comment on column public.couranr_delivery_requests.delivery_subtotal_cents is
  'Server-computed by lib/couranr/pricing. Never accepted from a client. Integer cents.';
comment on column public.couranr_delivery_requests.rounding_applied is
  'Constrained false: PRC-004 (the $0.25 rounding trigger) is unresolved.';
comment on column public.couranr_delivery_requests.tax_included is
  'Constrained false: TAX-001 (tax treatment) is unresolved.';
comment on column public.couranr_delivery_requests.service_area_review_state is
  'Defaults to pending: SVC-002 market boundaries are unresolved, so every address is captured for review rather than auto-accepted or rejected.';
comment on column public.couranr_delivery_requests.version is
  'Optimistic concurrency token. Server commands compare-and-set; a stale value fails the update.';

-- Indexes --------------------------------------------------------------
create index if not exists couranr_dr_business_created_idx
  on public.couranr_delivery_requests (business_account_id, created_at desc);
create index if not exists couranr_dr_review_submitted_idx
  on public.couranr_delivery_requests (review_state, submitted_at desc);
create index if not exists couranr_dr_request_updated_idx
  on public.couranr_delivery_requests (request_state, updated_at desc);
create index if not exists couranr_dr_created_by_idx
  on public.couranr_delivery_requests (created_by);

-- ---------------------------------------------------------------------
-- 2. couranr_delivery_request_events  (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.couranr_delivery_request_events (
  id             uuid primary key default gen_random_uuid(),
  request_id     uuid not null,
  -- Null for system actions.
  actor_user_id  uuid,
  actor_type     text not null,
  command        text not null,
  from_state     text,
  to_state       text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),

  constraint couranr_dre_request_fk
    foreign key (request_id) references public.couranr_delivery_requests (id)
    on update cascade on delete restrict,

  constraint couranr_dre_actor_type_chk check (actor_type in (
    'merchant','customer','driver','operations','system')),
  constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft',
    'calculate_delivery_request_estimate',
    'submit_delivery_request',
    'begin_delivery_request_review')),
  constraint couranr_dre_metadata_is_object_chk
    check (jsonb_typeof(metadata) = 'object'),
  -- A system action has no user; every other actor type must name one.
  constraint couranr_dre_actor_present_chk check (
    (actor_type = 'system' and actor_user_id is null)
    or (actor_type <> 'system' and actor_user_id is not null)
  )
);

comment on table public.couranr_delivery_request_events is
  'Append-only audit of delivery-request state changes. Written only by named server commands. Must never contain secrets, authorization tokens or signed URLs.';

create index if not exists couranr_dre_request_created_idx
  on public.couranr_delivery_request_events (request_id, created_at desc);

-- ---------------------------------------------------------------------
-- 3. Security. Same posture as the applied Security-DB P0 containment:
--    RLS on, no policies, no client privileges, service_role preserved.
-- ---------------------------------------------------------------------
alter table public.couranr_delivery_requests       enable row level security;
alter table public.couranr_delivery_request_events enable row level security;

revoke all on public.couranr_delivery_requests       from public, anon, authenticated;
revoke all on public.couranr_delivery_request_events from public, anon, authenticated;

-- IMPORTANT: this project's pg_default_acl grants arwdDxtm (ALL) to anon,
-- authenticated AND service_role on every newly created table in `public`
-- (owner `postgres`, and again for owner `supabase_admin`). A bare
-- `grant select, insert ... to service_role` is a no-op addition on top of an
-- inherited ALL and enforces nothing.
--
-- Revoke EVERYTHING from service_role first, then grant back exactly the verbs
-- the named server commands need. This also strips REFERENCES, TRIGGER and
-- MAINTAIN, which the inherited default silently included.
revoke all on public.couranr_delivery_requests       from service_role;
revoke all on public.couranr_delivery_request_events from service_role;

-- Requests: read, create, advance. Never deleted or truncated, so neither a
-- bug nor a compromised command can erase merchant history.
grant select, insert, update on public.couranr_delivery_requests to service_role;

-- Events: append-only.
grant select, insert on public.couranr_delivery_request_events to service_role;

commit;
