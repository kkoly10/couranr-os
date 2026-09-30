-- RR-003d: one explicit merchant pickup-readiness attestation for every
-- authorized child. The existing readiness command remains the only writer;
-- this Route command supplies narrowly scoped admission and an atomic group.
-- No provider I/O, planning, capture, delivery, assignment or custody.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

do $$ begin
  if to_regclass('public.couranr_route_run_settlements') is null
     or to_regprocedure('public.couranr_mark_delivery_ready(uuid,uuid,integer,uuid)') is null then
    raise exception 'route_pickup_readiness_requires_rr003b';
  end if;
end $$;

create or replace function private.couranr_guard_accepted_route_child()
returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
  if exists (
    select 1 from public.couranr_route_run_claims c
    join public.couranr_route_runs r on r.id=c.route_run_id
    where c.request_id=old.id and r.route_state='accepted'
  ) then
    if tg_op='UPDATE'
       and current_setting('couranr.route_checkout_request_id',true)=old.id::text
       and old.request_state='draft' and new.request_state='confirmed'
       and old.submitted_at is null and new.submitted_at is not null
       and new.version=old.version+1
       and (to_jsonb(new)-array['request_state','version','submitted_at','updated_at'])
           =(to_jsonb(old)-array['request_state','version','submitted_at','updated_at'])
       and exists(
         select 1 from public.couranr_route_run_claims c
         join public.couranr_route_run_settlements s
           on s.route_run_id=c.route_run_id and s.route_version_id=c.route_version_id
         join public.couranr_route_run_settlement_items i
           on i.settlement_id=s.id and i.request_id=old.id
         where c.request_id=old.id and s.settlement_state='pending_authorization'
           and i.quote_version_id=old.current_quote_version_id
       ) then
      return new;
    end if;
    if tg_op='UPDATE'
       and current_setting('couranr.route_readiness_request_id',true)=old.id::text
       and old.request_state='confirmed' and new.request_state='confirmed'
       and old.readiness_state in ('not_confirmed','preparing','not_ready','unavailable')
       and new.readiness_state='ready' and new.version=old.version+1
       and (to_jsonb(new)-array['readiness_state','version','updated_at'])
           =(to_jsonb(old)-array['readiness_state','version','updated_at'])
       and exists(
         select 1 from public.couranr_route_run_claims c
         join public.couranr_route_run_settlements s
           on s.route_run_id=c.route_run_id and s.route_version_id=c.route_version_id
         join public.couranr_route_run_settlement_items i
           on i.settlement_id=s.id and i.request_id=old.id
         join public.couranr_payment_obligations o on o.id=i.obligation_id
         where c.request_id=old.id and s.settlement_state='authorized'
           and i.quote_version_id=old.current_quote_version_id
           and o.payment_state='authorized'
       ) then
      return new;
    end if;
    raise exception 'route_child_claimed' using errcode='CR409';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$fn$;

alter table public.couranr_route_run_settlement_events
  drop constraint couranr_rrsette_type_chk;
alter table public.couranr_route_run_settlement_events
  add constraint couranr_rrsette_type_chk check(event_type in (
    'checkout_confirmed','authorization_attempt_started','provider_uncertain','provider_reconciled',
    'authorization_state_changed','resource_reserved','capture_state_changed',
    'recovery_required','ready_for_execution','checkout_cancelled','pickup_ready_confirmed'
  ));

