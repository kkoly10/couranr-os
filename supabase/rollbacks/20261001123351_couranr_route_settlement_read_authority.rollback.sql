-- Empty-schema compatibility rollback only: the old function exposed billing
-- details to all Route members. Refuse after any settlement exists, including
-- pre-existing rows. Use application compatibility/forward repair in production.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
do $$ begin
  if to_regprocedure('public.couranr_read_route_run_operational_settlement(uuid,uuid,uuid)') is null
     or to_regprocedure('public.couranr_read_route_run_settlement(uuid,uuid,uuid)') is null then
    raise exception 'route_settlement_read_authority_rollback_requires_forward_stage';
  end if;
  if exists(select 1 from public.couranr_route_run_settlements) then
    raise exception 'route_settlement_read_authority_rollback_refuses_semantic_history';
  end if;
end $$;
drop function public.couranr_read_route_run_operational_settlement(uuid,uuid,uuid);
create or replace function public.couranr_read_route_run_settlement(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare v_settlement public.couranr_route_run_settlements;
begin
  perform private.couranr_assert_route_run_member(p_business_account_id,p_actor_user_id,false);
  select * into v_settlement from public.couranr_route_run_settlements
    where route_run_id=p_route_run_id and business_account_id=p_business_account_id;
  if not found then return null; end if;
  return private.couranr_route_settlement_view(v_settlement.id);
end
$fn$;
revoke all on function public.couranr_read_route_run_settlement(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_read_route_run_settlement(uuid,uuid,uuid)
  to service_role;
commit;
