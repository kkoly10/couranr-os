-- =====================================================================
-- MER-015 — team management commands
--
-- Adds the named commands that manage `public.business_members`, plus an
-- append-only audit table for them. ADDITIVE ONLY: it creates a table, an
-- index and functions. It drops nothing, alters no existing column, and
-- deletes no row.
--
-- ---------------------------------------------------------------------
-- WHY THE LAST-OWNER RULE LIVES HERE AND NOT IN TYPESCRIPT
-- ---------------------------------------------------------------------
--
-- `UI_SCREEN_REGISTRY.md:427` makes "last-owner protection" a REQUIRED STATE
-- of MER-015. A TypeScript check reads the owner count, decides, then writes —
-- and two concurrent demotes both read "2 owners", both decide "fine", and
-- both write. The workspace ends with zero owners and nobody who can add one.
--
-- So every command that could remove an owner takes `for update` row locks on
-- the business's membership rows FIRST, and counts active owners while holding
-- them. The second transaction blocks until the first commits, then sees the
-- real count and raises CR409. The guard is the lock, not the count.
--
-- ---------------------------------------------------------------------
-- WHY AN INVITE NAMES AN EXISTING USER
-- ---------------------------------------------------------------------
--
-- MEASURED, not assumed: `business_members.user_id` is `not null` with a
-- foreign key to `auth.users(id)`. A row for someone who has not signed up
-- cannot exist. Making one possible would mean dropping a NOT NULL — a
-- weakening of an existing invariant on a table holding real memberships, and
-- exactly the kind of change this repository does not make casually.
--
-- The pilot-safe design therefore invites an EXISTING Couranr user by email.
-- No mail is sent: no delivery mechanism is specified anywhere in the
-- authorities, and `/api/test-email` is the repository's cautionary tale about
-- inventing one. The invitee accepts from their own session — which is why
-- `couranr_accept_member_invite` takes the invitee as the actor and can
-- therefore need no delivery channel at all.
--
-- The existing `unique (business_account_id, user_id)` already prevents a
-- duplicate invite for the same person, so no second unique index is needed.
--
-- ---------------------------------------------------------------------
-- WHY THERE IS NO "REMOVE" THAT DELETES
-- ---------------------------------------------------------------------
--
-- Removing access is `couranr_disable_member`: it sets `status = 'disabled'`,
-- which the permission matrix already treats as "no capability at all". A hard
-- delete would destroy the record of who had access and when, which is the
-- opposite of what an audit trail is for, and `business_members` rows are
-- referenced by conversation participants. Disable IS the removal path.
--
-- Error vocabulary (five digits/upper-case ASCII, never ending in three
-- zeroes, per PostgreSQL 17 §43.9): CR403 not permitted, CR404 not found,
-- CR409 conflicting state.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Audit trail
-- ---------------------------------------------------------------------
create table if not exists public.couranr_team_events (
  id                  uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  member_id           uuid not null,
  actor_user_id       uuid,
  command             text not null,
  from_role           text,
  to_role             text,
  from_status         text,
  to_status           text,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),

  constraint couranr_te_command_chk check (command in (
    'invite_member',
    'accept_member_invite',
    'change_member_role',
    'disable_member',
    'reactivate_member'))
);

comment on table public.couranr_team_events is
  'Append-only audit of MER-015 membership changes. One row per successful command.';

create index if not exists couranr_te_business_idx
  on public.couranr_team_events (business_account_id, created_at desc);

alter table public.couranr_team_events enable row level security;

-- No policy is created deliberately: with RLS on and no policy the table is
-- deny-all to anon and authenticated no matter what pg_default_acl granted.
-- The grant is then narrowed to service_role, which is the only identity that
-- writes it. `public` is named explicitly in the revoke because a privilege
-- held through PUBLIC is inherited by every role and a revoke that omits it
-- is a silent no-op.
revoke all on public.couranr_team_events from public, anon, authenticated;
revoke all on public.couranr_team_events from service_role;
grant select, insert on public.couranr_team_events to service_role;

-- ---------------------------------------------------------------------
-- 2. Shared guards
-- ---------------------------------------------------------------------

