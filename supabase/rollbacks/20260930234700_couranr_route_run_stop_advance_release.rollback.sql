-- Refuse to remove terminal resource authority after any Route execution.
-- Forward repair/application rollback preserves money and custody history.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
lock table public.couranr_route_run_executions,
  public.couranr_route_run_execution_events,
  public.couranr_route_run_resource_reservations in access exclusive mode;
do $$ begin
  if exists(select 1 from public.couranr_route_run_executions)
    or exists(select 1 from public.couranr_route_run_execution_events)
    or exists(select 1 from public.couranr_route_run_resource_reservations
      where resource_state='released'
        and release_reason='route_execution_completed') then
    raise exception 'route_terminal_release_rollback_refuses_semantic_use';
  end if;
end $$;
drop function public.couranr_complete_route_run_execution(uuid,uuid);
drop function public.couranr_resolve_route_run_exception(uuid,uuid,text);
drop function public.couranr_advance_route_run_stop(uuid,uuid);
drop function private.couranr_release_terminal_route_execution(uuid,uuid);
-- Restore the RR-003 checkout/readiness child guard, not the older RR-002
-- blanket guard. Empty reversal must not break accepted Route checkout.
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
end $fn$;
revoke all on function private.couranr_guard_accepted_route_child()
  from public,anon,authenticated,service_role;
commit;
