-- =====================================================================
-- MER-013 — website tool configuration
--
-- ADDITIVE ONLY: one new table and one command. Drops nothing, alters no
-- existing column, deletes no row.
--
-- ---------------------------------------------------------------------
-- WHY A STATUS COLUMN AND NOT A FEATURE FLAG
-- ---------------------------------------------------------------------
--
-- FLG-002 — the feature-flag storage mechanism — is UNRESOLVED in the decision
-- registry. Building a flag system to hold "is this merchant's link live"
-- would be inventing the answer to an open decision. A status column on the
-- merchant's own config row is not a flag system: it is one merchant's setting
-- about one merchant's link, which is what MER-013 is for.
--
-- ---------------------------------------------------------------------
-- WHY `published` DOES NOT MEAN "LIVE"
-- ---------------------------------------------------------------------
--
-- `/request/[merchantSlug]` does not exist — it is PUB-004's contract. So a
-- merchant may PREPARE and publish their link, but the application must never
-- tell them it resolves. The screen derives that from
-- HOSTED_REQUEST_ROUTE_EXISTS in lib/couranr/settings/websiteTools.ts, and a
-- test pins that constant to the filesystem. Nothing in this migration claims
-- otherwise: `published` records the merchant's intent, not a live URL.
--
-- Error vocabulary: CR400 bad input, CR403 not permitted, CR404 not found.
-- =====================================================================

create table if not exists public.couranr_website_tool_configs (
  business_account_id uuid primary key
    references public.business_accounts(id) on delete cascade,
  status              text not null default 'draft',

  -- The embed the merchant designed. Stored as columns rather than a blob so
  -- the CHECK constraints below can actually constrain them.
  embed_label         text not null default 'Request a delivery',
  embed_color         text not null default '#1f6feb',
  embed_width         integer not null default 240,
  embed_variant       text not null default 'button',

  updated_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint couranr_wtc_status_chk check (status in ('draft', 'published', 'disabled')),
  constraint couranr_wtc_variant_chk check (embed_variant in ('button', 'link')),
  -- The same bounds the pure module validates, enforced here too so a caller
  -- that reached the database another way cannot store an unrenderable config.
  constraint couranr_wtc_width_chk check (embed_width between 120 and 640),
  constraint couranr_wtc_label_chk check (
    length(btrim(embed_label)) between 1 and 40),
  constraint couranr_wtc_color_chk check (
    embed_color ~* '^#([0-9a-f]{3}|[0-9a-f]{6})$')
);

comment on table public.couranr_website_tool_configs is
  'MER-013 per-merchant website tool settings. One row per business account; absence means draft.';

alter table public.couranr_website_tool_configs enable row level security;

-- RLS on with no policy is deny-all to anon and authenticated regardless of
-- what pg_default_acl granted; the grant is then narrowed to service_role.
-- `public` is named because a privilege held through PUBLIC is inherited by
-- every role and a revoke that omits it is a silent no-op.
revoke all on public.couranr_website_tool_configs from public, anon, authenticated;
revoke all on public.couranr_website_tool_configs from service_role;
grant select, insert, update on public.couranr_website_tool_configs to service_role;

/*
 * Upsert the config.
 *
 * One command rather than separate create/update: the row's absence IS the
 * draft state, so the first save is indistinguishable from the tenth as far as
 * the merchant is concerned, and a route that had to know which it was would
 * be a race waiting to happen.
 */
create or replace function public.couranr_save_website_tool_config(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_status              text,
  p_embed_label         text,
  p_embed_color         text,
  p_embed_width         integer,
  p_embed_variant       text
)
returns public.couranr_website_tool_configs
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_config     public.couranr_website_tool_configs;
begin
  -- Reuses the team migration's guard, so "who is an active member" has ONE
  -- definition across every merchant command family.
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  -- Mirrors `website_tools.publish` in lib/couranr/settings/permissions.ts.
  -- Dispatcher is deliberately excluded: this is a settings-shaped capability,
  -- not a dispatch one.
  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_configure_website_tools' using errcode = 'CR403';
  end if;

  if p_status not in ('draft', 'published', 'disabled') then
    raise exception 'unknown_status' using errcode = 'CR400';
  end if;
  if p_embed_variant not in ('button', 'link') then
    raise exception 'unknown_embed_variant' using errcode = 'CR400';
  end if;

  insert into public.couranr_website_tool_configs as c
    (business_account_id, status, embed_label, embed_color, embed_width,
     embed_variant, updated_by)
  values
    (p_business_account_id, p_status, btrim(p_embed_label), lower(btrim(p_embed_color)),
     p_embed_width, p_embed_variant, p_actor_user_id)
  on conflict (business_account_id) do update
     set status        = excluded.status,
         embed_label   = excluded.embed_label,
         embed_color   = excluded.embed_color,
         embed_width   = excluded.embed_width,
         embed_variant = excluded.embed_variant,
         updated_by    = excluded.updated_by,
         updated_at    = now()
  returning * into v_config;

  return v_config;
end
$fn$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.couranr_save_website_tool_config(uuid, uuid, text, text, text, integer, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('revoke all on function %s from service_role', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
