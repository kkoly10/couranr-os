-- No tip/review history is disposable. After first use, forward repair only.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
  if exists(select 1 from public.couranr_driver_reviews)
     or exists(select 1 from public.couranr_driver_tips)
     or exists(select 1 from private.couranr_ledger_transactions
               where source_kind in ('tip','tip_refund')) then
    raise exception 'driver_feedback_rollback_refused_live_history_use_forward_repair';
  end if;
end $$;
drop function public.couranr_get_ledger_reconciliation();
alter function public.couranr_get_ledger_reconciliation_base()
  rename to couranr_get_ledger_reconciliation;
drop trigger couranr_driver_tip_ledger on public.couranr_driver_tips;
drop function private.couranr_post_driver_tip_ledger();
drop function public.couranr_settle_driver_tip(uuid,text,uuid,uuid,text,integer,integer,integer,text,boolean);
drop function public.couranr_attach_driver_tip_intent(uuid,text);
drop function public.couranr_prepare_driver_tip(uuid,text,text,uuid,uuid,integer);
drop function public.couranr_get_driver_feedback(uuid,text,text,uuid,uuid);
drop function public.couranr_submit_driver_review(uuid,text,text,uuid,uuid,integer,text);
drop function private.couranr_feedback_assignment(uuid,text,text,uuid,uuid);
drop table public.couranr_driver_reviews restrict;
drop table public.couranr_driver_tips restrict;
do $fn$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('private.couranr_post_ledger_transaction(text,text,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb)'::regprocedure);
  if position('p_source_kind not in (''capture'',''refund'',''cancellation_receivable'',''tip'',''tip_refund'')' in v_definition)=0 then
    raise exception 'ledger_source_guard_unrecognized';
  end if;
  execute replace(v_definition,
    'p_source_kind not in (''capture'',''refund'',''cancellation_receivable'',''tip'',''tip_refund'')',
    'p_source_kind not in (''capture'',''refund'',''cancellation_receivable'')');
end $fn$;
alter table private.couranr_ledger_transactions drop constraint couranr_ledger_transactions_source_kind_check;
alter table private.couranr_ledger_transactions add constraint couranr_ledger_transactions_source_kind_check
  check (source_kind in ('capture','refund','cancellation_receivable'));
commit;
