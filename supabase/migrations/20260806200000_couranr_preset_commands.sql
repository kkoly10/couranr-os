-- ---------------------------------------------------------------------
-- ACP-025 — the named commands for merchant presets.
--
-- MER-010 allowed actions: "Create; edit; duplicate; archive; review
-- recommendation; view usage."
-- MER-011 allowed actions: "Edit; version; add required question; save;
-- duplicate."
--
-- Every one is a NAMED COMMAND with the actor verified, the current state
-- checked and the transition allow-listed. No route may hand this file a
-- target state.
--
-- ---------------------------------------------------------------------
-- WHO MAY MANAGE PRESETS — a bounded implementation decision
-- ---------------------------------------------------------------------
--
-- No authority assigns preset permissions. TRM-002 is conversations-only and
-- says so; DRP-001 covers request create/submit and says so. So this is the
-- same kind of bounded decision `lib/couranr/settings/permissions.ts` records
-- for settings, and it is made the same way: least privilege, modelled on the
-- decisions that DO exist.
--
-- OWNER and MANAGER, not dispatcher. A preset is configuration that shapes
-- what EVERY future delivery is prefilled with, for everyone in the business —
-- the same shape as `website_tools.publish`, where a dispatcher moves
-- deliveries but does not decide what the merchant's configuration says. A
-- dispatcher who spots a better default asks someone who can change it.
--
-- If that proves wrong in the pilot it is one CHECK and one matrix entry.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 1. Shared role gate
-- ---------------------------------------------------------------------
create or replace function public.couranr_require_preset_manager(
  p_business_account_id uuid,
  p_actor_user_id       uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_role text;
begin
  v_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);
  if v_role not in ('owner', 'manager') then
    raise exception 'role_may_not_manage_presets' using errcode = 'CR403';
  end if;
  return v_role;
end
$fn$;

-- ---------------------------------------------------------------------
-- 2. Create
-- ---------------------------------------------------------------------
--
-- One command for both hierarchy levels. A null source is a merchant-created
-- preset; a source id CUSTOMIZES a Couranr global one, and the global's
-- CURRENT version is read here rather than accepted from the caller — a
-- caller-supplied baseline could claim a merchant customized a version they
-- never saw, and every later "is there an update?" answer would be wrong.
create or replace function public.couranr_create_merchant_preset(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_name                text,
  p_body                jsonb,
  p_source_preset_id    uuid
)
returns public.couranr_merchant_presets
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_preset         public.couranr_merchant_presets;
  v_source_version integer;
begin
  perform public.couranr_require_preset_manager(p_business_account_id, p_actor_user_id);

  if p_name is null or btrim(p_name) = '' then
    raise exception 'preset_name_required' using errcode = 'CR400';
  end if;

  if p_source_preset_id is not null then
    select version into v_source_version
      from public.couranr_category_presets
     where id = p_source_preset_id and archived_at is null;
    if not found then
      raise exception 'source_preset_not_found' using errcode = 'CR404';
    end if;
  end if;

  insert into public.couranr_merchant_presets
    (business_account_id, name, body, source_category_preset_id, source_version, created_by)
  values
    (p_business_account_id, btrim(p_name), coalesce(p_body, '{}'::jsonb),
     p_source_preset_id, v_source_version, p_actor_user_id)
  returning * into v_preset;

  -- Version 1 is recorded like every other version. A preset whose first
  -- version is missing from the history has a hole exactly where a delivery
  -- created on day one would point.
  insert into public.couranr_merchant_preset_versions
    (merchant_preset_id, version, name, body, changed_by)
  values (v_preset.id, 1, v_preset.name, v_preset.body, p_actor_user_id);

  return v_preset;
end
$fn$;

-- ---------------------------------------------------------------------
-- 3. Update — optimistic concurrency
-- ---------------------------------------------------------------------
--
-- MER-011's "version conflict" state. `p_expected_version` is the version the
-- editor LOADED; if the stored one has moved, the save is refused rather than
-- overwriting a colleague's work with a body built from a version that no
-- longer exists.
create or replace function public.couranr_update_merchant_preset(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_preset_id           uuid,
  p_name                text,
  p_body                jsonb,
  p_expected_version    integer
)
returns public.couranr_merchant_presets
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_preset public.couranr_merchant_presets;
begin
  perform public.couranr_require_preset_manager(p_business_account_id, p_actor_user_id);

  -- Locked before the version is compared. Without the lock two saves could
  -- both read version 3, both find it matching, and both write version 4 —
  -- the check would pass twice and the second would still clobber the first.
  select * into v_preset
    from public.couranr_merchant_presets
   where id = p_preset_id and business_account_id = p_business_account_id
   for update;

  if not found then
    raise exception 'preset_not_found' using errcode = 'CR404';
  end if;
  if v_preset.archived_at is not null then
    raise exception 'preset_is_archived' using errcode = 'CR409';
  end if;
  if p_expected_version is null or p_expected_version <> v_preset.version then
    raise exception 'preset_version_conflict' using errcode = 'CR409';
  end if;

  update public.couranr_merchant_presets
     set name       = coalesce(nullif(btrim(p_name), ''), name),
         body       = coalesce(p_body, body),
         version    = version + 1,
         updated_at = now()
   where id = p_preset_id
  returning * into v_preset;

  insert into public.couranr_merchant_preset_versions
    (merchant_preset_id, version, name, body, changed_by)
  values (v_preset.id, v_preset.version, v_preset.name, v_preset.body, p_actor_user_id);

  return v_preset;
end
$fn$;

