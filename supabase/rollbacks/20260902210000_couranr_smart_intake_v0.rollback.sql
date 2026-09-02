-- =====================================================================
-- ROLLBACK — Smart Intake V0 (P5-001)
--
-- ORDER MATTERS IF THE APPLICATION HAS ALREADY SHIPPED. The new application
-- calls every intake function by name; after this rollback those calls are
-- PGRST202s. Roll the APPLICATION back first, then run this.
--
-- EVIDENCE GUARD. Once intake facts have been COMMITTED to a canonical
-- request (a committed_to_request event exists), the intake evidence is part
-- of how a commercial quote came to exist. Destroying it would orphan the
-- quote's provenance — so this rollback HARD-REFUSES and requires forward
-- repair. On a database where intake was never committed it rolls back
-- completely, interpretation audit included: uncommitted interpretation
-- evidence belongs to the feature being removed, not to any commercial
-- record.
--
-- Idempotent: drop-if-exists throughout.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $evidence$
declare
  v_count bigint;
begin
  select count(*) into v_count
    from public.couranr_intake_fact_events
   where event = 'committed_to_request';
  if v_count > 0 then
    raise exception
      'smart_intake_rollback_would_orphan_commercial_provenance: % committed fact event(s); forward repair required',
      v_count;
  end if;
exception when undefined_table then
  null; -- already rolled back (or never applied)
end
$evidence$;

drop function if exists public.couranr_commit_intake_to_request(
  uuid,integer,uuid,uuid,integer,uuid,boolean,text,text,text,text,text,text,
  numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,
  integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,
  text,text,text,timestamptz,jsonb
);
drop function if exists public.couranr_record_intake_policy(uuid,uuid,text,jsonb,jsonb,jsonb,text,text,jsonb);
drop function if exists public.couranr_confirm_intake_fact(uuid,uuid,uuid,text,jsonb,text);
drop function if exists public.couranr_complete_intake_run(uuid,uuid,text,jsonb,text,integer,jsonb);
drop function if exists public.couranr_begin_intake_run(uuid,uuid,integer,text,text,text,text,jsonb);
drop function if exists public.couranr_add_intake_revision(uuid,uuid,uuid,text,integer,text);
drop function if exists public.couranr_create_intake_session(uuid,uuid,uuid,text,text);

drop table if exists public.couranr_intake_fact_events restrict;
drop table if exists public.couranr_intake_facts restrict;
drop table if exists public.couranr_intake_runs restrict;
drop table if exists public.couranr_intake_description_revisions restrict;
drop table if exists public.couranr_intake_sessions restrict;

commit;
