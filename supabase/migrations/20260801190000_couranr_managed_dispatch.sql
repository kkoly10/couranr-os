-- =====================================================================
-- Managed dispatch: canonical drivers, canonical dispatch vehicles, and the
-- assignment that moves a scheduled delivery to `assigned`.
--
-- WHAT THIS SLICE DOES
--   scheduled canonical delivery
--     -> Operations selects a driver and a vehicle
--     -> the assignment is recorded
--     -> fulfillment_state scheduled -> assigned
--     -> the assigned driver can read a sanitized projection
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   No en-route, no arrival, no pickup PIN, no photos, no discrepancies, no
--   in-transit execution, no drop-off proof, no returns, no incidents, no live
--   tracking. Those states already exist in the fulfillment CHECK and stay
--   unreachable from here.
--
--   There is no marketplace. A driver cannot browse, bid on, or self-select
--   work: every command below is Operations-authored, and the only thing a
--   driver may do is READ the one delivery assigned to them.
--
-- WHY NEW TABLES RATHER THAN REUSE
--   The only vehicle table today is the auto-rental `vehicles` (16 columns, no
--   payload capacity, referenced by `rentals` and `vehicle_maintenance`). It is
--   quarantined and is not the canonical dispatch vehicle table. There is no
--   driver table at all — `profiles.role = 'driver'` is the entire model today
--   (1 row). Nothing existing satisfies the tenant/capability/assignment model,
--   so this creates narrow canonical tables beside the legacy ones and mutates
--   neither.
--
-- THE ONE REUSE THAT IS SAFE
--   `couranr_deliveries.fulfillment_state` already permits 'assigned' — see the
--   CHECK created in 20260801083000. No constraint changes.
--
-- ADDITIVE ONLY. Creates four tables and seven functions, and adds two FK
-- guards to columns that are 100% NULL today (14/14 deliveries, 25/25 plans).
-- Drops nothing, deletes nothing, rewrites no row.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- 1. couranr_drivers
--
--    A driver ACCOUNT maps to exactly one current canonical profile — the
--    unique index on user_id is that rule, not a convention.
-- ---------------------------------------------------------------------
create table if not exists public.couranr_drivers (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null,

  display_name        text not null,
  -- What Operations needs to reach this driver for a handoff. Never exposed to
  -- a merchant or a customer by any read path in this slice.
  contact_phone       text,

  driver_state        text not null default 'pending',
  availability_state  text not null default 'unavailable',
  active              boolean not null default true,

  -- Home/service market. Free text for MVP: the four named markets are a
  -- Phase 3 decision and inventing an enum now would pre-empt the registry.
  market              text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  version             integer not null default 1,

  constraint couranr_drv_user_fk
    foreign key (user_id) references auth.users (id)
    on update cascade on delete restrict,

  constraint couranr_drv_state_chk
    check (driver_state in ('pending','active','suspended','inactive')),
  constraint couranr_drv_availability_chk
    check (availability_state in ('available','unavailable','on_delivery')),
  constraint couranr_drv_name_chk check (length(btrim(display_name)) > 0),
  constraint couranr_drv_version_chk check (version >= 1)
);

create unique index if not exists couranr_drv_user_uniq
  on public.couranr_drivers (user_id);

comment on table public.couranr_drivers is
  'Canonical Couranr driver profile. Exactly one per auth user, enforced by couranr_drv_user_uniq. Only an active + available driver may receive an assignment; Operations owns every transition. Drivers never self-select work.';

-- ---------------------------------------------------------------------
-- 2. couranr_dispatch_vehicles
--
--    Delivery-specific, and deliberately NOT the auto-rental `vehicles` table:
--    that one has no payload capacity, no cargo dimensions and no capability
--    flags, and it is pinned by live rental rows.
-- ---------------------------------------------------------------------
create table if not exists public.couranr_dispatch_vehicles (
  id                   uuid primary key default gen_random_uuid(),

  -- NULL means an operator-owned pool vehicle any driver may use. A non-null
  -- value restricts it to that driver.
  assigned_driver_id   uuid,

  name                 text not null,
  vehicle_class        text not null,
  payload_capacity_lb  integer not null,

  -- Cargo dimensions when known. Optional for MVP by design.
  cargo_length_in      integer,
  cargo_width_in       integer,
  cargo_height_in      integer,

  enclosed             boolean not null default false,
  has_ramp             boolean not null default false,
  has_dolly            boolean not null default false,
  has_tie_downs        boolean not null default false,
  weather_protection   boolean not null default false,

  active               boolean not null default true,
  availability_state   text not null default 'available',

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  version              integer not null default 1,

  constraint couranr_dv_driver_fk
    foreign key (assigned_driver_id) references public.couranr_drivers (id)
    on update cascade on delete restrict,

  constraint couranr_dv_class_chk
    check (vehicle_class in ('car','van','box_truck','cargo_bike')),
  constraint couranr_dv_availability_chk
    check (availability_state in ('available','unavailable','on_delivery')),
  constraint couranr_dv_name_chk check (length(btrim(name)) > 0),
  constraint couranr_dv_payload_chk check (payload_capacity_lb > 0),
  constraint couranr_dv_dims_chk check (
    (cargo_length_in is null or cargo_length_in > 0) and
    (cargo_width_in  is null or cargo_width_in  > 0) and
    (cargo_height_in is null or cargo_height_in > 0)
  ),
  constraint couranr_dv_version_chk check (version >= 1)
);

