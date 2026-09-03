-- =====================================================================
-- COURANR LEGACY ARITY FENCE — POSTDEPLOY ONLY (correction pass §2)
--
-- Retires the pre-batch 31/33-argument routed create/estimate commands that
-- 20260902200000 deliberately RETAINED for the zero-downtime deploy gap.
--
-- WHEN TO APPLY: only AFTER the new application SHA (which always states a
-- shipment-safety declaration and a weight statement) is serving and the
-- critical smoke has passed. Applying it earlier takes the still-deployed
-- old application down. Runbook:
-- docs/couranr-mvp/SMART_INTAKE_DEPLOY_CUTOVER.md
--
-- WHAT IT PROVES CLOSED: after this migration the old parameter shape can no
-- longer mint a commercial quote at all — 42883/PGRST202, not a policy
-- refusal — so every quote minted from here on went through the strict
-- arity's safety-declaration, weight-honesty and timing guards.
--
-- ADDITIVE-SAFETY: drops only the two superseded FUNCTION arities. No table,
-- no column, no row. Re-runnable (drop if exists). Reversible:
-- supabase/rollbacks/20260902220000_couranr_legacy_arity_fence.rollback.sql
-- restores both old arities verbatim (bodies from 20260902042602), which is
-- also the first step of any application rollback after cutover.
-- =====================================================================

begin;
set local statement_timeout = '60s';
set local lock_timeout = '10s';

do $guard$
begin
  /* The strict arities must exist before the old ones may be retired —
     otherwise this fence would leave the database with NO routed commands. */
  if to_regprocedure('public.couranr_create_routed_delivery_request_draft(uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text)') is null
     or to_regprocedure('public.couranr_calculate_routed_delivery_request_estimate(uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text)') is null then
    raise exception 'legacy_arity_fence_requires_strict_commands: apply 20260902200000 first';
  end if;
end
$guard$;

drop function if exists public.couranr_create_routed_delivery_request_draft(
  uuid,uuid,text,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
);

drop function if exists public.couranr_calculate_routed_delivery_request_estimate(
  uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb
);

commit;
