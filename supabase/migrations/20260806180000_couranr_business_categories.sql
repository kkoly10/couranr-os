-- ---------------------------------------------------------------------
-- ACP-024 — one primary category and up to three secondary categories.
--
-- AUTHORITY: `02_DECISION_REGISTRY.json` has NO decision about categories —
-- all 43 records scanned. The authority is rank 2, Master Package §5:
--   "Merchant selects one primary category and up to three secondary
--    categories."
--   "Category controls initial recommendations, not eligibility."
--
-- The second sentence is why NOTHING in this file gates anything on a
-- category. These columns are read to decide what a merchant is SHOWN. No
-- policy, no grant and no command anywhere may branch on them to decide what a
-- merchant is ALLOWED to do.
--
-- ADDITIVE ONLY. `business_category` keeps its meaning and its CHECK; this
-- adds the secondary list beside it and stamps the registry version a
-- selection was made under. Existing rows get an empty array and a null
-- version, which reads correctly as "chosen before categories were versioned"
-- rather than as a merchant's choice.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. An IMMUTABLE helper so distinctness can live in a CHECK
-- ---------------------------------------------------------------------
--
-- A CHECK constraint cannot contain a subquery, and PostgreSQL has no builtin
-- "this array has no duplicates". A function CAN be used in a CHECK provided
-- it is IMMUTABLE — this one touches no table and no setting, so it genuinely
-- is. The alternative was enumerating index pairs by hand, which is correct
-- only for the current maximum of three and silently wrong the day that
-- changes.
create or replace function public.couranr_text_array_is_distinct(p_values text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select p_values is null
      or cardinality(p_values) = (select count(distinct v) from unnest(p_values) as v);
$fn$;

comment on function public.couranr_text_array_is_distinct(text[]) is
  'True when the array holds no duplicate values. IMMUTABLE and table-free so it is legal inside a CHECK constraint.';

-- ---------------------------------------------------------------------
-- 2. The columns
-- ---------------------------------------------------------------------
alter table public.couranr_merchant_workspaces
  add column if not exists secondary_categories text[] not null default '{}';

alter table public.couranr_merchant_workspaces
  add column if not exists category_registry_version text;

comment on column public.couranr_merchant_workspaces.secondary_categories is
  'Up to three additional categories (Master Package section 5). Recommendation only: nothing may gate a capability on these.';
comment on column public.couranr_merchant_workspaces.category_registry_version is
  'The category-registry edition this selection was made under. Null for workspaces created before categories were versioned - which is not the same as a merchant having chosen nothing.';

-- ---------------------------------------------------------------------
-- 3. The constraints
-- ---------------------------------------------------------------------
-- Every rule the TypeScript validator enforces is enforced here too. The
-- validator is what produces good copy for a merchant; this is what makes the
-- rule true regardless of which caller wrote the row.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'couranr_mw_secondary_count_chk') then
    alter table public.couranr_merchant_workspaces
      add constraint couranr_mw_secondary_count_chk
      check (cardinality(secondary_categories) <= 3);
  end if;

  -- The same eleven values `couranr_mw_category_chk` permits for the primary.
  if not exists (select 1 from pg_constraint where conname = 'couranr_mw_secondary_values_chk') then
    alter table public.couranr_merchant_workspaces
      add constraint couranr_mw_secondary_values_chk
      check (secondary_categories <@ array[
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
        'general_local_business']::text[]);
  end if;

  -- A secondary that repeats the primary means the merchant believes they
  -- selected two things and selected one.
  if not exists (select 1 from pg_constraint where conname = 'couranr_mw_secondary_not_primary_chk') then
    alter table public.couranr_merchant_workspaces
      add constraint couranr_mw_secondary_not_primary_chk
      check (not (business_category = any(secondary_categories)));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'couranr_mw_secondary_distinct_chk') then
    alter table public.couranr_merchant_workspaces
      add constraint couranr_mw_secondary_distinct_chk
      check (public.couranr_text_array_is_distinct(secondary_categories));
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- 4. The named command
-- ---------------------------------------------------------------------
--
-- A SEPARATE command rather than more parameters on
-- `couranr_create_merchant_workspace`. `create or replace function` cannot
-- change an argument list — it would mint a second OVERLOAD, leaving two
-- functions with the same name where a caller could reach either. Changing
-- the signature would mean dropping the existing function, and this is a
-- command family that onboarding depends on.
--
-- It is also the better shape: categories are edited long after onboarding,
-- from MER-014 settings, so they need their own audited command anyway.
create or replace function public.couranr_set_business_categories(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_primary             text,
  p_secondary           text[],
  p_registry_version    text
)
returns public.couranr_merchant_workspaces
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_ws         public.couranr_merchant_workspaces;
  v_secondary  text[];
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  -- Mirrors `settings.write` in lib/couranr/settings/permissions.ts. Enforced
  -- in both places deliberately: the matrix is what the UI reads, this is what
  -- the database refuses.
  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_change_settings' using errcode = 'CR403';
  end if;

  if p_primary is null or btrim(p_primary) = '' then
    raise exception 'primary_category_required' using errcode = 'CR400';
  end if;

  -- Duplicates are STRIPPED, not refused: ticking a box twice meant ticking it
  -- once. The order the merchant chose is preserved.
  select coalesce(array_agg(distinct_value order by first_seen), '{}')
    into v_secondary
  from (
    select value as distinct_value, min(ordinality) as first_seen
      from unnest(coalesce(p_secondary, '{}'::text[])) with ordinality as t(value, ordinality)
     group by value
  ) deduped;

  if cardinality(v_secondary) > 3 then
    raise exception 'too_many_secondary_categories' using errcode = 'CR400';
  end if;

  -- A secondary equal to the primary is REFUSED rather than stripped, because
  -- stripping would silently give the merchant one category where they believe
  -- they have two.
  if p_primary = any(v_secondary) then
    raise exception 'secondary_category_repeats_primary' using errcode = 'CR400';
  end if;

  update public.couranr_merchant_workspaces
     set business_category         = p_primary,
         secondary_categories      = v_secondary,
         category_registry_version = coalesce(nullif(btrim(p_registry_version), ''),
                                              category_registry_version),
         updated_at                = now()
   where business_account_id = p_business_account_id
  returning * into v_ws;

  if not found then
    raise exception 'workspace_not_found' using errcode = 'CR404';
  end if;

  return v_ws;
