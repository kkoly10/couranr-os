-- =====================================================================
-- ROLLBACK — Couranr Pricing Authority V2 traffic evidence
--
-- THIS ROLLBACK HARD-REFUSES once any Pricing V2 quote exists, and that is
-- the point rather than an inconvenience.
--
-- A quote version is immutable commercial evidence. Once a payer has been
-- shown, and possibly has authorized, a price that INCLUDED a traffic charge,
-- dropping the columns that justify that charge would leave a row asserting an
-- amount its own evidence can no longer explain. The money would survive and
-- the reason for it would not. That is not a rollback, it is quiet evidence
-- destruction, and the correct response to a bad V2 deploy at that point is a
-- forward repair.
--
-- Before any V2 quote exists there is nothing to destroy, so the rollback runs
-- and restores the Batch 1 routing functions exactly.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $refuse$
declare
  v_v2_quotes    bigint;
  v_traffic_rows bigint;
begin
  select count(*) into v_v2_quotes
    from public.couranr_quote_versions
   where pricing_policy_version = 'couranr-pricing-v2-2026-09-01';

  select count(*) into v_traffic_rows
    from public.couranr_quote_versions
   where route_traffic_delay_seconds is not null;

  if v_v2_quotes > 0 or v_traffic_rows > 0 then
    raise exception
      'pricing_v2_rollback_would_destroy_commercial_evidence'
      using errcode = 'CR409',
            detail  = format(
              '%s quote version(s) priced under couranr-pricing-v2-2026-09-01 and %s row(s) carrying traffic evidence. Dropping the traffic columns would leave those amounts unexplainable. Repair forward instead.',
              v_v2_quotes, v_traffic_rows);
  end if;
end
$refuse$;

-- No V2 evidence exists, so the added surface can be removed cleanly. The
-- functions are restored by re-running the Batch 1 migration, which is the
-- immediately preceding forward migration and is itself idempotent-guarded.
alter table public.couranr_quote_versions
  drop constraint if exists couranr_qv_traffic_delay_derived_chk;
alter table public.couranr_quote_versions
  drop constraint if exists couranr_qv_traffic_nonneg_chk;

alter table public.couranr_quote_versions
  drop column if exists route_traffic_delay_seconds;
alter table public.couranr_quote_versions
  drop column if exists route_static_duration_seconds;

drop function if exists public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,
  boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,
  integer,numeric,jsonb,jsonb
);
drop function if exists public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,
  jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
);
drop function if exists public.couranr_requote_routed_delivery_request(
  uuid,uuid,integer,uuid,text,integer,integer,numeric,jsonb,
  bigint,integer,integer,integer,text,text,text,text
);
drop function if exists public.couranr_create_routed_quote_version(
  uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text
);
drop function if exists private.couranr_append_routed_quote_version(
  uuid,uuid,integer,text,text,integer,integer,numeric,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text
);

commit;
