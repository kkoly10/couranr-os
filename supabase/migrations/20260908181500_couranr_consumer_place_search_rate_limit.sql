-- Consumer /send abuse control: a per-guest-session Places search throttle.
--
-- Direct-consumer /send is fully anonymous. There is no merchant-host
-- relationship the hosted funnel can lean on, and by product doctrine no IP is
-- collected merely to rate-limit. The ONE identity the funnel has is the
-- opaque guest session, so cap paid Places autocomplete per session per hour:
-- a single minted session cannot farm Couranr's Google quota. The shared
-- global paid-provider budget (lib/couranr/providers/paidApiGuard) remains the
-- final ceiling; this throttle sits BEFORE it so one browser cannot consume
-- the whole daily allowance, and the route claims it BEFORE any provider call.
--
-- Additive: two counter columns on the existing guest-session table plus one
-- new SECURITY INVOKER, service_role-only claim function. Nothing is dropped.
-- Mirrors couranr_claim_hosted_place_search (20260905071000) without the host
-- aggregate, which the anonymous consumer funnel has no identity for.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

alter table public.couranr_consumer_guest_sessions
  add column if not exists places_window_started_at timestamptz,
  add column if not exists places_request_count integer not null default 0;

alter table public.couranr_consumer_guest_sessions
  drop constraint if exists couranr_cgs_places_count_chk;
alter table public.couranr_consumer_guest_sessions
  add constraint couranr_cgs_places_count_chk
  check (places_request_count >= 0);

create or replace function public.couranr_claim_consumer_place_search(
  p_session_id uuid
)
returns boolean
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_row public.couranr_consumer_guest_sessions;
  -- Two addresses per session (pickup + dropoff), each debounced and min-3 on
  -- the client, so a real session spends far fewer than this; abuse hits it.
  -- Twice the hosted per-address cap, plus headroom for honest re-edits.
  c_places_per_session_hour constant integer := 30;
begin
  select * into v_row
    from public.couranr_consumer_guest_sessions
   where id = p_session_id
   for update;

  -- Uniform refusal on an unknown/expired/revoked session, matching the
  -- funnel's redeem gate: a claim never reveals whether a session exists.
  if not found or v_row.expires_at <= now() or v_row.revoked_at is not null then
    raise exception 'consumer_guest_session_not_found' using errcode = 'CR404';
  end if;

  -- Fresh window, or the previous one has rolled over: start counting again.
  if v_row.places_window_started_at is null
     or v_row.places_window_started_at <= now() - interval '1 hour' then
    update public.couranr_consumer_guest_sessions
       set places_window_started_at = now(),
           places_request_count = 1,
           last_used_at = now()
     where id = p_session_id;
    return true;
  end if;

  if v_row.places_request_count >= c_places_per_session_hour then
    return false;
  end if;

  update public.couranr_consumer_guest_sessions
     set places_request_count = places_request_count + 1,
         last_used_at = now()
   where id = p_session_id;
  return true;
end
$fn$;

-- pg_default_acl grants ALL on every new public function to anon, authenticated
-- AND service_role, so this revoke-then-grant is what actually scopes it.
revoke all on function public.couranr_claim_consumer_place_search(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_claim_consumer_place_search(uuid)
  to service_role;

commit;
