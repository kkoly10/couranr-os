-- RR-001 production hardening: cover every new Route Run foreign-key lookup.
-- The tables are draft-only and currently empty; this is additive and changes
-- no Route Run semantics, authority, pricing, payment, dispatch or custody.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$ begin
  if to_regclass('public.couranr_route_runs') is null
     or to_regclass('public.couranr_route_run_versions') is null
     or to_regclass('public.couranr_route_run_stops') is null
     or to_regclass('public.couranr_route_run_events') is null then
    raise exception 'route_run_index_hardening_requires_foundation';
  end if;
end $$;

create index if not exists couranr_rr_created_by_idx
  on public.couranr_route_runs(created_by);
create index if not exists couranr_rr_current_version_idx
  on public.couranr_route_runs(id,current_version);
create index if not exists couranr_rrv_created_by_idx
  on public.couranr_route_run_versions(created_by);
create index if not exists couranr_rrs_request_idx
  on public.couranr_route_run_stops(request_id);
create index if not exists couranr_rrs_quote_idx
  on public.couranr_route_run_stops(quote_version_id);
create index if not exists couranr_rre_route_idx
  on public.couranr_route_run_events(route_run_id);
create index if not exists couranr_rre_actor_idx
  on public.couranr_route_run_events(actor_user_id);

commit;
