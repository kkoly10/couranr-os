-- Roll back 20260904175646_couranr_mapbox_routing_cutover.
-- Historical Mapbox route evidence is immutable. Refuse once any Mapbox quote
-- or paid usage exists; roll forward instead of rewriting commercial evidence.
begin;

do $$
begin
  if exists(
    select 1 from public.couranr_quote_versions
     where distance_source='mapbox_directions_v5'
  )
  or exists(
    select 1 from public.couranr_external_api_usage_daily
     where api_key='mapbox_directions' and request_count>0
  ) then
    raise exception 'refusing to restore Google-only routing constraint: Mapbox evidence exists';
  end if;
end $$;

delete from public.couranr_external_api_budgets
 where api_key='mapbox_directions';

update public.couranr_external_api_budgets
   set active=true,updated_at=now()
 where api_key='google_routes_compute_routes';

alter table public.couranr_quote_versions
  drop constraint if exists couranr_qv_route_evidence_chk;
alter table public.couranr_quote_versions
  add constraint couranr_qv_google_route_evidence_chk check (
    serviceability_outcome is null
    or (
      distance_source='google_routes_v2'
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
