-- FLG-001 and GAT-001: the switches Couranr Operations must be able to throw.
--
-- WHY THIS IS MVP-CRITICAL AND NOT A SETTINGS-PAGE DETAIL. GAT-001 lists eleven
-- release conditions, and two of them are "Operations can pause requests" and
-- "Operations can pause AI". Neither existed: a repository-wide search for
-- ai_global_kill_switch, ai_auto_reply_enabled, request_intake_paused and
-- overnight_enabled returned nothing in schema or code, and the Operations tree
-- contained no pause capability of any kind. Two launch gates were unbuilt and
-- nothing recorded that they were.
--
-- FLG-001 names the four switches and their launch defaults, and this migration
-- seeds exactly those. Note the defaults mean different things per key and that
-- is correct, not an oversight: request_intake_paused=false means intake is
-- OPEN, while ai_auto_reply_enabled=false means auto-send is OFF. Together they
-- produce the state GAT-001 describes as launchable —
-- "ghost_drafts_may_launch_with_auto_replies_disabled": true.
--
-- ONE ENFORCEMENT POINT, NOT THREE. There are three delivery intake commands
-- (couranr_submit_delivery_request, couranr_submit_delivery_request_v2,
-- couranr_submit_consumer_delivery_request) and replacing each by name would
-- mean three large forward replacements, three chances to drift, and no cover
-- at all for a fourth added later. All three do the same one thing to the row:
-- move request_state out of 'draft'. So the pause is enforced on that
-- TRANSITION, which is a single rule every present and future caller passes
-- through. This is the "enumerate ALL enforcement points" problem solved
-- structurally instead of by listing them and hoping.
--
-- WHAT THE PAUSE MUST NOT STOP. couranr_submit_customer_problem_report is NOT
-- intake. Pausing new delivery requests must never stop a customer telling
-- Couranr that something has gone wrong with a delivery already in flight, and
-- a sender must always be able to abandon their own draft. So cancelled,
-- declined and closed stay reachable while paused; only entry into the live
-- pipeline is refused.
--
-- APPLYING THIS CHANGES NO BEHAVIOUR. request_intake_paused seeds false, so the
-- trigger returns immediately and every existing path behaves exactly as it did.

begin;

create table if not exists public.couranr_operational_switches (
  switch_key text primary key,
  enabled boolean not null,
  reason text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on update cascade on delete restrict,
  constraint couranr_os_key_chk check (switch_key in (
    'overnight_enabled','ai_auto_reply_enabled',
    'request_intake_paused','ai_global_kill_switch'
  ))
);

comment on table public.couranr_operational_switches is
  'FLG-001. The four capabilities Couranr Operations must be able to switch '
  'independently. Two of them satisfy GAT-001 launch gates: request_intake_paused '
  'is "Operations can pause requests" and ai_global_kill_switch is "Operations '
  'can pause AI".';

/* Append-only. A switch that can be thrown without a record is a switch nobody
   can be asked about afterwards, and two of these four are launch gates. */
