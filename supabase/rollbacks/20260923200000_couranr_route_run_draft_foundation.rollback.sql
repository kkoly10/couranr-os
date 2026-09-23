-- Evidence-preserving rollback. Never discard even unsubmitted merchant drafts.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $guard$
begin
  if exists(select 1 from public.couranr_route_runs) or
     exists(select 1 from public.couranr_route_run_versions) or
     exists(select 1 from public.couranr_route_run_events) or
     exists(select 1 from public.couranr_route_run_stops) then
    raise exception 'route_draft_rollback_refuses_semantic_use';
  end if;
end
$guard$;
drop function public.couranr_save_route_run_draft(uuid,uuid,uuid,integer,uuid,text,uuid[]);
drop function public.couranr_read_route_run_draft(uuid,uuid,uuid);
drop function private.couranr_route_run_draft_view(uuid,integer);
drop function private.couranr_assert_route_run_member(uuid,uuid,boolean);
alter table public.couranr_route_runs drop constraint couranr_rr_current_version_fk;
drop table public.couranr_route_run_events;
drop table public.couranr_route_run_stops;
drop table public.couranr_route_run_versions;
drop table public.couranr_route_runs;
commit;
