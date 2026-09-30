-- RR-002 closure: release an accepted stop set only before ANY downstream
-- commercial or physical execution. No provider, refund, dispatch or custody
-- function is called here. Route/child locks serialize with canonical FK-backed
-- artifact inserts; RR-003 must extend this guard before adding new artifacts.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

do $$ begin
  if to_regclass('public.couranr_route_run_claims') is null
     or to_regclass('public.couranr_payment_obligations') is null
     or to_regclass('public.couranr_service_plans') is null
     or to_regclass('public.couranr_deliveries') is null
     or to_regclass('public.couranr_capacity_reservations') is null
     or to_regclass('public.couranr_dispatch_reservations') is null
     or to_regprocedure('private.couranr_quote_payer_approved(public.couranr_quote_versions)') is null then
    raise exception 'route_cancel_requires_rr002_and_canonical_execution';
  end if;
end $$;

alter table public.couranr_route_runs
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users(id),
  add column cancel_idempotency_key uuid;
create index couranr_rr_cancelled_by_idx on public.couranr_route_runs(cancelled_by);

alter table public.couranr_route_runs drop constraint couranr_route_runs_route_state_check;
alter table public.couranr_route_runs add constraint couranr_route_runs_route_state_check
  check(route_state in ('draft','accepted','abandoned','cancelled'));
alter table public.couranr_route_runs drop constraint couranr_rr_acceptance_shape_chk;
alter table public.couranr_route_runs add constraint couranr_rr_acceptance_shape_chk check (
  (route_state='draft' and accepted_version is null and accepted_at is null and accepted_by is null
    and abandoned_at is null and abandoned_by is null and cancelled_at is null and cancelled_by is null
    and cancel_idempotency_key is null)
  or (route_state='accepted' and accepted_version is not null and accepted_at is not null and accepted_by is not null
    and accept_idempotency_key is not null and abandoned_at is null and abandoned_by is null
    and cancelled_at is null and cancelled_by is null and cancel_idempotency_key is null)
  or (route_state='abandoned' and accepted_version is null and accepted_at is null and accepted_by is null
    and abandoned_at is not null and abandoned_by is not null and abandon_idempotency_key is not null
    and cancelled_at is null and cancelled_by is null and cancel_idempotency_key is null)
  or (route_state='cancelled' and accepted_version is not null and accepted_at is not null and accepted_by is not null
    and accept_idempotency_key is not null and abandoned_at is null and abandoned_by is null
    and cancelled_at is not null and cancelled_by is not null and cancel_idempotency_key is not null)
);

alter table public.couranr_route_run_events drop constraint couranr_route_run_events_command_check;
alter table public.couranr_route_run_events add constraint couranr_route_run_events_command_check
  check(command in ('create_route_draft','revise_route_draft','accept_route_run',
    'abandon_route_draft','cancel_accepted_route'));

create or replace function private.couranr_route_run_draft_view(p_route uuid,p_version integer)
returns jsonb language sql stable set search_path='' as $fn$
  select jsonb_build_object(
    'routeRunId',r.id,'businessAccountId',r.business_account_id,'state',r.route_state,
    'version',v.version,'currentVersion',r.current_version,'title',v.title,
    'draftOnly',(r.route_state='draft'),'bookingAvailable',false,
    'executionAvailable',false,'stopCount',v.stop_count,
    'referenceQuoteTotalCents',v.reference_quote_total_cents,
    'quoteBasis','independent_delivery_quotes_not_a_route_offer',
    'acceptedVersion',r.accepted_version,'acceptedAt',r.accepted_at,
    'abandonedAt',r.abandoned_at,'cancelledAt',r.cancelled_at,
    'stops',coalesce((select jsonb_agg(jsonb_build_object(
      'sequence',s.sequence,'requestId',s.request_id,'quoteVersionId',s.quote_version_id,
      'requestVersion',s.request_version,'pickupManifestVersion',s.pickup_manifest_version,
      'claimed',c.request_id is not null,
      'stale',q.id is null or q.request_state<>'draft' or q.version<>s.request_version or
        q.current_quote_version_id is distinct from s.quote_version_id or
        q.pickup_manifest_version<>s.pickup_manifest_version
    ) order by s.sequence) from public.couranr_route_run_stops s
      left join public.couranr_delivery_requests q on q.id=s.request_id
      left join public.couranr_route_run_claims c on c.request_id=s.request_id and c.route_run_id=r.id
      where s.route_version_id=v.id),'[]'::jsonb))
  from public.couranr_route_runs r join public.couranr_route_run_versions v
    on v.route_run_id=r.id and v.version=p_version where r.id=p_route
$fn$;

