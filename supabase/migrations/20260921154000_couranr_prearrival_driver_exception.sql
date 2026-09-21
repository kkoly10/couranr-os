-- Driver evidence before pickup arrival reuses the existing open pickup
-- discrepancy and Operations resolution substrate. No money or custody move.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$ begin
  if to_regclass('public.couranr_pickup_discrepancies') is null
     or to_regprocedure('public.couranr_report_pickup_discrepancy(uuid,uuid,text,text)') is null
     or not exists(select 1 from pg_constraint
                    where conrelid='public.couranr_pickup_discrepancies'::regclass
                      and conname='couranr_pd_reason_chk') then
    raise exception 'prearrival_exception_unknown_schema';
  end if;
end $$;

create or replace function public.couranr_report_pickup_discrepancy(
  p_delivery_id uuid,p_actor_user_id uuid,p_reason text,p_notes text
)
returns public.couranr_pickup_discrepancies
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_dlv public.couranr_deliveries;
  v_row public.couranr_pickup_discrepancies;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id,p_actor_user_id);
  select * into v_dlv from public.couranr_deliveries where id=p_delivery_id for update;
  if v_dlv.fulfillment_state not in ('assigned','en_route_to_pickup','at_pickup') then
    raise exception 'delivery_not_in_expected_state' using errcode='CR409';
  end if;
  select * into v_row from public.couranr_pickup_discrepancies
   where delivery_id=p_delivery_id and discrepancy_state='open';
  if found then return v_row; end if;
  insert into public.couranr_pickup_discrepancies(
    delivery_id,assignment_id,stage,reason,notes,discrepancy_state,
    reported_by_driver_id,reported_at
  ) values (
    p_delivery_id,v_asg.id,'pickup',p_reason,p_notes,'open',v_asg.driver_id,now()
  ) returning * into v_row;
  insert into public.couranr_delivery_events(
    delivery_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    p_delivery_id,p_actor_user_id,'driver','report_pickup_discrepancy',
    v_dlv.fulfillment_state,v_dlv.fulfillment_state,
    jsonb_build_object('discrepancyId',v_row.id,'reason',p_reason,
                       'reportedAtStage',v_dlv.fulfillment_state)
  );
  return v_row;
end
$fn$;
commit;
