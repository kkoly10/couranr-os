-- ROLLBACK for the Business Google routing authority.
--
-- Before routed semantic data exists, this returns the application to the
-- Foundation Gate A command pair. After even one routed quote exists it hard
-- refuses: dropping meters/outcomes would destroy commercial route evidence,
-- so rollback becomes an application compatibility deploy + forward repair.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
declare v_routed_quotes bigint;
begin
  select count(*) into v_routed_quotes
    from public.couranr_quote_versions
   where distance_source='google_routes_v2'
      or serviceability_outcome is not null;
  if v_routed_quotes > 0 then
    raise exception
      'refusing destructive routing-authority rollback: % routed quote(s). Preserve route evidence and deploy a forward repair.',
      v_routed_quotes;
  end if;
end
$guard$;

drop function public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,
  boolean,text,jsonb,jsonb,boolean,bigint,integer,text,text,text,text,text,integer,
  integer,numeric,jsonb,jsonb
) restrict;
drop function public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,
  jsonb,jsonb,boolean,bigint,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
) restrict;
drop function public.couranr_requote_routed_delivery_request(
  uuid,uuid,integer,uuid,text,integer,integer,numeric,jsonb,
  bigint,integer,text,text,text,text
) restrict;
drop function public.couranr_create_routed_quote_version(
  uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,text,text,text
) restrict;
drop function private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,text,text,text
) restrict;

grant execute on function public.couranr_create_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,numeric,integer,text,boolean,
  text,jsonb,jsonb,boolean,text,text,integer,integer,numeric,jsonb,jsonb
) to service_role;
grant execute on function public.couranr_calculate_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,numeric,
  integer,text,boolean,text,jsonb,jsonb,boolean,text,text,integer,integer,numeric,jsonb,jsonb
) to service_role;
grant execute on function public.couranr_create_quote_version(
  uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb
) to service_role;
grant execute on function public.couranr_requote_delivery_request(
  uuid,uuid,integer,uuid,text,integer,integer,numeric,jsonb,text
) to service_role;

alter table public.couranr_quote_versions
  drop constraint couranr_qv_google_route_evidence_chk,
  drop constraint couranr_qv_serviceability_outcome_chk,
  drop constraint couranr_qv_route_meters_chk,
  drop column serviceability_outcome,
  drop column route_distance_meters;

commit;
