-- =====================================================================
-- MER-003 — live workspace activation
--
-- ADDITIVE ONLY: three new tables and their commands. Drops nothing, alters
-- no existing column, deletes no row.
--
-- ---------------------------------------------------------------------
-- WHY ACTIVATION IS A TABLE AND NOT A FLAG
-- ---------------------------------------------------------------------
--
-- The registry's required states ARE the machine:
--
--     not_started → in_progress → pending_couranr_review → live | blocked
--
-- and `live` is COURANR OPERATIONS' to grant. A boolean on the workspace row
-- could be set by whatever last wrote that row; a state column with named
-- transitions, an actor check on each, and an append-only event trail is what
-- makes "the merchant did not activate themselves" a fact rather than a hope.
--
-- ---------------------------------------------------------------------
-- WHY ACKNOWLEDGEMENTS ARE VERSIONED ROWS, NOT BOOLEANS
-- ---------------------------------------------------------------------
--
-- Each of the four acknowledgements is a separate, versioned act. Onboarding's
-- single `policies_accepted_at` does NOT cover them: a merchant who accepted
-- the general policies at signup has not thereby accepted the prohibited-item
-- policy. And because a version is recorded, changing a document makes the old
-- acceptance stop satisfying the gate — which a boolean could never express.
--
-- The table is append-only: re-accepting a new version inserts a row, and the
-- history of what was accepted when survives.
--
-- ---------------------------------------------------------------------
-- WHAT ACTIVATION MUST NOT REQUIRE
-- ---------------------------------------------------------------------
--
-- The specification is explicit: no website, no EIN, no storefront, no
-- business-registration upload unless a risk review demands it — and the
-- registry adds no website tools and no subscription purchase. Nothing in this
-- schema records any of those, and no gate below consults one.
--
-- Error vocabulary: CR400 bad input, CR403 not permitted, CR404 not found,
-- CR409 conflicting state.
-- =====================================================================

do $$
begin
  if to_regclass('public.couranr_workspace_activations') is not null then
    raise exception 'couranr_workspace_activations already exists - inspect before migrating';
  end if;
end
$$;

create table public.couranr_workspace_activations (
  business_account_id uuid primary key
    references public.business_accounts(id) on delete cascade,

  activation_state    text not null default 'not_started',

  /*
   * A CODE, never an operator's words. The merchant-safe message is derived
   * from it in lib/couranr/activation/states.ts, the same shape the review
   * outcomes use — an internal note must never be what a merchant reads.
   */
  blocked_reason_code text,

  contact_verified_at timestamptz,

  /*
   * The test delivery. A REAL delivery request row, flagged here, so "the
   * merchant has tried the product" is evidence rather than a checkbox. It is
   * never dispatched and never charged: the workspace is not live, which is
   * precisely what the merchant is asking to change.
   */
  test_delivery_request_id uuid references public.couranr_delivery_requests(id),

  requested_at        timestamptz,
  reviewed_at         timestamptz,
  reviewed_by         uuid,

  version             integer not null default 1,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint couranr_wa_state_chk check (activation_state in (
    'not_started', 'in_progress', 'pending_couranr_review', 'live', 'blocked')),
  constraint couranr_wa_version_chk check (version >= 1),
  -- A blocked workspace must carry a reason. A block with no reason is an
  -- unanswerable message to the merchant.
  constraint couranr_wa_blocked_has_reason_chk check (
    activation_state <> 'blocked' or blocked_reason_code is not null)
);

comment on table public.couranr_workspace_activations is
  'MER-003 activation state. `live` and `blocked` are granted by Couranr Operations only.';

create table public.couranr_activation_acknowledgements (
  id                  uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  ack_kind            text not null,
  ack_version         text not null,
  accepted_by         uuid,
  accepted_at         timestamptz not null default now(),

  constraint couranr_aa_kind_chk check (ack_kind in (
    'delivery_terms', 'prohibited_items', 'merchant_responsibility', 'return_acceptance')),
  -- Accepting the same document version twice is the same act, not two.
  constraint couranr_aa_once_key unique (business_account_id, ack_kind, ack_version)
);

comment on table public.couranr_activation_acknowledgements is
  'Append-only record of which activation document version a merchant accepted, and when.';

create table public.couranr_activation_events (
  id                  uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  actor_user_id       uuid,
  actor_type          text not null,
  command             text not null,
  from_state          text,
  to_state            text,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),

  -- `couranr_actev_*`, NOT `couranr_ae_*`: `couranr_assignment_events` already
  -- owns that prefix, and a shared constraint name broke a test that looks
  -- constraints up BY NAME. Two tables abbreviating to the same two letters is
  -- exactly the kind of collision that is invisible until something searches.
  constraint couranr_actev_actor_chk check (actor_type in ('merchant', 'operations')),
  constraint couranr_actev_command_chk check (command in (
    'accept_acknowledgement',
    'verify_contact',
    'record_test_delivery',
    'request_activation',
    'grant_activation',
    'block_activation'))
);

comment on table public.couranr_activation_events is
  'Append-only audit of every activation transition, including who granted or blocked it.';

