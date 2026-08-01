-- =====================================================================
-- Service plans and canonical deliveries — schema.
--
-- WHY NOT THE EXISTING `vehicles` TABLE.
-- It was inspected first, as instructed. `public.vehicles` is the legacy
-- AUTO-RENTAL table: year, make, model, trim, vin, plate, colour, mileage,
-- daily_rate_cents, weekly_rate_cents, deposit_cents, image_urls. It holds
-- ZERO rows and carries no payload, capacity or cargo-dimension field, so
-- nothing in it can establish that a vehicle is "compatible with the stored
-- shipment". CLAUDE.md also names the auto domain a quarantine target, not an
-- extension point.
--
-- So the service plan stores an IMMUTABLE VEHICLE-REQUIREMENT SNAPSHOT — the
-- second option the brief allows — and keeps `vehicle_id` nullable and
-- unconstrained by a foreign key, so a future canonical vehicle table can be
-- pointed at without a migration on a table that by then holds live plans.
-- Building vehicle management is explicitly not this slice.
--
-- WHY NO CANONICAL ORDER TABLE.
-- The brief says the delivery request remains the commercial authority for
-- MVP and not to invent one unless an authority requires it. Nothing does, so
-- `couranr_deliveries.request_id` is the link and the request keeps the money
-- and quote history.
--
-- ADDITIVE. Two new tables, one new payment state value. Nothing dropped.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regclass('public.couranr_payment_obligations') is null then
    raise exception 'apply the payment migrations first';
  end if;
  if to_regclass('public.couranr_service_plans') is not null
     or to_regclass('public.couranr_deliveries') is not null then
    raise exception 'a canonical table already exists; its shape has not been verified';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- 1. capture_pending
--
-- The state that makes capture recoverable: it is written BEFORE Stripe is
-- called, so a process that dies mid-capture leaves a row that says "a capture
-- was started and we do not yet know the outcome" rather than one that says
-- "authorized" and invites a second attempt.
-- ---------------------------------------------------------------------
alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_payment_state_chk;

alter table public.couranr_payment_obligations
  add constraint couranr_po_payment_state_chk check (payment_state in (
    'not_started','requires_action','authorized',
    'capture_pending','captured',
    'failed','cancelled','refunded'));

alter table public.couranr_payment_obligations
  add column if not exists captured_at            timestamptz,
  add column if not exists captured_amount_cents  integer,
  add column if not exists capture_requested_at   timestamptz;

alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_captured_stamp_chk;
alter table public.couranr_payment_obligations
  add constraint couranr_po_captured_stamp_chk check (
    (payment_state = 'captured') = (captured_at is not null)
  );
-- A captured obligation must say what was actually taken, and it must be what
-- was authorized. Capturing less than the hold is a partial capture, which
-- this slice does not do.
alter table public.couranr_payment_obligations
  add constraint couranr_po_captured_amount_chk check (
    captured_amount_cents is null or captured_amount_cents = amount_cents
  );

