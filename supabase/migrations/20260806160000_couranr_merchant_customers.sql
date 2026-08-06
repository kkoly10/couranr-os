-- =====================================================================
-- MER-008 / MER-009 — merchant customer records
--
-- ADDITIVE ONLY: two new tables and their commands. Drops nothing, alters no
-- existing column, deletes no row.
--
-- Table names are NOT invented: `merchant_customers` and `customer_addresses`
-- are the names the canonical data model uses
-- (01_MASTER_IMPLEMENTATION_SPEC.md §14).
--
-- ---------------------------------------------------------------------
-- WHY THESE TABLES EXIST WHEN THE DATA IS ALREADY IN THE REQUESTS
-- ---------------------------------------------------------------------
--
-- A customer list can be DERIVED from `couranr_delivery_requests` by grouping
-- recipients — and the screen does exactly that for delivery history. But two
-- of the registry's four required states cannot come from a derivation:
--
--   * ARCHIVED needs somewhere to record that a merchant archived someone.
--   * A customer with NO DELIVERIES cannot exist in a table of deliveries.
--
-- Shipping only the derived half would have left both states permanently
-- unreachable, which is a narrower screen than the registry specifies.
--
-- ---------------------------------------------------------------------
-- WHY ARCHIVE IS A TIMESTAMP AND NOT A DELETE
-- ---------------------------------------------------------------------
--
-- `archived_at` is stamped; the row stays. The canonical tables are
-- append-only by design — `service_role` holds DELETE on no `couranr_*` table
-- in production — and a customer's delivery history is the merchant's own
-- record. Archiving hides someone from the working list; it does not destroy
-- what they ordered.
--
-- ---------------------------------------------------------------------
-- WHY THE ADDRESS TABLE CARRIES A TENANT COLUMN
-- ---------------------------------------------------------------------
--
-- `customer_addresses.business_account_id` is denormalized from its parent on
-- purpose: every query in this system scopes by tenant, and a child table that
-- could only be scoped through a join is one forgotten join away from
-- cross-tenant exposure. The FK pair below makes the denormalized value
-- impossible to set wrong.
--
-- Error vocabulary: CR400 bad input, CR403 not permitted, CR404 not found,
-- CR409 conflicting state.
-- =====================================================================

-- HARD GUARD. `create table if not exists` would silently accept a table of a
-- DIFFERENT shape that happens to share the name, and every later assumption
-- about its columns would be wrong. Same posture as 20260731045417.
do $$
begin
  if to_regclass('public.merchant_customers') is not null then
    raise exception 'merchant_customers already exists - inspect before migrating';
  end if;
  if to_regclass('public.customer_addresses') is not null then
    raise exception 'customer_addresses already exists - inspect before migrating';
  end if;
end
$$;

create table public.merchant_customers (
  id                  uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  created_by          uuid,

  display_name        text not null,
  email               text,
  phone               text,

  -- Written by the command from the same normalizers the TypeScript uses, so
  -- duplicate detection asks the database the same question the screen does.
  normalized_email    text,
  normalized_phone    text,

  /*
   * PAY-001 is decided: "either the merchant or the customer may pay for any
   * delivery; onboarding captures a default only." So this is a PREFERENCE
   * that may pre-select, never a lock — null means "no preference recorded",
   * and both options remain available on every delivery regardless.
   */
  payer_preference    text,

  /*
   * Merchant-scoped. The registry is explicit that customer notes belong to
   * the merchant and that Couranr must not imply it owns the relationship, so
   * nothing in the Couranr Operations surface reads this column.
   */
  notes               text,

  archived_at         timestamptz,
  version             integer not null default 1,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint couranr_mc_name_chk check (length(btrim(display_name)) between 1 and 120),
  constraint couranr_mc_payer_chk check (
    payer_preference is null or payer_preference in ('merchant', 'customer')),
  constraint couranr_mc_version_chk check (version >= 1),
  -- A record with no way to reach the person is not a customer record.
  constraint couranr_mc_contactable_chk check (
    normalized_email is not null or normalized_phone is not null),

  constraint couranr_mc_business_id_key unique (business_account_id, id)
);

comment on table public.merchant_customers is
  'MER-008/MER-009 merchant-owned customer records. Archived by timestamp, never deleted.';

-- One customer per contact point per business. Partial, so archived records do
-- not block re-creating a customer the merchant archived earlier.
create unique index couranr_mc_email_uniq
  on public.merchant_customers (business_account_id, normalized_email)
  where normalized_email is not null and archived_at is null;

create unique index couranr_mc_phone_uniq
  on public.merchant_customers (business_account_id, normalized_phone)
  where normalized_phone is not null and archived_at is null;

create index couranr_mc_business_idx
  on public.merchant_customers (business_account_id, archived_at, created_at desc);

create table public.customer_addresses (
  id                  uuid primary key default gen_random_uuid(),
  merchant_customer_id uuid not null,
  business_account_id uuid not null,

  label               text,
  address             jsonb not null,
  instructions        text,
  archived_at         timestamptz,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  -- The composite FK is what makes the denormalized tenant column safe: an
  -- address can only name a business its customer actually belongs to.
  constraint couranr_ca_customer_fkey
    foreign key (business_account_id, merchant_customer_id)
    references public.merchant_customers (business_account_id, id) on delete cascade,

  -- An address must at least say where it is. The same four fields the
  -- application's normalizer requires.
  constraint couranr_ca_address_shape_chk check (
    address ? 'line1' and address ? 'city' and address ? 'region' and address ? 'postalCode')
);

comment on table public.customer_addresses is
  'Saved destinations for a merchant customer. Tenant column is denormalized and FK-constrained.';

