-- Index-only rollback is data-preserving, including after semantic Route use.
-- It may degrade FK maintenance performance, so forward repair is preferred.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';
do $$ begin
  if to_regclass('public.couranr_bpsa_completed_by_fk_idx') is null
    or to_regclass('public.couranr_bpsa_actor_fk_idx') is null
    or to_regclass('public.couranr_rrrese_actor_fk_idx') is null
    or to_regclass('public.couranr_rrres_version_fk_idx') is null
    or to_regclass('public.couranr_rrsette_actor_fk_idx') is null
    or to_regclass('public.couranr_rrsetti_quote_fk_idx') is null
    or to_regclass('public.couranr_rrsett_business_fk_idx') is null
    or to_regclass('public.couranr_rrsett_confirmer_fk_idx') is null
    or to_regclass('public.couranr_rrsett_uncertain_obligation_fk_idx') is null
    or to_regclass('public.couranr_rrsett_version_fk_idx') is null then
    raise exception 'route_fk_index_rollback_requires_complete_forward_stage';
  end if;
end $$;
drop index public.couranr_rrsett_version_fk_idx;
drop index public.couranr_rrsett_uncertain_obligation_fk_idx;
drop index public.couranr_rrsett_confirmer_fk_idx;
drop index public.couranr_rrsett_business_fk_idx;
drop index public.couranr_rrsetti_quote_fk_idx;
drop index public.couranr_rrsette_actor_fk_idx;
drop index public.couranr_rrres_version_fk_idx;
drop index public.couranr_rrrese_actor_fk_idx;
drop index public.couranr_bpsa_actor_fk_idx;
drop index public.couranr_bpsa_completed_by_fk_idx;
commit;
