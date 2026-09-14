-- =====================================================================
-- COURANR HOSTED LEGACY ARITY FENCE — POSTDEPLOY ONLY
--
-- Retires the pre-timing 13-argument create and 26-argument validate hosted
-- commands that 20260908220000 deliberately RETAINED for the zero-downtime
-- deploy gap.
--
-- WHEN TO APPLY: only AFTER the new application SHA (which always states a
-- timing intent for hosted requests) is serving. Applying it earlier takes
-- the still-deployed old application's hosted submit and merchant validation
-- down. Runbook: docs/couranr-mvp/HOSTED_TIMING_DEPLOY_CUTOVER.md
--
-- WHAT IT PROVES CLOSED: after this migration the old parameter shape can no
-- longer create or validate a hosted request at all — 42883/PGRST202, not a
-- policy refusal — so every hosted request from here on carries an explicit
-- timing statement that passed the two-sided TMZ-001 assertion.
--
-- ADDITIVE-SAFETY: drops only the two superseded FUNCTION arities. No table,
-- no column, no row. Re-runnable (drop if exists). Reversible:
-- supabase/rollbacks/20260908230000_couranr_hosted_legacy_arity_fence.rollback.sql
-- restores both old arities verbatim (bodies from 20260905040000), which is
-- also the first database step of any application rollback after cutover.
-- =====================================================================

begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';

do $guard$
begin
  /* The strict arities must exist before the old ones may be retired —
     otherwise this fence would leave the database with NO hosted commands. */
  if to_regprocedure('public.couranr_create_hosted_delivery_request(uuid,text,text,text,text,text,text,text,numeric,text,text,boolean,text,text,text,timestamptz,jsonb)') is null
     or to_regprocedure('public.couranr_validate_hosted_delivery_request(uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,timestamptz,jsonb)') is null then
    raise exception 'hosted_legacy_arity_fence_requires_strict_commands: apply 20260908220000 first';
  end if;
end
$guard$;

drop function if exists public.couranr_create_hosted_delivery_request(
  uuid,text,text,text,text,text,text,text,numeric,text,text,boolean,text
);

drop function if exists public.couranr_validate_hosted_delivery_request(
  uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb
);

commit;