-- ---------------------------------------------------------------------
-- 2. couranr_service_plans
-- ---------------------------------------------------------------------
create table public.couranr_service_plans (
  id                      uuid primary key default gen_random_uuid(),
  request_id              uuid not null,
  business_account_id     uuid not null,
  payment_obligation_id   uuid not null,

  -- The generation of the request and quote this plan was confirmed against.
  request_version         integer not null,

  scheduled_pickup_start  timestamptz not null,
  scheduled_pickup_end    timestamptz not null,
  timezone                text not null,

  /*
   * Either a concrete vehicle (when a canonical vehicle table exists) or the
   * requirement Couranr committed to. `vehicle_id` has NO foreign key on
   * purpose: the only vehicle table today is the auto-rental one, and pointing
   * at it would tie canonical delivery to a quarantined domain.
   */
  vehicle_id                  uuid,
  vehicle_requirement         jsonb not null,

  plan_state              text not null default 'draft',
  confirmed_by            uuid,
  confirmed_at            timestamptz,
  version                 integer not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint couranr_sp_request_fk
    foreign key (request_id) references public.couranr_delivery_requests (id)
    on update cascade on delete restrict,
  constraint couranr_sp_business_fk
    foreign key (business_account_id) references public.business_accounts (id)
    on update cascade on delete restrict,
  constraint couranr_sp_obligation_fk
    foreign key (payment_obligation_id) references public.couranr_payment_obligations (id)
    on update cascade on delete restrict,

  constraint couranr_sp_plan_state_chk check (plan_state in ('draft','confirmed','cancelled')),
  constraint couranr_sp_window_chk check (scheduled_pickup_end > scheduled_pickup_start),
  constraint couranr_sp_timezone_chk check (length(btrim(timezone)) > 0),
  constraint couranr_sp_version_chk check (version >= 1),
  constraint couranr_sp_requirement_is_object_chk
    check (jsonb_typeof(vehicle_requirement) = 'object'),
  -- A confirmed plan names who confirmed it and when. Both, or neither.
  constraint couranr_sp_confirmed_stamp_chk check (
    (plan_state = 'confirmed') = (confirmed_at is not null and confirmed_by is not null)
  )
);

comment on table public.couranr_service_plans is
  'What Couranr Operations committed to before capturing: a pickup window, a timezone, and either a vehicle or an immutable vehicle-requirement snapshot. No driver is assigned here.';
comment on column public.couranr_service_plans.vehicle_id is
  'Nullable and deliberately WITHOUT a foreign key. The only vehicle table today is the legacy auto-rental one (0 rows, no capacity fields); a canonical vehicle table can be referenced later without migrating a table that holds live plans.';

-- At most one live plan per request, the same invariant the obligations table
-- uses. Re-planning means cancelling and confirming a new one.
create unique index couranr_sp_one_live_per_request
  on public.couranr_service_plans (request_id)
  where plan_state <> 'cancelled';

create index couranr_sp_business_idx
  on public.couranr_service_plans (business_account_id, created_at desc);

-- ---------------------------------------------------------------------
-- 3. couranr_deliveries  — the canonical delivery
--
-- Created only after capture. Snapshots everything it needs, so a later edit
-- to the request cannot retroactively change what a driver was dispatched to
-- do or what the customer was charged for.
-- ---------------------------------------------------------------------
create table public.couranr_deliveries (
  id                      uuid primary key default gen_random_uuid(),

  -- ONE-TO-ONE with the request. This unique constraint IS the idempotency
  -- guarantee for conversion: a second attempt collides rather than creating
  -- a second delivery.
  request_id              uuid not null,
  business_account_id     uuid not null,
  payment_obligation_id   uuid not null,
  service_plan_id         uuid not null,

  request_version         integer not null,
  pricing_policy_version  text not null,
  captured_amount_cents   integer not null,
  currency                text not null,

  pickup_address          jsonb not null,
  dropoff_address         jsonb not null,
  recipient               jsonb not null,
  shipment                jsonb not null,
  service_level           text not null,
  signature_required      boolean not null,
  proof_method            text not null,

  scheduled_pickup_start  timestamptz not null,
  scheduled_pickup_end    timestamptz not null,
  timezone                text not null,
  vehicle_id              uuid,
  vehicle_requirement     jsonb not null,

  fulfillment_state       text not null default 'scheduled',
  version                 integer not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint couranr_dlv_request_uniq unique (request_id),
  constraint couranr_dlv_request_fk
    foreign key (request_id) references public.couranr_delivery_requests (id)
    on update cascade on delete restrict,
  constraint couranr_dlv_business_fk
    foreign key (business_account_id) references public.business_accounts (id)
    on update cascade on delete restrict,
  constraint couranr_dlv_obligation_fk
    foreign key (payment_obligation_id) references public.couranr_payment_obligations (id)
    on update cascade on delete restrict,
  constraint couranr_dlv_plan_fk
    foreign key (service_plan_id) references public.couranr_service_plans (id)
    on update cascade on delete restrict,

  /*
   * The fulfillment vocabulary. Only `scheduled` is reachable in this slice —
   * assignment, pickup, transit and completion are the next one. The values
   * are declared now so shipping them is a transition rather than a CHECK
   * rewrite on a table holding live deliveries.
   */
  constraint couranr_dlv_fulfillment_chk check (fulfillment_state in (
    'scheduled','assigned','en_route_to_pickup','picked_up',
    'in_transit','delivered','could_not_deliver','cancelled')),

  constraint couranr_dlv_amount_chk check (captured_amount_cents > 0),
  constraint couranr_dlv_currency_chk check (currency = 'usd'),
  constraint couranr_dlv_window_chk check (scheduled_pickup_end > scheduled_pickup_start),
  constraint couranr_dlv_version_chk check (version >= 1),
  constraint couranr_dlv_service_level_chk check (service_level in ('standard','priority','rush')),
  constraint couranr_dlv_proof_chk check (proof_method in ('photo_or_pin','signature','leave_at_door')),
  constraint couranr_dlv_pickup_obj_chk check (jsonb_typeof(pickup_address) = 'object'),
  constraint couranr_dlv_dropoff_obj_chk check (jsonb_typeof(dropoff_address) = 'object'),
  constraint couranr_dlv_recipient_obj_chk check (jsonb_typeof(recipient) = 'object'),
  constraint couranr_dlv_shipment_obj_chk check (jsonb_typeof(shipment) = 'object'),
  constraint couranr_dlv_requirement_obj_chk check (jsonb_typeof(vehicle_requirement) = 'object')
);

