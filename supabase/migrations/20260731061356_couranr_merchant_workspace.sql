-- =====================================================================
-- Couranr merchant workspace onboarding — ADDITIVE MIGRATION
--
-- Creates:
--   public.couranr_merchant_workspaces      (new table)
--   public.couranr_create_merchant_workspace(...)  (new function)
--
-- WHY. Commit H's merchant flow needs a business account and an active owner
-- membership to exist. Creating those by hand in production is exactly what
-- this is meant to remove. The function creates the business account, the
-- owner membership and the workspace profile in ONE transaction, so a merchant
-- can never end up with an account they are not a member of.
--
-- ADDITIVE ONLY. `business_accounts` and `business_members` are INSERTED into
-- but never altered: no column is added, no constraint changed, no policy or
-- grant touched, no existing row read or written.
--
-- The new table exists because the onboarding fields have nowhere to live:
-- `business_accounts` has no category, no pickup address, no payer default and
-- no idempotency key, and altering it is out of scope.
--
-- SECURITY POSTURE — same as the other Couranr objects:
--   * RLS enabled, no policies, so deny-all for every non-bypassing role
--   * all privileges revoked from PUBLIC, anon and authenticated
--   * service_role revoked then granted exactly SELECT, INSERT, UPDATE
--     (pg_default_acl grants ALL, so a narrow grant alone is a no-op)
--   * the function is SECURITY INVOKER with search_path = '' and EXECUTE
--     granted only to service_role
--
-- ERROR CODES (the unused 'CR' class):
--   CR403  the signed-in user may not own a merchant workspace
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- HARD GUARD.
-- ---------------------------------------------------------------------
do $guard$
begin
  if to_regclass('public.couranr_merchant_workspaces') is not null then
    raise exception
      'couranr_merchant_workspaces already exists. Refusing to run: its shape has not been verified.';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'couranr_create_merchant_workspace'
  ) then
    raise exception
      'couranr_create_merchant_workspace already exists. Refusing to run.';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- 1. The workspace profile
-- ---------------------------------------------------------------------
create table public.couranr_merchant_workspaces (
  id                   uuid primary key default gen_random_uuid(),
  business_account_id  uuid not null,
  created_by           uuid not null,
  idempotency_key      text not null,

  -- Master Package §"Merchant selects one primary category". Secondary
  -- categories are specified but deliberately not collected by this slice.
  business_category    text not null,
  pickup_address       jsonb not null,
  contact_phone        text not null,
  payer_default        text not null,

  policies_accepted_at timestamptz not null,
  policies_version     text not null,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- One workspace per business account, and one per onboarding attempt.
  constraint couranr_mw_account_uniq unique (business_account_id),
  constraint couranr_mw_idempotency_uniq unique (created_by, idempotency_key),

  constraint couranr_mw_account_fk
    foreign key (business_account_id) references public.business_accounts (id)
    on update cascade on delete restrict,
  constraint couranr_mw_created_by_fk
    foreign key (created_by) references auth.users (id)
    on update cascade on delete restrict,

  -- Verbatim from the Master Package merchant category registry. No category
  -- is invented here, and the list controls recommendations, not eligibility.
  constraint couranr_mw_category_chk check (business_category in (
    'dry_cleaning_laundry_tailoring',
    'printing_signage_promotional',
    'boutique_clothing_shoes_accessories',
    'florists_gifts_specialty_retail',
    'repair_and_electronics',
    'auto_parts_and_accessories',
    'furniture_and_home_goods',
    'event_rentals_and_supplies',
    'bakeries_prepared_food_catering',
    'books_cards_collectibles_hobby',
    'general_local_business')),

  constraint couranr_mw_payer_default_chk check (payer_default in ('merchant','customer')),
  constraint couranr_mw_pickup_is_object_chk check (jsonb_typeof(pickup_address) = 'object'),
  constraint couranr_mw_phone_present_chk check (length(btrim(contact_phone)) > 0),
  constraint couranr_mw_policies_version_chk check (length(btrim(policies_version)) > 0)
);

comment on table public.couranr_merchant_workspaces is
  'Canonical merchant workspace profile captured at onboarding. Lightweight by design: no Stripe setup, no logo, no team invitations. One row per business account.';

create index couranr_mw_created_by_idx on public.couranr_merchant_workspaces (created_by);

