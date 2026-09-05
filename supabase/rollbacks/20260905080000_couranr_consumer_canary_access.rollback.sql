-- Roll back the /send production-canary access control objects.
-- Refuse if any canary access evidence exists; those rows are release audit.

begin;

do $guard$
begin
  if to_regclass('public.couranr_consumer_canary_access') is not null
     and exists (select 1 from public.couranr_consumer_canary_access) then
    raise exception 'refusing to drop consumer canary access with evidence';
  end if;
end
$guard$;

drop function if exists public.couranr_revoke_consumer_canary_access(uuid);
drop function if exists public.couranr_claim_consumer_canary_estimate(uuid);
drop function if exists public.couranr_claim_consumer_canary_place_search(uuid);
drop function if exists public.couranr_create_consumer_canary_guest_session(text,text,integer);
drop function if exists public.couranr_resolve_consumer_canary_cookie(text);
drop function if exists public.couranr_redeem_consumer_canary_access(text,text);
drop function if exists public.couranr_issue_consumer_canary_access(text,integer,text);
drop table if exists public.couranr_consumer_canary_access restrict;

commit;