comment on table public.couranr_dispatch_vehicles is
  'Canonical delivery vehicle. Separate from the quarantined auto-rental `vehicles` table, which has no payload capacity and is pinned by live rentals. Capability facts live HERE and are read server-side; a browser supplies an id and never a capability.';

-- ---------------------------------------------------------------------
-- 3. couranr_delivery_assignments
-- ---------------------------------------------------------------------
create table if not exists public.couranr_delivery_assignments (
  id                uuid primary key default gen_random_uuid(),
  delivery_id       uuid not null,
  driver_id         uuid not null,
  vehicle_id        uuid not null,

  assignment_state  text not null default 'active',
  assigned_by       uuid not null,
  assigned_at       timestamptz not null default now(),
  ended_at          timestamptz,
  end_reason        text,

  -- Makes a repeated assign request return the SAME row instead of creating a
  -- second one. Insert-first + `exception when unique_violation`, the shape the
  -- payment slice settled on.
  idempotency_key   text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  version           integer not null default 1,

  constraint couranr_asg_delivery_fk
    foreign key (delivery_id) references public.couranr_deliveries (id)
    on update cascade on delete restrict,
  constraint couranr_asg_driver_fk
    foreign key (driver_id) references public.couranr_drivers (id)
    on update cascade on delete restrict,
  constraint couranr_asg_vehicle_fk
    foreign key (vehicle_id) references public.couranr_dispatch_vehicles (id)
    on update cascade on delete restrict,
  constraint couranr_asg_assigned_by_fk
    foreign key (assigned_by) references auth.users (id)
    on update cascade on delete restrict,

  constraint couranr_asg_state_chk
    check (assignment_state in ('active','replaced','cancelled')),
  constraint couranr_asg_version_chk check (version >= 1),

  /*
   * ONE-DIRECTIONAL on purpose. The biconditional form
   *     (assignment_state = 'active') = (ended_at is null)
   * is the defect class this repo has already shipped twice — it makes a legal
   * transition impossible. This says only what must be true: an assignment that
   * is no longer active carries the time it ended.
   */
  constraint couranr_asg_ended_stamp_chk
    check (assignment_state = 'active' or ended_at is not null)
);

-- EXACTLY ONE active assignment per delivery. A partial unique index, so the
-- database refuses a second one even if a command forgets to check.
create unique index if not exists couranr_asg_one_active_per_delivery
  on public.couranr_delivery_assignments (delivery_id)
  where assignment_state = 'active';

-- At most one active assignment per driver for MVP. Route batching is an
-- explicit future decision; until it is made, this is the rule.
create unique index if not exists couranr_asg_one_active_per_driver
  on public.couranr_delivery_assignments (driver_id)
  where assignment_state = 'active';

create unique index if not exists couranr_asg_idempotency_uniq
  on public.couranr_delivery_assignments (idempotency_key)
  where idempotency_key is not null;

create index if not exists couranr_asg_delivery_idx
  on public.couranr_delivery_assignments (delivery_id);

comment on table public.couranr_delivery_assignments is
  'Which driver and vehicle Couranr committed to a scheduled delivery. Exactly one active row per delivery and per driver, enforced by partial unique indexes rather than by trust in the command layer.';

-- ---------------------------------------------------------------------
-- 4. couranr_assignment_events — append-only
-- ---------------------------------------------------------------------
create table if not exists public.couranr_assignment_events (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null,
  delivery_id    uuid not null,
  actor_user_id  uuid,
  actor_type     text not null,
  command        text not null,
  from_state     text,
  to_state       text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),

  constraint couranr_ae_assignment_fk
    foreign key (assignment_id) references public.couranr_delivery_assignments (id)
    on update cascade on delete restrict,
  constraint couranr_ae_delivery_fk
    foreign key (delivery_id) references public.couranr_deliveries (id)
    on update cascade on delete restrict,
  constraint couranr_ae_actor_type_chk
    check (actor_type in ('operations','driver','merchant','system')),
  constraint couranr_ae_metadata_is_object_chk
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists couranr_ae_delivery_idx
  on public.couranr_assignment_events (delivery_id, created_at);

comment on table public.couranr_assignment_events is
  'Append-only dispatch audit trail. Records the old and new driver/vehicle on every replacement, so a reassignment is reconstructable.';

