-- Only an empty semantic rollback is safe. Once a merchant attested that the
-- Route cargo was ready, keep the audit and use an application rollback or
-- forward repair instead of deleting the command's meaning.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
lock table public.couranr_route_run_settlements,
  public.couranr_route_run_settlement_events in access exclusive mode;
do $$ begin
  if exists(select 1 from public.couranr_route_run_settlement_events
    where event_type='pickup_ready_confirmed') then
    raise exception 'route_pickup_readiness_rollback_refuses_semantic_use';
  end if;
end $$;

drop function public.couranr_confirm_route_pickup_ready(uuid,uuid,uuid,integer,boolean);
alter table public.couranr_route_run_settlement_events
  drop constraint couranr_rrsette_type_chk;
alter table public.couranr_route_run_settlement_events
  add constraint couranr_rrsette_type_chk check(event_type in (
    'checkout_confirmed','authorization_attempt_started','provider_uncertain','provider_reconciled',
    'authorization_state_changed','resource_reserved','capture_state_changed',
    'recovery_required','ready_for_execution','checkout_cancelled'
  ));

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
    raise exception 'route_child_claimed' using errcode='CR409';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$fn$;
commit;
