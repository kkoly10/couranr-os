-- Compatibility rollback only before ANY semantic cancellation. Once a Route
-- has been cancelled, preserve its immutable history and forward-repair.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';
do $$ begin
  if exists(select 1 from public.couranr_route_runs where route_state='cancelled')
     or exists(select 1 from public.couranr_route_run_events where command='cancel_accepted_route') then
    raise exception 'route_cancellation_rollback_refuses_semantic_history';
  end if;
end $$;

drop trigger couranr_guard_route_child_payment_start on public.couranr_payment_obligations;
drop function private.couranr_guard_route_child_payment_start();
drop function public.couranr_cancel_accepted_route_run(uuid,uuid,uuid,integer,uuid);

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
    'abandonedAt',r.abandoned_at,
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

alter table public.couranr_route_run_events drop constraint couranr_route_run_events_command_check;
alter table public.couranr_route_run_events add constraint couranr_route_run_events_command_check
  check(command in ('create_route_draft','revise_route_draft','accept_route_run','abandon_route_draft'));
alter table public.couranr_route_runs drop constraint couranr_rr_acceptance_shape_chk;
alter table public.couranr_route_runs add constraint couranr_rr_acceptance_shape_chk check (
  (route_state='draft' and accepted_version is null and accepted_at is null and accepted_by is null
    and abandoned_at is null and abandoned_by is null)
  or (route_state='accepted' and accepted_version is not null and accepted_at is not null and accepted_by is not null
    and accept_idempotency_key is not null and abandoned_at is null and abandoned_by is null)
  or (route_state='abandoned' and accepted_version is null and accepted_at is null and accepted_by is null
    and abandoned_at is not null and abandoned_by is not null and abandon_idempotency_key is not null)
);
alter table public.couranr_route_runs drop constraint couranr_route_runs_route_state_check;
alter table public.couranr_route_runs add constraint couranr_route_runs_route_state_check
  check(route_state in ('draft','accepted','abandoned'));
drop index public.couranr_rr_cancelled_by_idx;
alter table public.couranr_route_runs
  drop column cancelled_at,drop column cancelled_by,drop column cancel_idempotency_key;
commit;
