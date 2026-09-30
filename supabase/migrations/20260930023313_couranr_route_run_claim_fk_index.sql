-- Cover the composite FK couranr_rrc_route_version_fk without deleting older
-- indexes: they may serve other reads and zero-row usage is not evidence.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
  if to_regclass('public.couranr_route_run_claims') is null then
    raise exception 'route_claim_index_requires_rr002';
  end if;
end $$;
create index if not exists couranr_rrc_route_version_idx
  on public.couranr_route_run_claims(route_run_id,route_version_id);
commit;
