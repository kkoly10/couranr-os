-- RR-003 least-privilege read cutover. Route membership is not billing authority.
-- No money, Route state, provider or custody rows are changed by this migration.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

do $$ begin
  if to_regclass('public.couranr_route_run_settlements') is null
     or to_regclass('public.business_members') is null
     or to_regprocedure('public.couranr_read_route_run_settlement(uuid,uuid,uuid)') is null
     or to_regprocedure('private.couranr_assert_route_run_member(uuid,uuid,boolean)') is null then
    raise exception 'route_settlement_read_authority_requires_rr003';
  end if;
end $$;

-- The full projection is still required by the owner/manager checkout saga and
-- by billing readers. Re-read membership inside SQL; a stale browser role or
-- service-role caller carrying a former member's id cannot widen access.
create or replace function public.couranr_read_route_run_settlement(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare v_settlement public.couranr_route_run_settlements;
begin
  perform 1 from public.business_members m
    where m.business_account_id=p_business_account_id
      and m.user_id=p_actor_user_id and m.status='active'
      and m.role in ('owner','manager','billing') for share;
  if not found then
    raise exception 'route_billing_read_access_denied' using errcode='CR403';
  end if;
  select * into v_settlement from public.couranr_route_run_settlements
    where route_run_id=p_route_run_id and business_account_id=p_business_account_id;
  if not found then return null; end if;
  return private.couranr_route_settlement_view(v_settlement.id);
end
$fn$;

-- Operational Route progress is deliberately a different shape. It has no
-- settlement/item/obligation/provider identifiers, card evidence or amounts.
-- New settlement states fail closed to Operations review, not detailed money.
create function public.couranr_read_route_run_operational_settlement(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare v_state text;
begin
  perform private.couranr_assert_route_run_member(
    p_business_account_id,p_actor_user_id,false);
  select s.settlement_state into v_state
    from public.couranr_route_run_settlements s
    where s.route_run_id=p_route_run_id
      and s.business_account_id=p_business_account_id;
  if not found then return null; end if;
  return jsonb_build_object('status',case
    when v_state='ready_for_execution' then 'ready_for_execution'
    when v_state in ('pending_authorization','authorization_required',
      'authorized','resource_reserved','capture_pending','captured')
      then 'payment_pending'
    else 'operations_review'
  end);
end
$fn$;

revoke all on function public.couranr_read_route_run_settlement(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_read_route_run_settlement(uuid,uuid,uuid)
  to service_role;
revoke all on function public.couranr_read_route_run_operational_settlement(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_read_route_run_operational_settlement(uuid,uuid,uuid)
  to service_role;
commit;
