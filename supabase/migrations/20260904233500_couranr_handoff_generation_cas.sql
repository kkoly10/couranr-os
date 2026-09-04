-- Couranr Driver Pilot canary hardening — handoff-code generation CAS.
--
-- The Node issuer signs the raw code with the credential generation. Before
-- this migration it read G, signed for G+1, then the SQL function independently
-- chose max(generation)+1 after locking the delivery. Two concurrent issuers
-- could therefore both sign for G+1 while the second SQL call persisted the
-- second digest as G+2, returning a raw code that could never verify.
--
-- The expected generation is now part of the command contract. A stale issuer
-- is refused BEFORE any live code is superseded or any new row is written.
-- The server retries with a fresh code/digest after refreshing the generation.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- Keep the existing five-argument command during cutover. Production can apply
-- this additive migration before the application deploy; the old deployment
-- continues calling the legacy service-role-only function, and the new
-- deployment switches to this CAS command without an incompatible window.
create function public.couranr_issue_handoff_code_cas(
  p_delivery_id         uuid,
  p_code_kind           text,
  p_expected_generation integer,
  p_code_digest         text,
  p_actor_user_id       uuid,
  p_ttl_minutes         integer
)
returns public.couranr_handoff_codes
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_dlv public.couranr_deliveries;
  v_gen integer;
  v_row public.couranr_handoff_codes;
begin
  if p_code_kind not in ('merchant_pickup', 'recipient_dropoff') then
    raise exception 'unknown_code_kind' using errcode = 'CR400';
  end if;
  if p_expected_generation is null or p_expected_generation < 1 then
    raise exception 'handoff_generation_conflict' using errcode = 'CR409';
  end if;
  if p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'digest_required' using errcode = 'CR400';
  end if;
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode = 'CR403';
  end if;

  -- Serializes issuers for this delivery. The generation check happens only
  -- after this lock is held, so a caller can never sign generation N and have
  -- the database silently store that digest as N+1.
  select * into v_dlv
    from public.couranr_deliveries
   where id = p_delivery_id
   for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;
  if v_dlv.fulfillment_state in ('delivered', 'cancelled', 'could_not_deliver') then
    raise exception 'delivery_already_settled' using errcode = 'CR409';
  end if;

  select coalesce(max(generation), 0) + 1
    into v_gen
    from public.couranr_handoff_codes
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind;

  if p_expected_generation <> v_gen then
    raise exception 'handoff_generation_conflict' using errcode = 'CR409';
  end if;

  -- Only a caller whose generation still matches may supersede the current
  -- credential. A conflict leaves the existing code untouched and retryable.
  update public.couranr_handoff_codes
     set code_state = 'superseded',
         superseded_at = now(),
         version = version + 1,
         updated_at = now()
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind
     and code_state in ('active', 'locked');

  insert into public.couranr_handoff_codes (
    delivery_id, code_kind, generation, code_digest, code_state,
    issued_by, issued_at, expires_at, failed_attempts
  ) values (
    p_delivery_id, p_code_kind, v_gen, p_code_digest, 'active',
    p_actor_user_id, now(),
    now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 1440), 5)),
    0
  )
  returning * into v_row;

  return v_row;
end
$fn$;

-- pg_default_acl grants new public functions broadly in this project. Revoke
-- first, then restore the existing service-role-only command boundary.
revoke all on function public.couranr_issue_handoff_code_cas(uuid,text,integer,text,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_issue_handoff_code_cas(uuid,text,integer,text,uuid,integer)
  to service_role;

commit;