create or replace function public.couranr_cancel_accepted_route_run(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_expected_version integer,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_version_id uuid;
  v_expected_count integer;
  v_released_count integer;
begin
  perform private.couranr_assert_route_run_member(p_business_account_id,p_actor_user_id,true);
  if p_idempotency_key is null or p_expected_version is null or p_expected_version<1 then
    raise exception 'route_cancel_input_invalid' using errcode='CR422';
  end if;
  select * into v_route from public.couranr_route_runs
    where id=p_route_run_id and business_account_id=p_business_account_id for update;
  if not found then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
  if v_route.route_state='cancelled' then
    if v_route.cancel_idempotency_key=p_idempotency_key and v_route.accepted_version=p_expected_version then
      return private.couranr_route_run_draft_view(p_route_run_id,v_route.accepted_version);
    end if;
    raise exception 'route_already_cancelled' using errcode='CR409';
  end if;
  if v_route.route_state<>'accepted' then raise exception 'route_not_accepted' using errcode='CR409'; end if;
  if v_route.accepted_version<>p_expected_version or v_route.current_version<>p_expected_version then
    raise exception 'route_version_conflict' using errcode='CR409';
  end if;
  select id into strict v_version_id from public.couranr_route_run_versions
    where route_run_id=p_route_run_id and version=v_route.accepted_version;
  select count(*) into v_expected_count from public.couranr_route_run_stops where route_version_id=v_version_id;
  if v_expected_count not between 2 and 5 then raise exception 'route_cancel_invariant' using errcode='CR409'; end if;

  -- FKs on obligations/plans/deliveries/reservations acquire KEY SHARE on
  -- these requests. FOR UPDATE waits for any in-flight artifact insert before
  -- checking it, and blocks a new one until this transaction commits.
  perform q.id from public.couranr_route_run_stops s
    join public.couranr_delivery_requests q on q.id=s.request_id
    where s.route_version_id=v_version_id order by q.id for update of q;
  if (select count(*) from public.couranr_delivery_requests q
        join public.couranr_route_run_stops s on s.request_id=q.id
       where s.route_version_id=v_version_id and q.request_state='draft'
         and q.business_account_id=p_business_account_id)=v_expected_count
     and (select count(*) from public.couranr_route_run_claims c
          where c.route_run_id=p_route_run_id and c.route_version_id=v_version_id)=v_expected_count
     and not exists(
       select 1 from public.couranr_route_run_stops s
       where s.route_version_id=v_version_id and (
         exists(select 1 from public.couranr_payment_obligations o where o.request_id=s.request_id)
         or exists(select 1 from public.couranr_service_plans p where p.request_id=s.request_id)
         or exists(select 1 from public.couranr_deliveries d where d.request_id=s.request_id)
         or exists(select 1 from public.couranr_capacity_reservations c where c.request_id=s.request_id)
         or exists(select 1 from public.couranr_dispatch_reservations d where d.request_id=s.request_id)
       )
     ) then
    delete from public.couranr_route_run_claims
      where route_run_id=p_route_run_id and route_version_id=v_version_id;
    get diagnostics v_released_count = row_count;
    if v_released_count<>v_expected_count then
      raise exception 'route_cancel_invariant' using errcode='CR409';
    end if;
    update public.couranr_route_runs
      set route_state='cancelled',cancelled_at=now(),cancelled_by=p_actor_user_id,
          cancel_idempotency_key=p_idempotency_key,updated_at=now()
      where id=p_route_run_id;
    insert into public.couranr_route_run_events(route_run_id,route_version_id,actor_user_id,command)
      values(p_route_run_id,v_version_id,p_actor_user_id,'cancel_accepted_route');
    return private.couranr_route_run_draft_view(p_route_run_id,v_route.accepted_version);
  end if;
  raise exception 'route_cancel_downstream_started' using errcode='CR409';
end
$fn$;
revoke all on function public.couranr_cancel_accepted_route_run(uuid,uuid,uuid,integer,uuid)
  from public,anon,authenticated;
grant execute on function public.couranr_cancel_accepted_route_run(uuid,uuid,uuid,integer,uuid)
  to service_role;

-- Close cancel-vs-first-obligation race in BOTH orderings. A route payment
-- insert takes a SHARE lock on the accepted Route before its request FK lock.
-- If cancellation wins, the accepted evidence is gone and an unsubmitted draft
-- cannot mint an obligation on a formerly Route-approved quote. A later
-- standalone submission may use its own separately governed approval path.
create function private.couranr_guard_route_child_payment_start()
returns trigger language plpgsql security definer set search_path='' as $fn$
declare v_route_found boolean:=false;
begin
  perform r.id from public.couranr_route_run_stops s
    join public.couranr_route_run_versions v on v.id=s.route_version_id
    join public.couranr_route_runs r on r.id=v.route_run_id
    where s.request_id=new.request_id and s.quote_version_id=new.quote_version_id
      and r.accepted_version=v.version and r.route_state in ('accepted','cancelled')
    order by r.id for share of r;
  v_route_found:=found;
  if v_route_found
     and exists(select 1 from public.couranr_delivery_requests q
       where q.id=new.request_id and q.request_state='draft')
     and not exists(
       select 1 from public.couranr_route_run_claims c
       join public.couranr_route_runs r on r.id=c.route_run_id
       where c.request_id=new.request_id and r.route_state='accepted'
         and c.route_version_id in (
           select s.route_version_id from public.couranr_route_run_stops s
           where s.request_id=new.request_id and s.quote_version_id=new.quote_version_id
         )
     ) then
    raise exception 'route_child_quote_approval_released' using errcode='CR409';
  end if;
  return new;
end
$fn$;
revoke all on function private.couranr_guard_route_child_payment_start()
  from public,anon,authenticated,service_role;
create trigger couranr_guard_route_child_payment_start
  before insert or update of request_id,quote_version_id on public.couranr_payment_obligations
  for each row execute function private.couranr_guard_route_child_payment_start();

comment on function public.couranr_cancel_accepted_route_run(uuid,uuid,uuid,integer,uuid) is
  'RR-002 pre-execution release only. RR-003 must extend downstream checks before writing Route-owned payment or reservation artifacts.';
commit;