-- ---------------------------------------------------------------------
-- 4. Adopt a Couranr recommendation
-- ---------------------------------------------------------------------
--
-- THE ONLY WAY a global update ever reaches a merchant preset, and it is the
-- merchant asking for it. §5: "Global updates never overwrite merchant
-- customization." Nothing in this schema updates a merchant row from a global
-- one except this command, called deliberately.
--
-- The merchant's own version still advances and the OLD body is still in the
-- history, so adopting is undoable by looking at what version they were on.
create or replace function public.couranr_adopt_preset_recommendation(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_preset_id           uuid,
  p_expected_version    integer
)
returns public.couranr_merchant_presets
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_preset public.couranr_merchant_presets;
  v_source public.couranr_category_presets;
begin
  perform public.couranr_require_preset_manager(p_business_account_id, p_actor_user_id);

  select * into v_preset
    from public.couranr_merchant_presets
   where id = p_preset_id and business_account_id = p_business_account_id
   for update;
  if not found then
    raise exception 'preset_not_found' using errcode = 'CR404';
  end if;
  if v_preset.source_category_preset_id is null then
    raise exception 'preset_has_no_couranr_source' using errcode = 'CR409';
  end if;
  if p_expected_version is null or p_expected_version <> v_preset.version then
    raise exception 'preset_version_conflict' using errcode = 'CR409';
  end if;

  select * into v_source
    from public.couranr_category_presets
   where id = v_preset.source_category_preset_id;
  if not found then
    raise exception 'source_preset_not_found' using errcode = 'CR404';
  end if;

  -- Nothing to adopt is a CONFLICT, not a silent success: a caller that
  -- believed there was an update has a stale view, and telling it "done"
  -- would leave a merchant thinking they took an update that never existed.
  if v_source.version <= coalesce(v_preset.source_version, 0) then
    raise exception 'no_recommendation_to_adopt' using errcode = 'CR409';
  end if;

  update public.couranr_merchant_presets
     set body           = v_source.body,
         source_version = v_source.version,
         version        = version + 1,
         updated_at     = now()
   where id = p_preset_id
  returning * into v_preset;

  insert into public.couranr_merchant_preset_versions
    (merchant_preset_id, version, name, body, changed_by)
  values (v_preset.id, v_preset.version, v_preset.name, v_preset.body, p_actor_user_id);

  return v_preset;
end
$fn$;

-- ---------------------------------------------------------------------
-- 5. Duplicate
-- ---------------------------------------------------------------------
--
-- A copy is always MERCHANT-CREATED, even when copied from a customization.
-- Carrying the source across would give two presets one baseline, and
-- adopting an update on one would silently make the other look stale.
create or replace function public.couranr_duplicate_merchant_preset(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_preset_id           uuid,
  p_new_name            text
)
returns public.couranr_merchant_presets
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_source public.couranr_merchant_presets;
  v_copy   public.couranr_merchant_presets;
begin
  perform public.couranr_require_preset_manager(p_business_account_id, p_actor_user_id);

  select * into v_source
    from public.couranr_merchant_presets
   where id = p_preset_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'preset_not_found' using errcode = 'CR404';
  end if;
  if p_new_name is null or btrim(p_new_name) = '' then
    raise exception 'preset_name_required' using errcode = 'CR400';
  end if;

  insert into public.couranr_merchant_presets
    (business_account_id, name, body, created_by)
  values (p_business_account_id, btrim(p_new_name), v_source.body, p_actor_user_id)
  returning * into v_copy;

  insert into public.couranr_merchant_preset_versions
    (merchant_preset_id, version, name, body, changed_by)
  values (v_copy.id, 1, v_copy.name, v_copy.body, p_actor_user_id);

  return v_copy;
end
$fn$;

-- ---------------------------------------------------------------------
-- 6. Archive and restore
-- ---------------------------------------------------------------------
--
-- ARCHIVE, NEVER DELETE. Deliveries cite presets, and a deleted preset would
-- leave those citations pointing at nothing. The FK is `on delete restrict`
-- as well, so the database refuses even if a future caller tries.
create or replace function public.couranr_set_merchant_preset_archived(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_preset_id           uuid,
  p_archived            boolean
)
returns public.couranr_merchant_presets
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_preset public.couranr_merchant_presets;
begin
  perform public.couranr_require_preset_manager(p_business_account_id, p_actor_user_id);

  update public.couranr_merchant_presets
     set archived_at = case when p_archived then now() else null end,
         updated_at  = now()
   where id = p_preset_id and business_account_id = p_business_account_id
  returning * into v_preset;

  if not found then
    raise exception 'preset_not_found' using errcode = 'CR404';
  end if;
  return v_preset;
end
$fn$;

-- ---------------------------------------------------------------------
-- 7. Execution grants
-- ---------------------------------------------------------------------
-- `public` NAMED, and service_role revoked before being granted back —
-- `pg_default_acl` grants EXECUTE to PUBLIC on every new function here, so a
-- revoke that omits it changes nothing at all.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.couranr_require_preset_manager(uuid, uuid)',
    'public.couranr_create_merchant_preset(uuid, uuid, text, jsonb, uuid)',
    'public.couranr_update_merchant_preset(uuid, uuid, uuid, text, jsonb, integer)',
    'public.couranr_adopt_preset_recommendation(uuid, uuid, uuid, integer)',
    'public.couranr_duplicate_merchant_preset(uuid, uuid, uuid, text)',
    'public.couranr_set_merchant_preset_archived(uuid, uuid, uuid, boolean)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