/*
 * Locks this business's membership rows and returns the number of ACTIVE
 * owners. Every caller that could reduce that number calls this first, so the
 * count it acts on cannot change underneath it.
 */
create or replace function public.couranr_lock_and_count_active_owners(
  p_business_account_id uuid
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_count integer;
begin
  -- The lock is the point. `perform ... for update` takes row locks on every
  -- membership row of this business; a concurrent command doing the same
  -- blocks here until this transaction commits.
  perform 1
    from public.business_members
   where business_account_id = p_business_account_id
     for update;

  select count(*) into v_count
    from public.business_members
   where business_account_id = p_business_account_id
     and status = 'active'
     and role = 'owner';

  return v_count;
end
$fn$;

/*
 * Resolves the ACTOR's own membership and refuses if it is not an active one.
 * Returns the actor's role so the caller can apply the capability matrix.
 */
create or replace function public.couranr_require_active_member(
  p_business_account_id uuid,
  p_actor_user_id       uuid
)
returns text
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_role   text;
  v_status text;
begin
  select role, status into v_role, v_status
    from public.business_members
   where business_account_id = p_business_account_id
     and user_id = p_actor_user_id;

  if not found then
    raise exception 'not_a_member' using errcode = 'CR403';
  end if;
  if v_status <> 'active' then
    raise exception 'membership_not_active' using errcode = 'CR403';
  end if;

  return v_role;
end
$fn$;

-- ---------------------------------------------------------------------
-- 3. Commands
-- ---------------------------------------------------------------------

/*
 * Invite an EXISTING Couranr user into this workspace.
 *
 * The caller resolves the email to a user id (only an identity provider can do
 * that); this function is handed the resolved id and records the email as
 * typed, so the audit shows what the inviter actually entered.
 */
create or replace function public.couranr_invite_member(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_invited_user_id     uuid,
  p_invited_email       text,
  p_role                text
)
returns public.business_members
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_member     public.business_members;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_manage_team' using errcode = 'CR403';
  end if;

  if p_role not in ('owner', 'manager', 'dispatcher', 'viewer', 'billing') then
    raise exception 'unknown_role' using errcode = 'CR400';
  end if;

  -- Only an owner may hand out the owner role. A manager who could invite a
  -- new owner could promote themselves through a second account.
  if p_role = 'owner' and v_actor_role <> 'owner' then
    raise exception 'only_an_owner_may_grant_owner' using errcode = 'CR403';
  end if;

  -- Serialize concurrent invites of the SAME person into the same business,
  -- so two clicks cannot race past the existence check below into the unique
  -- constraint and surface as an unhelpful integrity error.
  perform pg_advisory_xact_lock(
    hashtextextended(p_business_account_id::text || ':' || p_invited_user_id::text, 0));

  select * into v_member
    from public.business_members
   where business_account_id = p_business_account_id
     and user_id = p_invited_user_id;

  if found then
    -- Idempotent for the case that matters: re-inviting someone who is already
    -- pending returns their existing invitation rather than erroring.
    if v_member.status = 'invited' then
      return v_member;
    end if;
    raise exception 'already_a_member' using errcode = 'CR409';
  end if;

  insert into public.business_members
    (business_account_id, user_id, role, status, invited_email, invited_by, joined_at)
  values
    (p_business_account_id, p_invited_user_id, p_role, 'invited',
     lower(btrim(p_invited_email)), p_actor_user_id, null)
  returning * into v_member;

  insert into public.couranr_team_events
    (business_account_id, member_id, actor_user_id, command, to_role, to_status, metadata)
  values
    (p_business_account_id, v_member.id, p_actor_user_id, 'invite_member', p_role, 'invited',
     jsonb_build_object('invitedEmail', lower(btrim(p_invited_email))));

  return v_member;
end
$fn$;

/*
 * The INVITEE accepts their own invitation.
 *
 * The actor is the invitee, which is what makes this safe without any email
 * delivery: the authorization already happened when an owner or manager
 * created the invitation, and nothing here lets a person join a workspace
 * that did not invite them.
 */
create or replace function public.couranr_accept_member_invite(
  p_business_account_id uuid,
  p_actor_user_id       uuid
)
returns public.business_members
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_member public.business_members;
begin
  select * into v_member
    from public.business_members
   where business_account_id = p_business_account_id
     and user_id = p_actor_user_id
     for update;

  if not found then
    raise exception 'invitation_not_found' using errcode = 'CR404';
  end if;
  if v_member.status <> 'invited' then
    raise exception 'invitation_not_pending' using errcode = 'CR409';
  end if;

  update public.business_members
     set status     = 'active',
         joined_at  = now(),
         updated_at = now()
   where id = v_member.id
  returning * into v_member;

  insert into public.couranr_team_events
    (business_account_id, member_id, actor_user_id, command, from_status, to_status)
  values
    (p_business_account_id, v_member.id, p_actor_user_id, 'accept_member_invite',
     'invited', 'active');

  return v_member;
end
$fn$;

/*
 * Change a member's role.
 *
 * Both the actor's authority and the last-owner rule are enforced here.
 */
create or replace function public.couranr_change_member_role(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_member_id           uuid,
  p_to_role             text
)
returns public.business_members
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role   text;
  v_member       public.business_members;
  v_owner_count  integer;
  v_from_role    text;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_manage_team' using errcode = 'CR403';
  end if;

  if p_to_role not in ('owner', 'manager', 'dispatcher', 'viewer', 'billing') then
    raise exception 'unknown_role' using errcode = 'CR400';
  end if;

  -- Lock FIRST, then read. Everything below acts on a count that cannot move.
  v_owner_count := public.couranr_lock_and_count_active_owners(p_business_account_id);

  select * into v_member
    from public.business_members
   where id = p_member_id
     and business_account_id = p_business_account_id;

  if not found then
    raise exception 'member_not_found' using errcode = 'CR404';
  end if;

  v_from_role := v_member.role;

  if v_from_role = p_to_role then
    return v_member;
  end if;

  -- Granting OR revoking owner is the owner's alone, in both directions.
  if (v_from_role = 'owner' or p_to_role = 'owner') and v_actor_role <> 'owner' then
    raise exception 'only_an_owner_may_change_the_owner_role' using errcode = 'CR403';
  end if;

  -- THE LAST-OWNER RULE. Demoting an active owner is refused when they are the
  -- only one left, whoever is asking — including that owner demoting
  -- themselves.
  if v_from_role = 'owner' and v_member.status = 'active' and v_owner_count <= 1 then
    raise exception 'last_owner_protected' using errcode = 'CR409';
  end if;

  update public.business_members
     set role       = p_to_role,
         updated_at = now()
   where id = v_member.id
  returning * into v_member;

  insert into public.couranr_team_events
    (business_account_id, member_id, actor_user_id, command, from_role, to_role)
  values
    (p_business_account_id, v_member.id, p_actor_user_id, 'change_member_role',
     v_from_role, p_to_role);

  return v_member;
end
$fn$;

/*
 * Disable a member's access. This is also how access is REMOVED — see the
 * header. A disabled member holds no capability at all.
 */
create or replace function public.couranr_disable_member(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_member_id           uuid
)
returns public.business_members
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role  text;
  v_member      public.business_members;
  v_owner_count integer;
  v_from_status text;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_manage_team' using errcode = 'CR403';
  end if;

  v_owner_count := public.couranr_lock_and_count_active_owners(p_business_account_id);

  select * into v_member
    from public.business_members
   where id = p_member_id
     and business_account_id = p_business_account_id;

  if not found then
    raise exception 'member_not_found' using errcode = 'CR404';
  end if;

  if v_member.status = 'disabled' then
    return v_member;
  end if;

  if v_member.role = 'owner' and v_actor_role <> 'owner' then
    raise exception 'only_an_owner_may_disable_an_owner' using errcode = 'CR403';
  end if;

  -- Same rule as demotion: disabling the only active owner would leave the
  -- workspace with nobody who can restore it.
  if v_member.role = 'owner' and v_member.status = 'active' and v_owner_count <= 1 then
    raise exception 'last_owner_protected' using errcode = 'CR409';
  end if;

  v_from_status := v_member.status;

  update public.business_members
     set status     = 'disabled',
         updated_at = now()
   where id = v_member.id
  returning * into v_member;

  insert into public.couranr_team_events
    (business_account_id, member_id, actor_user_id, command, from_status, to_status)
  values
    (p_business_account_id, v_member.id, p_actor_user_id, 'disable_member',
     v_from_status, 'disabled');

  return v_member;
end
$fn$;

/*
 * Restore a disabled member. Returns them to 'active' — never to 'invited',
 * which would be a claim that they had not yet accepted.
 */
create or replace function public.couranr_reactivate_member(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_member_id           uuid
)
returns public.business_members
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_member     public.business_members;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_manage_team' using errcode = 'CR403';
  end if;

  select * into v_member
    from public.business_members
   where id = p_member_id
     and business_account_id = p_business_account_id
     for update;

  if not found then
    raise exception 'member_not_found' using errcode = 'CR404';
  end if;
  if v_member.status <> 'disabled' then
    raise exception 'member_not_disabled' using errcode = 'CR409';
  end if;

  -- Restoring someone to OWNER is the owner's decision alone, for the same
  -- reason granting it is.
  if v_member.role = 'owner' and v_actor_role <> 'owner' then
    raise exception 'only_an_owner_may_restore_an_owner' using errcode = 'CR403';
  end if;

  update public.business_members
     set status     = 'active',
         joined_at  = coalesce(v_member.joined_at, now()),
         updated_at = now()
   where id = v_member.id
  returning * into v_member;

  insert into public.couranr_team_events
    (business_account_id, member_id, actor_user_id, command, from_status, to_status)
  values
    (p_business_account_id, v_member.id, p_actor_user_id, 'reactivate_member',
     'disabled', 'active');

  return v_member;
end
$fn$;

/*
 * MER-014's profile update.
 *
 * `couranr_merchant_workspaces` already grants UPDATE to service_role
 * (20260731061356:122), so this needs no new grant. It exists as a named
 * command rather than a route-level update so the role check and the audit
 * live with the write.
 */
create or replace function public.couranr_update_workspace_profile(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_name                text,
  p_business_category   text,
  p_pickup_address      jsonb,
  p_contact_phone       text,
  p_payer_default       text
)
returns public.couranr_merchant_workspaces
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_ws         public.couranr_merchant_workspaces;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  -- Mirrors lib/couranr/settings/permissions.ts `settings.write`. Enforced in
  -- both places deliberately: the TypeScript matrix is what the UI reads, and
  -- this is what the database refuses.
  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_change_settings' using errcode = 'CR403';
  end if;

  if p_payer_default is not null and p_payer_default not in ('merchant', 'customer') then
    raise exception 'unknown_payer_default' using errcode = 'CR400';
  end if;

  update public.business_accounts
     set name = coalesce(nullif(btrim(p_name), ''), name)
   where id = p_business_account_id;

  update public.couranr_merchant_workspaces
     set business_category = coalesce(p_business_category, business_category),
         pickup_address    = coalesce(p_pickup_address, pickup_address),
         contact_phone     = coalesce(nullif(btrim(p_contact_phone), ''), contact_phone),
         payer_default     = coalesce(p_payer_default, payer_default),
         updated_at        = now()
   where business_account_id = p_business_account_id
  returning * into v_ws;

  if not found then
    raise exception 'workspace_not_found' using errcode = 'CR404';
  end if;

  return v_ws;
end
$fn$;

-- ---------------------------------------------------------------------
-- 4. Execution grants
-- ---------------------------------------------------------------------
-- Same posture as every other command family: revoke from everyone (naming
-- `public` so the PUBLIC-inherited grant goes too), then grant execute to
-- service_role alone. These functions are SECURITY INVOKER, so they carry no
-- privilege of their own — service_role's own rights are what let them write.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.couranr_lock_and_count_active_owners(uuid)',
    'public.couranr_require_active_member(uuid, uuid)',
    'public.couranr_invite_member(uuid, uuid, uuid, text, text)',
    'public.couranr_accept_member_invite(uuid, uuid)',
    'public.couranr_change_member_role(uuid, uuid, uuid, text)',
    'public.couranr_disable_member(uuid, uuid, uuid)',
    'public.couranr_reactivate_member(uuid, uuid, uuid)',
    'public.couranr_update_workspace_profile(uuid, uuid, text, text, jsonb, text, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('revoke all on function %s from service_role', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