create function public.couranr_confirm_route_pickup_ready(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_expected_version integer,p_acknowledged boolean
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_settlement public.couranr_route_run_settlements;
  v_item record;
  v_req public.couranr_delivery_requests;
  v_result public.couranr_delivery_requests;
  v_count integer:=0;
begin
  perform private.couranr_require_route_checkout_member(p_business_account_id,p_actor_user_id);
  if p_acknowledged is distinct from true then
    raise exception 'route_pickup_confirmation_required' using errcode='CR422';
  end if;
  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id and business_account_id=p_business_account_id for update;
  if not found then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
  if v_route.route_state<>'accepted' or v_route.accepted_version is distinct from p_expected_version
     or v_route.current_version is distinct from p_expected_version then
    raise exception 'route_version_conflict' using errcode='CR409';
  end if;
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=v_route.id for update;
  if not found or v_settlement.settlement_state<>'authorized'
     or v_settlement.route_version_id is distinct from (
       select id from public.couranr_route_run_versions
        where route_run_id=v_route.id and version=v_route.accepted_version) then
    raise exception 'route_pickup_requires_authorization' using errcode='CR409';
  end if;
  if exists(select 1 from public.couranr_route_run_settlement_events
    where settlement_id=v_settlement.id and event_type='pickup_ready_confirmed') then
    if exists(select 1 from public.couranr_route_run_settlement_items i
      join public.couranr_delivery_requests q on q.id=i.request_id
      where i.settlement_id=v_settlement.id
        and (q.readiness_state<>'ready'
          or q.current_quote_version_id is distinct from i.quote_version_id)) then
      raise exception 'route_pickup_replay_child_drift' using errcode='CR409';
    end if;
    return jsonb_build_object('outcome','already_ready','routeRunId',v_route.id,
      'routeVersionId',v_settlement.route_version_id,
      'childCount',(select count(*) from public.couranr_route_run_settlement_items
        where settlement_id=v_settlement.id));
  end if;

  -- Lock every child before changing any. The SQL transaction rolls the
  -- whole group back if any child has drifted, including its independent
  -- pickup-manifest generation or exact immutable quote identity.
  perform q.id from public.couranr_route_run_settlement_items i
    join public.couranr_delivery_requests q on q.id=i.request_id
    where i.settlement_id=v_settlement.id order by q.id for update of q;
  for v_item in
    select i.*,s.pickup_manifest_version
      from public.couranr_route_run_settlement_items i
      join public.couranr_route_run_stops s
        on s.route_version_id=v_settlement.route_version_id and s.request_id=i.request_id
     where i.settlement_id=v_settlement.id order by i.sequence
  loop
    v_count:=v_count+1;
    select * into strict v_req from public.couranr_delivery_requests where id=v_item.request_id;
    if v_req.request_state<>'confirmed' or v_req.readiness_state='ready'
       or v_req.current_quote_version_id is distinct from v_item.quote_version_id
       or v_req.pickup_manifest_version is distinct from v_item.pickup_manifest_version
       or not exists(select 1 from public.couranr_payment_obligations o
         where o.id=v_item.obligation_id and o.request_id=v_req.id
           and o.quote_version_id=v_item.quote_version_id and o.payment_state='authorized') then
      raise exception 'route_pickup_child_stale_or_unpaid' using errcode='CR409';
    end if;
    perform set_config('couranr.route_readiness_request_id',v_req.id::text,true);
    select * into v_result from public.couranr_mark_delivery_ready(
      v_req.id,p_business_account_id,v_req.version,p_actor_user_id);
    perform set_config('couranr.route_readiness_request_id','',true);
  end loop;
  if v_count not between 2 and 5 or v_count<>(select stop_count
    from public.couranr_route_run_versions where id=v_settlement.route_version_id) then
    raise exception 'route_pickup_stop_count_mismatch' using errcode='CR409';
  end if;
  insert into public.couranr_route_run_settlement_events(
    settlement_id,actor_user_id,event_type,detail)
  values(v_settlement.id,p_actor_user_id,'pickup_ready_confirmed',
    jsonb_build_object('routeVersionId',v_settlement.route_version_id,'childCount',v_count));
  return jsonb_build_object('outcome','ready','routeRunId',v_route.id,
    'routeVersionId',v_settlement.route_version_id,'childCount',v_count);
end
$fn$;
revoke all on function public.couranr_confirm_route_pickup_ready(uuid,uuid,uuid,integer,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_confirm_route_pickup_ready(uuid,uuid,uuid,integer,boolean)
  to service_role;

commit;