alter table public.couranr_merchant_workspaces enable row level security;

revoke all on public.couranr_merchant_workspaces from public, anon, authenticated;
revoke all on public.couranr_merchant_workspaces from service_role;
grant select, insert, update on public.couranr_merchant_workspaces to service_role;

-- ---------------------------------------------------------------------
-- 2. Atomic workspace creation
-- ---------------------------------------------------------------------
create function public.couranr_create_merchant_workspace(
  p_owner_user_id    uuid,
  p_idempotency_key  text,
  p_name             text,
  p_slug_base        text,
  p_business_category text,
  p_pickup_address   jsonb,
  p_contact_phone    text,
  p_payer_default    text,
  p_policies_version text
)
returns public.couranr_merchant_workspaces
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_ws      public.couranr_merchant_workspaces;
  v_account uuid;
  v_base    text;
  v_slug    text;
  v_role    text;
  i         integer;
begin
  -- Serialize concurrent attempts that share an idempotency key, so the
  -- check-then-insert below cannot create two business accounts for one
  -- onboarding. Released at the end of the transaction.
  perform pg_advisory_xact_lock(
    hashtextextended(p_owner_user_id::text || ':' || coalesce(p_idempotency_key, ''), 0));

  -- Idempotent retry: the same attempt returns the same workspace, and creates
  -- no second business account.
  select * into v_ws
  from public.couranr_merchant_workspaces
  where created_by = p_owner_user_id and idempotency_key = p_idempotency_key;
  if found then
    return v_ws;
  end if;

  -- A Couranr Operations user must never become a merchant owner by walking
  -- through onboarding. Enforced here as well as in the TypeScript command, so
  -- a future caller cannot bypass it.
  select role into v_role from public.profiles where id = p_owner_user_id;
  if v_role in ('admin', 'operations') then
    raise exception 'operations_user_may_not_own_a_workspace' using errcode = 'CR403';
  end if;

  -- Slug: normalized defensively here as well as in the caller, then tried
  -- against the unique index rather than checked first, so a concurrent signup
  -- cannot take the name between the check and the insert.
  v_base := lower(regexp_replace(coalesce(p_slug_base, ''), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := btrim(v_base, '-');
  v_base := left(v_base, 40);
  v_base := btrim(v_base, '-');
  if v_base = '' then
    v_base := 'business';
  end if;

  for i in 0..9 loop
    begin
      v_slug := case when i = 0 then v_base else v_base || '-' || (i + 1)::text end;
      insert into public.business_accounts (name, slug, status, created_by)
      values (p_name, v_slug, 'trial', p_owner_user_id)
      returning id into v_account;
      exit;
    exception when unique_violation then
      v_account := null;
    end;
  end loop;

  if v_account is null then
    -- Ten collisions. Fall back to a suffix that cannot collide.
    v_slug := v_base || '-' || left(replace(gen_random_uuid()::text, '-', ''), 8);
    insert into public.business_accounts (name, slug, status, created_by)
    values (p_name, v_slug, 'trial', p_owner_user_id)
    returning id into v_account;
  end if;

  -- The creator is the owner, active immediately. `p_owner_user_id` is the
  -- authenticated caller resolved server-side; there is no parameter for a
  -- client to name a different owner.
  insert into public.business_members
    (business_account_id, user_id, role, status, joined_at)
  values (v_account, p_owner_user_id, 'owner', 'active', now());

  insert into public.couranr_merchant_workspaces (
    business_account_id, created_by, idempotency_key,
    business_category, pickup_address, contact_phone, payer_default,
    policies_accepted_at, policies_version
  ) values (
    v_account, p_owner_user_id, p_idempotency_key,
    p_business_category, p_pickup_address, p_contact_phone, p_payer_default,
    now(), p_policies_version
  )
  returning * into v_ws;

  return v_ws;
end
$fn$;

comment on function public.couranr_create_merchant_workspace is
  'Atomic: creates a business account, an active owner membership and the merchant workspace profile in one transaction. SECURITY INVOKER, service_role only. Idempotent on (created_by, idempotency_key).';

revoke all on function public.couranr_create_merchant_workspace(
  uuid, text, text, text, text, jsonb, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.couranr_create_merchant_workspace(
  uuid, text, text, text, text, jsonb, text, text, text
) to service_role;

commit;
