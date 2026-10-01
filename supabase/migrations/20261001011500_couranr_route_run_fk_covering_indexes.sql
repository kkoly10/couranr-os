-- RR-003 follow-up: cover the foreign keys identified by the production
-- performance advisor after the additive Route settlement cutover. The Route
-- tables contain no production rows at this cut; no commercial data changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

do $$ begin
  if to_regclass('public.couranr_business_payment_setup_attempts') is null
    or to_regclass('public.couranr_route_run_settlements') is null
    or to_regclass('public.couranr_route_run_settlement_items') is null
    or to_regclass('public.couranr_route_run_settlement_events') is null
    or to_regclass('public.couranr_route_run_resource_reservations') is null
    or to_regclass('public.couranr_route_run_resource_events') is null then
    raise exception 'route_fk_indexes_require_rr003_schema';
  end if;
  if to_regclass('public.couranr_bpsa_completed_by_fk_idx') is not null
    or to_regclass('public.couranr_bpsa_actor_fk_idx') is not null
    or to_regclass('public.couranr_rrrese_actor_fk_idx') is not null
    or to_regclass('public.couranr_rrres_version_fk_idx') is not null
    or to_regclass('public.couranr_rrsette_actor_fk_idx') is not null
    or to_regclass('public.couranr_rrsetti_quote_fk_idx') is not null
    or to_regclass('public.couranr_rrsett_business_fk_idx') is not null
    or to_regclass('public.couranr_rrsett_confirmer_fk_idx') is not null
    or to_regclass('public.couranr_rrsett_uncertain_obligation_fk_idx') is not null
    or to_regclass('public.couranr_rrsett_version_fk_idx') is not null then
    raise exception 'route_fk_indexes_already_present_or_partially_applied';
  end if;
end $$;

create index couranr_bpsa_completed_by_fk_idx
  on public.couranr_business_payment_setup_attempts(completed_by_user_id);
create index couranr_bpsa_actor_fk_idx
  on public.couranr_business_payment_setup_attempts(actor_user_id);
create index couranr_rrrese_actor_fk_idx
  on public.couranr_route_run_resource_events(actor_user_id);
create index couranr_rrres_version_fk_idx
  on public.couranr_route_run_resource_reservations(route_version_id);
create index couranr_rrsette_actor_fk_idx
  on public.couranr_route_run_settlement_events(actor_user_id);
create index couranr_rrsetti_quote_fk_idx
  on public.couranr_route_run_settlement_items(quote_version_id);
create index couranr_rrsett_business_fk_idx
  on public.couranr_route_run_settlements(business_account_id);
create index couranr_rrsett_confirmer_fk_idx
  on public.couranr_route_run_settlements(confirmed_by);
create index couranr_rrsett_uncertain_obligation_fk_idx
  on public.couranr_route_run_settlements(provider_uncertain_obligation_id);
create index couranr_rrsett_version_fk_idx
  on public.couranr_route_run_settlements(route_run_id,route_version_id);
commit;