comment on table public.couranr_deliveries is
  'The canonical Couranr delivery. Created only after payment capture, one per request. Snapshots the addresses, recipient, shipment, quote version and service plan so a later edit cannot retroactively change what was dispatched or what was charged. NOT the legacy `deliveries` table.';

create index couranr_dlv_business_idx
  on public.couranr_deliveries (business_account_id, created_at desc);
create index couranr_dlv_state_idx
  on public.couranr_deliveries (fulfillment_state, scheduled_pickup_start);

create table public.couranr_delivery_events (
  id             uuid primary key default gen_random_uuid(),
  delivery_id    uuid not null,
  actor_user_id  uuid,
  actor_type     text not null,
  command        text not null,
  from_state     text,
  to_state       text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),

  constraint couranr_dlve_delivery_fk
    foreign key (delivery_id) references public.couranr_deliveries (id)
    on update cascade on delete restrict,
  constraint couranr_dlve_actor_type_chk check (actor_type in (
    'merchant','customer','driver','operations','system')),
  constraint couranr_dlve_command_chk check (command in (
    'create_delivery_from_capture')),
  constraint couranr_dlve_metadata_obj_chk check (jsonb_typeof(metadata) = 'object'),
  constraint couranr_dlve_actor_present_chk check (
    (actor_type = 'system' and actor_user_id is null)
    or (actor_type <> 'system' and actor_user_id is not null)
  )
);

comment on table public.couranr_delivery_events is
  'Append-only audit of canonical delivery state. Written only by named server commands.';

create index couranr_dlve_delivery_idx
  on public.couranr_delivery_events (delivery_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4. Security. Same posture as every other canonical table.
-- ---------------------------------------------------------------------
alter table public.couranr_service_plans    enable row level security;
alter table public.couranr_deliveries       enable row level security;
alter table public.couranr_delivery_events  enable row level security;

revoke all on public.couranr_service_plans    from public, anon, authenticated;
revoke all on public.couranr_deliveries       from public, anon, authenticated;
revoke all on public.couranr_delivery_events  from public, anon, authenticated;

-- pg_default_acl grants ALL to anon, authenticated and service_role on every
-- new table here, so a bare additive grant would enforce nothing.
revoke all on public.couranr_service_plans    from service_role;
revoke all on public.couranr_deliveries       from service_role;
revoke all on public.couranr_delivery_events  from service_role;

grant select, insert, update on public.couranr_service_plans to service_role;
grant select, insert, update on public.couranr_deliveries to service_role;
grant select, insert on public.couranr_delivery_events to service_role;

commit;