end
$fn$;

comment on function public.couranr_set_business_categories(uuid, uuid, text, text[], text) is
  'Sets a workspace primary category and up to three secondary categories. Owner/manager only. Duplicates are stripped; a secondary equal to the primary is refused. Recommendation only - nothing may gate a capability on these values. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 5. Execution grants
-- ---------------------------------------------------------------------
-- Same posture as every other command family. `public` is named explicitly:
-- `pg_default_acl` on this project grants EXECUTE to PUBLIC on every new
-- function in `public`, so revoking from anon and authenticated alone is a
-- silent no-op — they keep the privilege they inherit through PUBLIC.
revoke all on function public.couranr_set_business_categories(uuid, uuid, text, text[], text)
  from public, anon, authenticated;
grant execute on function public.couranr_set_business_categories(uuid, uuid, text, text[], text)
  to service_role;

-- The helper is a pure array predicate with no privileged reach, but it gets
-- the same treatment: nothing in `public` should be callable from a browser
-- unless it was meant to be.
--
-- `public` IS NAMED. Revoking from anon and authenticated alone would be the
-- silent no-op this codebase has been bitten by — they keep the privilege they
-- inherit through PUBLIC, and the revoke reads as protection while changing
-- nothing.
--
-- Revoking from PUBLIC also removes service_role's inherited EXECUTE, and this
-- function is called from a CHECK constraint on every workspace write, so
-- service_role is granted it back explicitly. That the constraint still fires
-- and still permits a legitimate write afterwards is MEASURED on the
-- disposable stack, not assumed — a CHECK that silently stopped being
-- evaluated would look exactly like a passing test.
revoke all on function public.couranr_text_array_is_distinct(text[])
  from public, anon, authenticated;
grant execute on function public.couranr_text_array_is_distinct(text[]) to service_role;
