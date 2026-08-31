-- =====================================================================
-- FOUNDATION GATE A / M6
-- One canonical delivery request = one destination.
--
-- Historical additional_stops values are preserved. Rows that already carry
-- a positive value are explicitly grandfathered; every newly inserted row is
-- subject to the single-destination contract and must be zero. Future
-- multi-stop routing belongs to a route aggregate grouping multiple delivery
-- records, not this integer. No route-run table is created here.
-- =====================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $guard$
begin
  if to_regclass('public.couranr_delivery_requests') is null then
    raise exception 'Gate A M6 requires canonical requests';
  end if;
  if exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='couranr_delivery_requests'
      and column_name='single_destination_contract') then
    raise exception 'single_destination_contract already exists; refusing a partial application';
  end if;
end
$guard$;

alter table public.couranr_delivery_requests
  add column single_destination_contract boolean;

-- Preserve historical positive values without blessing them as future design.
update public.couranr_delivery_requests
   set single_destination_contract = (additional_stops = 0)
 where single_destination_contract is null;

alter table public.couranr_delivery_requests
  alter column single_destination_contract set default true,
  alter column single_destination_contract set not null,
  add constraint couranr_dr_single_destination_chk check (
    not single_destination_contract or additional_stops = 0
  );

comment on column public.couranr_delivery_requests.additional_stops is
  'Historical compatibility only. New canonical V0 requests must be zero. Future multi-stop is a route aggregate of multiple one-destination deliveries.';
comment on column public.couranr_delivery_requests.single_destination_contract is
  'True for all new Gate A requests: this request can produce exactly one destination fulfillment.';
comment on column public.couranr_delivery_requests.source is
  'Where the request originated. smart_intake is historical only; Smart Intake is future enrichment provenance, not a new-request source identity.';
comment on column public.couranr_delivery_requests.readiness_state is
  'Pickup readiness. Business merchants currently assert it; consumer pickup readiness will reuse this same state machine.';

create function private.couranr_enforce_single_destination()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
begin
  if tg_op='INSERT' then
    if new.single_destination_contract is distinct from true
       or new.additional_stops is distinct from 0 then
      raise exception 'new_delivery_request_requires_one_destination' using errcode='CR422';
    end if;
  elsif new.additional_stops>0
        and (old.single_destination_contract
             or new.additional_stops is distinct from old.additional_stops) then
    raise exception 'additional_stops_is_historical_only' using errcode='CR422';
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_enforce_single_destination()
  from public,anon,authenticated,service_role;
grant execute on function private.couranr_enforce_single_destination() to service_role;

create trigger couranr_dr_single_destination_trg
before insert or update on public.couranr_delivery_requests
for each row execute function private.couranr_enforce_single_destination();

commit;