-- ---------------------------------------------------------------------
-- 5. FK GUARDS on the two pre-existing vehicle_id columns.
--
--    Both were created WITHOUT a foreign key, with a comment saying a canonical
--    vehicle table could be referenced later. This is later. Both are 100% NULL
--    today (14/14 deliveries, 25/25 plans), so constraining them rewrites
--    nothing — and it makes it impossible to ever point them at the quarantined
--    auto-rental table.
--
--    Nothing in this slice WRITES either column. The assignment row is the
--    single source of truth for which vehicle is on a delivery; a second copy
--    would be a divergence waiting to happen.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'couranr_dlv_dispatch_vehicle_fk') then
    alter table public.couranr_deliveries
      add constraint couranr_dlv_dispatch_vehicle_fk
      foreign key (vehicle_id) references public.couranr_dispatch_vehicles (id)
      on update cascade on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'couranr_sp_dispatch_vehicle_fk') then
    alter table public.couranr_service_plans
      add constraint couranr_sp_dispatch_vehicle_fk
      foreign key (vehicle_id) references public.couranr_dispatch_vehicles (id)
      on update cascade on delete restrict;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 6. GRANTS AND RLS
--
--    `pg_default_acl` in this project grants arwdDxtm to anon, authenticated
--    AND service_role on every new table in public, which makes a bare additive
--    GRANT a silent no-op. The REVOKE first is load-bearing.
--
--    No DELETE to anyone, on any of the four tables — the same rule the request
--    and payment tables follow, so neither a bug nor a compromised command can
--    erase dispatch history.
-- ---------------------------------------------------------------------
alter table public.couranr_drivers               enable row level security;
alter table public.couranr_dispatch_vehicles     enable row level security;
alter table public.couranr_delivery_assignments  enable row level security;
alter table public.couranr_assignment_events     enable row level security;

revoke all on public.couranr_drivers               from public, anon, authenticated;
revoke all on public.couranr_dispatch_vehicles     from public, anon, authenticated;
revoke all on public.couranr_delivery_assignments  from public, anon, authenticated;
revoke all on public.couranr_assignment_events     from public, anon, authenticated;

revoke all on public.couranr_drivers               from service_role;
revoke all on public.couranr_dispatch_vehicles     from service_role;
revoke all on public.couranr_delivery_assignments  from service_role;
revoke all on public.couranr_assignment_events     from service_role;

grant select, insert, update on public.couranr_drivers              to service_role;
grant select, insert, update on public.couranr_dispatch_vehicles    to service_role;
grant select, insert, update on public.couranr_delivery_assignments to service_role;
grant select, insert         on public.couranr_assignment_events    to service_role;

-- ---------------------------------------------------------------------
-- 7. VEHICLE COMPATIBILITY
--
--    The service plan stores an IMMUTABLE requirement, shape
--    {"vehicleClass": "van", "maxPayloadLb": 800}. Compatibility is decided
--    HERE, from stored rows, never from anything a browser said.
--
--    Class substitution is upward only, by capability rank:
--        cargo_bike(1) < car(2) < van(3) < box_truck(4)
--    A van satisfies a requirement for a car; a car does not satisfy a van.
--    Payload capacity is checked separately and always.
-- ---------------------------------------------------------------------
create or replace function public.couranr_vehicle_class_rank(p_class text)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select case p_class
           when 'cargo_bike' then 1
           when 'car'        then 2
           when 'van'        then 3
           when 'box_truck'  then 4
           else 0
         end;
$fn$;

comment on function public.couranr_vehicle_class_rank is
  'Capability ordering for vehicle-class substitution. 0 for an unknown class, so an unknown NEVER satisfies a known requirement.';

/*
 * Returns NULL when the vehicle satisfies the requirement, or a stable reason
 * code when it does not. A reason code rather than a boolean because OPS-003
 * has to tell the operator WHY a vehicle is ineligible, and inventing that copy
 * in the browser would let the two disagree.
 */
create or replace function public.couranr_vehicle_incompatibility(
  p_vehicle_id  uuid,
  p_driver_id   uuid,
  p_requirement jsonb
)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_v public.couranr_dispatch_vehicles;
  v_req_class text := p_requirement ->> 'vehicleClass';
  v_req_lb    numeric := nullif(p_requirement ->> 'maxPayloadLb', '')::numeric;
begin
  select * into v_v from public.couranr_dispatch_vehicles where id = p_vehicle_id;
  if not found then
    return 'vehicle_not_found';
  end if;
  if not v_v.active then
    return 'vehicle_inactive';
  end if;
  if v_v.availability_state <> 'available' then
    return 'vehicle_unavailable';
  end if;
  if v_v.assigned_driver_id is not null and v_v.assigned_driver_id <> p_driver_id then
    return 'vehicle_assigned_to_another_driver';
  end if;
  if v_req_class is not null
     and public.couranr_vehicle_class_rank(v_v.vehicle_class)
         < public.couranr_vehicle_class_rank(v_req_class) then
    return 'vehicle_class_too_small';
  end if;
  if v_req_lb is not null and v_v.payload_capacity_lb < v_req_lb then
    return 'vehicle_payload_too_low';
  end if;
  return null;
end
$fn$;

comment on function public.couranr_vehicle_incompatibility is
  'NULL when the vehicle satisfies the service plan requirement, else a stable reason code. Read from stored rows only — the browser supplies identifiers, never capability facts.';

commit;
