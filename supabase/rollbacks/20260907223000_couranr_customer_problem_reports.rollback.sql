-- Paired rollback for 20260907223000_couranr_customer_problem_reports.sql.
-- Customer problem reports/photos/events are operational evidence. Never
-- destroy them through rollback once any evidence exists.

begin;

do $$
begin
  if exists(select 1 from public.couranr_customer_problem_reports)
     or exists(select 1 from public.couranr_customer_problem_evidence)
     or exists(select 1 from public.couranr_customer_problem_report_events) then
    raise exception 'rollback_refused: customer problem-report evidence exists';
  end if;
end
$$;

drop function if exists public.couranr_transition_customer_problem_report(uuid,integer,uuid,text);
drop function if exists public.couranr_submit_customer_problem_report(uuid,uuid,text);
drop function if exists public.couranr_finalize_customer_problem_evidence(uuid,uuid,text,integer,text);
drop function if exists public.couranr_refresh_customer_problem_evidence(uuid,uuid,text);
drop function if exists public.couranr_prepare_customer_problem_evidence(uuid,uuid,uuid,text,text,integer,text);
drop function if exists public.couranr_save_customer_problem_draft(uuid,text,text);
drop function if exists public.couranr_customer_problem_report_view(uuid);

drop table if exists public.couranr_customer_problem_report_events;
drop table if exists public.couranr_customer_problem_evidence;
drop table if exists public.couranr_customer_problem_reports;

commit;
