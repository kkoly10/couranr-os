-- ROLLBACK for Gate A M6.
-- Refuses after runtime quote use because removing the single-destination
-- contract would reopen a representation those accepted quotes never modeled.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $guard$
begin
  if exists(select 1 from public.couranr_quote_versions where record_origin='runtime') then
    raise exception 'unsafe rollback: runtime quotes exist under the one-destination doctrine; use a forward repair';
  end if;
end
$guard$;

drop trigger if exists couranr_dr_single_destination_trg on public.couranr_delivery_requests;
drop function if exists private.couranr_enforce_single_destination();
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_single_destination_chk,
  drop column if exists single_destination_contract;

comment on column public.couranr_delivery_requests.additional_stops is null;
comment on column public.couranr_delivery_requests.source is null;
comment on column public.couranr_delivery_requests.readiness_state is null;

commit;
