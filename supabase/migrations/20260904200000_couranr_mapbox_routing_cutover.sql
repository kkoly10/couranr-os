-- ============================================================================
-- Mapbox routing authority cutover
--
-- Google Places remains the canonical address identity provider. Routing,
-- distance and traffic move to Mapbox Directions v5 / driving-traffic.
-- Historical Google route evidence remains valid and immutable.
-- ============================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

insert into public.couranr_external_api_budgets(api_key,daily_limit,active)
values ('mapbox_directions',50,true)
on conflict(api_key) do update
set daily_limit=excluded.daily_limit,
    active=true,
    updated_at=now();

update public.couranr_external_api_budgets
   set active=false,updated_at=now()
 where api_key='google_routes_compute_routes';

alter table public.couranr_quote_versions
  drop constraint if exists couranr_qv_google_route_evidence_chk;
alter table public.couranr_quote_versions
  drop constraint if exists couranr_qv_route_evidence_chk;
alter table public.couranr_quote_versions
  add constraint couranr_qv_route_evidence_chk check (
    serviceability_outcome is null
    or (
      distance_source in ('google_routes_v2','mapbox_directions_v5')
      and (
        (
          serviceability_outcome='available_for_request'
          and route_distance_meters is not null
          and loaded_distance_miles is not null
          and route_duration_seconds is not null
        )
        or (
          serviceability_outcome='needs_review'
          and (
            (
              route_distance_meters is null
              and loaded_distance_miles is null
              and route_duration_seconds is null
            )
            or (
              route_distance_meters is not null
              and loaded_distance_miles is not null
              and route_duration_seconds is not null
            )
          )
        )
      )
    )
  );

commit;