create index couranr_ca_customer_idx
  on public.customer_addresses (merchant_customer_id, archived_at);

alter table public.merchant_customers enable row level security;
alter table public.customer_addresses enable row level security;

-- RLS on with no policy is deny-all to anon and authenticated whatever
-- pg_default_acl granted; the grant is then narrowed to service_role. `public`
-- is named because a privilege held through PUBLIC is inherited by every role.
revoke all on public.merchant_customers from public, anon, authenticated;
revoke all on public.merchant_customers from service_role;
grant select, insert, update on public.merchant_customers to service_role;

revoke all on public.customer_addresses from public, anon, authenticated;
revoke all on public.customer_addresses from service_role;
grant select, insert, update on public.customer_addresses to service_role;

-- ---------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------

/*
 * Create a customer.
 *
 * The caller passes both raw and normalized contact values; normalization
 * happens in ONE place (lib/couranr/customers/identity.ts) so the database and
 * the duplicate warning on screen can never disagree about who matches whom.
 */
create or replace function public.couranr_create_merchant_customer(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_display_name        text,
  p_email               text,
  p_phone               text,
  p_normalized_email    text,
  p_normalized_phone    text,
  p_payer_preference    text,
  p_notes               text
)
returns public.merchant_customers
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_customer   public.merchant_customers;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager', 'dispatcher') then
    raise exception 'role_may_not_manage_customers' using errcode = 'CR403';
  end if;

  if p_normalized_email is null and p_normalized_phone is null then
    raise exception 'customer_needs_an_email_or_phone' using errcode = 'CR400';
  end if;

  insert into public.merchant_customers
    (business_account_id, created_by, display_name, email, phone,
     normalized_email, normalized_phone, payer_preference, notes)
  values
    (p_business_account_id, p_actor_user_id, btrim(p_display_name), p_email, p_phone,
     p_normalized_email, p_normalized_phone, p_payer_preference, p_notes)
  returning * into v_customer;

  return v_customer;
end
$fn$;

/*
 * Update a customer. Version-checked, like every other Couranr mutation, so a
 * stale tab cannot overwrite a newer edit.
 */
create or replace function public.couranr_update_merchant_customer(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_customer_id         uuid,
  p_expected_version    integer,
  p_display_name        text,
  p_email               text,
  p_phone               text,
  p_normalized_email    text,
  p_normalized_phone    text,
  p_payer_preference    text,
  p_notes               text
)
returns public.merchant_customers
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_customer   public.merchant_customers;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager', 'dispatcher') then
    raise exception 'role_may_not_manage_customers' using errcode = 'CR403';
  end if;

  if p_normalized_email is null and p_normalized_phone is null then
    raise exception 'customer_needs_an_email_or_phone' using errcode = 'CR400';
  end if;

  update public.merchant_customers set
    display_name     = btrim(p_display_name),
    email            = p_email,
    phone            = p_phone,
    normalized_email = p_normalized_email,
    normalized_phone = p_normalized_phone,
    payer_preference = p_payer_preference,
    notes            = p_notes,
    version          = p_expected_version + 1,
    updated_at       = now()
  where id                  = p_customer_id
    and business_account_id = p_business_account_id
    and version             = p_expected_version
  returning * into v_customer;

  if not found then
    -- Either the row is gone, belongs to another business, or someone else
    -- edited it first. All three are the caller's cue to reload.
    raise exception 'customer_version_conflict' using errcode = 'CR409';
  end if;

  return v_customer;
end
$fn$;

/*
 * Archive and restore.
 *
 * `p_archived` selects which transition to perform; it is not written as a
 * caller-supplied column value — the function stamps `now()` or nulls the
 * stamp itself, so there is no path by which a caller could set an arbitrary
 * archive time.
 */
create or replace function public.couranr_set_customer_archived(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_customer_id         uuid,
  p_archived            boolean
)
returns public.merchant_customers
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_customer   public.merchant_customers;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager', 'dispatcher') then
    raise exception 'role_may_not_manage_customers' using errcode = 'CR403';
  end if;

  update public.merchant_customers set
    archived_at = case when p_archived then now() else null end,
    version     = version + 1,
    updated_at  = now()
  where id                  = p_customer_id
    and business_account_id = p_business_account_id
  returning * into v_customer;

  if not found then
    raise exception 'customer_not_found' using errcode = 'CR404';
  end if;

  return v_customer;
end
$fn$;

/* Save a destination against a customer. */
create or replace function public.couranr_add_customer_address(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_customer_id         uuid,
  p_label               text,
  p_address             jsonb,
  p_instructions        text
)
returns public.customer_addresses
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_address    public.customer_addresses;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager', 'dispatcher') then
    raise exception 'role_may_not_manage_customers' using errcode = 'CR403';
  end if;

  -- The composite FK below would refuse a customer from another business, but
  -- checking here turns that into a clean CR404 instead of a raw FK violation.
  perform 1 from public.merchant_customers
   where id = p_customer_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'customer_not_found' using errcode = 'CR404';
  end if;

  insert into public.customer_addresses
    (merchant_customer_id, business_account_id, label, address, instructions)
  values
    (p_customer_id, p_business_account_id, p_label, p_address, p_instructions)
  returning * into v_address;

  return v_address;
end
$fn$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.couranr_create_merchant_customer(uuid, uuid, text, text, text, text, text, text, text)',
    'public.couranr_update_merchant_customer(uuid, uuid, uuid, integer, text, text, text, text, text, text, text)',
    'public.couranr_set_customer_archived(uuid, uuid, uuid, boolean)',
    'public.couranr_add_customer_address(uuid, uuid, uuid, text, jsonb, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('revoke all on function %s from service_role', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
