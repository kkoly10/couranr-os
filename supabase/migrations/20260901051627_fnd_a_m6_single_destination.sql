-- =====================================================================
-- FOUNDATION GATE A / M6
-- One canonical delivery request = one destination.
--
-- Historical additional_stops values are preserved. Every newly inserted row
-- is subject to the single-destination contract and must be zero. Future
-- multi-stop routing belongs to a route aggregate grouping multiple delivery
-- records, not this integer. No route-run table is created here.
--
-- THIS MIGRATION REFUSES TO RUN AGAINST UNCLASSIFIED HISTORICAL STOPS.
--
-- It previously grandfathered them: it added the column, then set
-- `single_destination_contract = (additional_stops = 0)`, so any row with a
-- positive value silently became `false` and passed the CHECK. That is the
-- wrong default for a production cutover. A row with additional_stops > 0 is
-- a request whose commercial and fulfillment meaning under the new one-
-- destination doctrine is UNKNOWN — it may have been quoted, paid for, or
-- delivered as a multi-stop trip — and quietly stamping it "not a single
-- destination contract" records a classification nobody made. The migration
-- would report success and the ambiguity would survive as data.
--
-- The production-cutover doctrine is: UNKNOWN POSITIVE additional_stops ROWS
-- ARE NEVER SILENTLY GRANDFATHERED. For this Gate A cutover the rule is the
-- simplest safe one — M6 requires ZERO positive rows. If any exist the
-- migration raises before touching the schema, names them by safe metadata
-- only, and changes nothing. Deleting them, editing them, or marking them
-- grandfathered are all decisions for an explicit reviewed classification
-- mechanism, not for this file.
-- =====================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $guard$
declare
  v_rows   bigint;
  v_oldest timestamptz;
  v_newest timestamptz;
  v_states text;
  v_sources text;
begin
  if to_regclass('public.couranr_delivery_requests') is null then
    raise exception 'Gate A M6 requires canonical requests';
  end if;
  if exists(select 1 from information_schema.columns
    where table_schema='public' and table_name='couranr_delivery_requests'
      and column_name='single_destination_contract') then
    raise exception 'single_destination_contract already exists; refusing a partial application';
  end if;

  /* The preflight. `additional_stops` is `integer not null default 0` with a
     `>= 0` check (20260731045417), so `> 0` is a TOTAL predicate here — there
     is no NULL third case to leak past it. That is asserted rather than
     assumed because the whole guarantee rests on it.

     Reported by safe metadata only: a count, a date range, the lifecycle
     states and the sources. No recipient name, phone, email or address goes
     into an exception message — those reach logs, and a migration failure is
     exactly when everyone reads the logs. */
  select count(*), min(created_at), max(created_at),
         coalesce(string_agg(distinct request_state, ','), '(none)'),
         coalesce(string_agg(distinct source, ','), '(none)')
    into v_rows, v_oldest, v_newest, v_states, v_sources
    from public.couranr_delivery_requests
   where additional_stops > 0;

  if v_rows > 0 then
    raise exception 'gate_a_m6_refuses_unclassified_additional_stops'
      using errcode = 'CR409',
        detail = format(
          '%s canonical request(s) carry additional_stops > 0. created_at %s .. %s; request_state: %s; source: %s.',
          v_rows, v_oldest, v_newest, v_states, v_sources),
        hint = 'M6 will not silently grandfather these rows. Classify them through an explicit, reviewed historical-classification mechanism first. Do not delete or edit them to get past this guard.';
  end if;
end
$guard$;

alter table public.couranr_delivery_requests
  add column single_destination_contract boolean;

/* `true`, not `(additional_stops = 0)`.
   The guard above has already proven every row is zero, so the two are
   equivalent TODAY — but the expression form is the silent-grandfather bug
   itself, and leaving it in place means deleting the guard quietly restores
   the old behaviour instead of failing loudly. A literal cannot do that. */
update public.couranr_delivery_requests
   set single_destination_contract = true
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