create index couranr_actev_business_idx
  on public.couranr_activation_events (business_account_id, created_at desc);

alter table public.couranr_workspace_activations enable row level security;
alter table public.couranr_activation_acknowledgements enable row level security;
alter table public.couranr_activation_events enable row level security;

revoke all on public.couranr_workspace_activations from public, anon, authenticated;
revoke all on public.couranr_workspace_activations from service_role;
grant select, insert, update on public.couranr_workspace_activations to service_role;

revoke all on public.couranr_activation_acknowledgements from public, anon, authenticated;
revoke all on public.couranr_activation_acknowledgements from service_role;
grant select, insert on public.couranr_activation_acknowledgements to service_role;

revoke all on public.couranr_activation_events from public, anon, authenticated;
revoke all on public.couranr_activation_events from service_role;
grant select, insert on public.couranr_activation_events to service_role;

-- ---------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------

/*
 * Ensures the activation row exists and returns it locked.
 *
 * The row is created on first touch rather than at onboarding, so every
 * workspace that predates MER-003 gets one the moment its merchant opens the
 * checklist — no backfill, and no workspace without a state.
 */
create or replace function public.couranr_lock_activation(
  p_business_account_id uuid
)
returns public.couranr_workspace_activations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row public.couranr_workspace_activations;
begin
  insert into public.couranr_workspace_activations (business_account_id)
  values (p_business_account_id)
  on conflict (business_account_id) do nothing;

  select * into v_row
    from public.couranr_workspace_activations
   where business_account_id = p_business_account_id
     for update;

  return v_row;
end
$fn$;

/*
 * Accept one acknowledgement at one version.
 *
 * The version is passed by the CALLER, which reads it from the governed
 * module — never from a browser. A merchant cannot claim to have accepted a
 * version they were not shown.
 */
create or replace function public.couranr_accept_activation_ack(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_ack_kind            text,
  p_ack_version         text
)
returns public.couranr_workspace_activations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_row        public.couranr_workspace_activations;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  -- Activation binds the business. Only an owner or manager may accept these.
  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_accept_activation_terms' using errcode = 'CR403';
  end if;

  v_row := public.couranr_lock_activation(p_business_account_id);

  if v_row.activation_state = 'live' then
    raise exception 'workspace_already_live' using errcode = 'CR409';
  end if;

  insert into public.couranr_activation_acknowledgements
    (business_account_id, ack_kind, ack_version, accepted_by)
  values
    (p_business_account_id, p_ack_kind, p_ack_version, p_actor_user_id)
  on conflict (business_account_id, ack_kind, ack_version) do nothing;

  update public.couranr_workspace_activations
     set activation_state = case
           when activation_state in ('not_started', 'blocked') then 'in_progress'
           else activation_state
         end,
         version    = version + 1,
         updated_at = now()
   where business_account_id = p_business_account_id
  returning * into v_row;

  insert into public.couranr_activation_events
    (business_account_id, actor_user_id, actor_type, command, to_state, metadata)
  values
    (p_business_account_id, p_actor_user_id, 'merchant', 'accept_acknowledgement',
     v_row.activation_state,
     jsonb_build_object('ackKind', p_ack_kind, 'ackVersion', p_ack_version));

  return v_row;
end
$fn$;

/* Verify the operations contact. */
create or replace function public.couranr_verify_activation_contact(
  p_business_account_id uuid,
  p_actor_user_id       uuid
)
returns public.couranr_workspace_activations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_row        public.couranr_workspace_activations;
  v_phone      text;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_accept_activation_terms' using errcode = 'CR403';
  end if;

  v_row := public.couranr_lock_activation(p_business_account_id);

  -- There must BE a contact to verify. The workspace profile holds it, and a
  -- workspace without one cannot pass this step by asserting it did.
  select contact_phone into v_phone
    from public.couranr_merchant_workspaces
   where business_account_id = p_business_account_id;

  if v_phone is null or btrim(v_phone) = '' then
    raise exception 'no_operations_contact_on_file' using errcode = 'CR409';
  end if;

  update public.couranr_workspace_activations
     set contact_verified_at = now(),
         activation_state = case
           when activation_state in ('not_started', 'blocked') then 'in_progress'
           else activation_state
         end,
         version    = version + 1,
         updated_at = now()
   where business_account_id = p_business_account_id
  returning * into v_row;

  insert into public.couranr_activation_events
    (business_account_id, actor_user_id, actor_type, command, to_state)
  values
    (p_business_account_id, p_actor_user_id, 'merchant', 'verify_contact', v_row.activation_state);

  return v_row;
end
$fn$;

/*
 * Record the test delivery.
 *
 * The request must belong to THIS business — checked here, so a merchant
 * cannot satisfy their own activation by pointing at someone else's delivery.
 */