create table if not exists public.couranr_operational_switch_events (
  id uuid primary key default gen_random_uuid(),
  switch_key text not null,
  from_enabled boolean,
  to_enabled boolean not null,
  reason text,
  actor_user_id uuid references auth.users(id) on update cascade on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists couranr_ose_key_time_idx
  on public.couranr_operational_switch_events (switch_key, created_at desc);

/* FLG-001's launch defaults, verbatim. `on conflict do nothing` so a re-run
   never resets a switch Operations has since thrown — a migration that silently
   re-opens a paused intake would be the worst possible kind of idempotent. */
insert into public.couranr_operational_switches (switch_key, enabled, reason) values
  ('overnight_enabled',      false, 'FLG-001 default_at_launch'),
  ('ai_auto_reply_enabled',  false, 'FLG-001 default_at_launch'),
  ('request_intake_paused',  false, 'FLG-001 default_at_launch'),
  ('ai_global_kill_switch',  false, 'FLG-001 default_at_launch')
on conflict (switch_key) do nothing;

/* ------------------------------------------------------------- reader ---- */

create or replace function private.couranr_switch_enabled(p_key text)
returns boolean
language sql
stable
security definer
set search_path=''
as $fn$
  select coalesce(
    (select s.enabled from public.couranr_operational_switches s
      where s.switch_key = p_key), false)
$fn$;

/* SECURITY DEFINER so the trigger can read the table without every writer role
   needing SELECT on it. Revoked from PUBLIC, not merely from anon and
   authenticated: a grant to PUBLIC is inherited by every role, so revoking the
   two named ones leaves the privilege standing. */
revoke all on function private.couranr_switch_enabled(text)
  from public, anon, authenticated;
grant execute on function private.couranr_switch_enabled(text) to service_role;

/* ---------------------------------------------------------- the gate ----- */

create or replace function private.couranr_enforce_request_intake_pause()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
begin
  if old.request_state <> 'draft' or new.request_state = 'draft' then
    return new;
  end if;
  /* Abandoning a draft is always permitted. A pause stops Couranr taking on new
     work; it does not trap a customer inside a form. */
  if new.request_state in ('cancelled','declined','closed') then
    return new;
  end if;
  if private.couranr_switch_enabled('request_intake_paused') then
    raise exception 'request_intake_paused' using errcode='CR412',
      hint = 'Couranr Operations has paused new delivery requests.';
  end if;
  return new;
end
$fn$;

comment on function private.couranr_enforce_request_intake_pause is
  'GAT-001 launch gate "Operations can pause requests". Enforced on the '
  'draft -> live transition rather than inside each of the three submit '
  'commands, so every present and future intake path passes through one rule. '
  'Cancelling a draft and reporting a problem are never blocked.';

revoke all on function private.couranr_enforce_request_intake_pause()
  from public, anon, authenticated;

drop trigger if exists couranr_dr_intake_pause on public.couranr_delivery_requests;
create trigger couranr_dr_intake_pause
  before update on public.couranr_delivery_requests
  for each row execute function private.couranr_enforce_request_intake_pause();

/* --------------------------------------------------------- the command -- */

create or replace function public.couranr_set_operational_switch(
  p_switch_key text,
  p_enabled boolean,
  p_actor_user_id uuid,
  p_reason text
)
returns public.couranr_operational_switches
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_row public.couranr_operational_switches;
  v_from boolean;
begin
  if p_enabled is null then
    raise exception 'switch_state_required' using errcode='CR400';
  end if;
  if p_actor_user_id is null then
    raise exception 'switch_actor_required' using errcode='CR400';
  end if;

  select * into v_row from public.couranr_operational_switches
   where switch_key = p_switch_key for update;
  if not found then
    /* The key vocabulary is closed by CHECK and seeded by this migration. An
       unknown key is a caller bug, never a row to create. */
    raise exception 'switch_unknown' using errcode='CR404';
  end if;

  v_from := v_row.enabled;

  /* Recorded even when nothing changes. "Operations confirmed AI was already
     paused at 14:02" is a fact an incident review needs, and a no-op that
     leaves no trace is indistinguishable from an action nobody took. */
  insert into public.couranr_operational_switch_events
    (switch_key, from_enabled, to_enabled, reason, actor_user_id)
  values (p_switch_key, v_from, p_enabled,
          nullif(btrim(coalesce(p_reason,'')),''), p_actor_user_id);

  if v_from is distinct from p_enabled then
    update public.couranr_operational_switches set
      enabled = p_enabled,
      reason = nullif(btrim(coalesce(p_reason,'')),''),
      updated_at = now(),
      updated_by = p_actor_user_id
    where switch_key = p_switch_key
    returning * into v_row;
  end if;

  return v_row;
end
$fn$;

comment on function public.couranr_set_operational_switch is
  'The only writer. Records every call in an append-only event table, including '
  'a call that changes nothing.';

/* pg_default_acl in this project grants arwdDxtm on every new table in public
   to anon, authenticated AND service_role, which makes a narrow GRANT a silent
   no-op. Revoke first, then grant only what the server needs. */
revoke all on public.couranr_operational_switches
  from public, anon, authenticated, service_role;
revoke all on public.couranr_operational_switch_events
  from public, anon, authenticated, service_role;

grant select, insert, update on public.couranr_operational_switches to service_role;
grant select, insert on public.couranr_operational_switch_events to service_role;

alter table public.couranr_operational_switches enable row level security;
alter table public.couranr_operational_switch_events enable row level security;

revoke all on function public.couranr_set_operational_switch(text,boolean,uuid,text)
  from public,anon,authenticated;
grant execute on function public.couranr_set_operational_switch(text,boolean,uuid,text)
  to service_role;

commit;