create or replace function public.couranr_record_test_delivery(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_request_id          uuid
)
returns public.couranr_workspace_activations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_row        public.couranr_workspace_activations;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager', 'dispatcher') then
    raise exception 'role_may_not_manage_activation' using errcode = 'CR403';
  end if;

  perform 1 from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'delivery_request_not_found' using errcode = 'CR404';
  end if;

  v_row := public.couranr_lock_activation(p_business_account_id);

  update public.couranr_workspace_activations
     set test_delivery_request_id = p_request_id,
         activation_state = case
           when activation_state in ('not_started', 'blocked') then 'in_progress'
           else activation_state
         end,
         version    = version + 1,
         updated_at = now()
   where business_account_id = p_business_account_id
  returning * into v_row;

  insert into public.couranr_activation_events
    (business_account_id, actor_user_id, actor_type, command, to_state, metadata)
  values
    (p_business_account_id, p_actor_user_id, 'merchant', 'record_test_delivery',
     v_row.activation_state, jsonb_build_object('requestId', p_request_id));

  return v_row;
end
$fn$;

/*
 * Request activation.
 *
 * THE GATE. Every requirement is re-checked HERE, against the database, under
 * the lock — not trusted from the screen that offered the button. The
 * acknowledgement versions are passed in from the governed module so this
 * function checks the CURRENT versions rather than any row at all.
 */
create or replace function public.couranr_request_activation(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_required_acks       jsonb
)
returns public.couranr_workspace_activations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_row        public.couranr_workspace_activations;
  v_kind       text;
  v_version    text;
begin
  v_actor_role := public.couranr_require_active_member(p_business_account_id, p_actor_user_id);

  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_accept_activation_terms' using errcode = 'CR403';
  end if;

  v_row := public.couranr_lock_activation(p_business_account_id);

  if v_row.activation_state = 'live' then
    raise exception 'workspace_already_live' using errcode = 'CR409';
  end if;
  if v_row.activation_state = 'pending_couranr_review' then
    raise exception 'activation_already_requested' using errcode = 'CR409';
  end if;

  -- Each required acknowledgement, at the version the caller states.
  for v_kind, v_version in select * from jsonb_each_text(p_required_acks)
  loop
    perform 1
      from public.couranr_activation_acknowledgements
     where business_account_id = p_business_account_id
       and ack_kind = v_kind
       and ack_version = v_version;
    if not found then
      raise exception 'activation_requirements_not_met' using errcode = 'CR409';
    end if;
  end loop;

  if v_row.contact_verified_at is null then
    raise exception 'activation_requirements_not_met' using errcode = 'CR409';
  end if;
  if v_row.test_delivery_request_id is null then
    raise exception 'activation_requirements_not_met' using errcode = 'CR409';
  end if;

  update public.couranr_workspace_activations
     set activation_state    = 'pending_couranr_review',
         blocked_reason_code = null,
         requested_at        = now(),
         version             = version + 1,
         updated_at          = now()
   where business_account_id = p_business_account_id
  returning * into v_row;

  insert into public.couranr_activation_events
    (business_account_id, actor_user_id, actor_type, command, to_state)
  values
    (p_business_account_id, p_actor_user_id, 'merchant', 'request_activation',
     'pending_couranr_review');

  return v_row;
end
$fn$;

/*
 * Grant or block — COURANR OPERATIONS ONLY.
 *
 * The actor's Operations standing is checked against `profiles.role`, which is
 * the same source `resolveRequestActor` uses. A merchant has no path to this
 * function: they are not admins, and the check is here rather than only in the
 * route so a future caller cannot bypass it.
 */
create or replace function public.couranr_decide_activation(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_grant               boolean,
  p_blocked_reason_code text
)
returns public.couranr_workspace_activations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_profile_role text;
  v_row          public.couranr_workspace_activations;
  v_from         text;
begin
  select role into v_profile_role from public.profiles where id = p_actor_user_id;
  if v_profile_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  if not p_grant and (p_blocked_reason_code is null or btrim(p_blocked_reason_code) = '') then
    raise exception 'block_requires_a_reason' using errcode = 'CR400';
  end if;

  v_row := public.couranr_lock_activation(p_business_account_id);
  v_from := v_row.activation_state;

  update public.couranr_workspace_activations
     set activation_state    = case when p_grant then 'live' else 'blocked' end,
         blocked_reason_code = case when p_grant then null else p_blocked_reason_code end,
         reviewed_at         = now(),
         reviewed_by         = p_actor_user_id,
         version             = version + 1,
         updated_at          = now()
   where business_account_id = p_business_account_id
  returning * into v_row;

  insert into public.couranr_activation_events
    (business_account_id, actor_user_id, actor_type, command, from_state, to_state, metadata)
  values
    (p_business_account_id, p_actor_user_id, 'operations',
     case when p_grant then 'grant_activation' else 'block_activation' end,
     v_from, v_row.activation_state,
     case when p_grant then '{}'::jsonb
          else jsonb_build_object('reasonCode', p_blocked_reason_code) end);

  return v_row;
end
$fn$;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.couranr_lock_activation(uuid)',
    'public.couranr_accept_activation_ack(uuid, uuid, text, text)',
    'public.couranr_verify_activation_contact(uuid, uuid)',
    'public.couranr_record_test_delivery(uuid, uuid, uuid)',
    'public.couranr_request_activation(uuid, uuid, jsonb)',
    'public.couranr_decide_activation(uuid, uuid, boolean, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('revoke all on function %s from service_role', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
