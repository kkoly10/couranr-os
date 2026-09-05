-- Rollback for 20260905170000_couranr_financial_ledger_v1.sql.
--
-- Financial evidence is append-only. Once any ledger transaction exists the
-- rollback refuses rather than deleting or orphaning commercial evidence.

begin;

do $$
declare v_count bigint;
begin
  if to_regclass('private.couranr_ledger_transactions') is not null then
    execute 'select count(*) from private.couranr_ledger_transactions' into v_count;
    if v_count > 0 then
      raise exception using
        errcode='CR409',
        message='ledger_rollback_would_destroy_financial_evidence';
    end if;
  end if;
end;
$$;

drop trigger if exists couranr_ledger_capture_trg on public.couranr_payment_obligations;
drop trigger if exists couranr_ledger_refund_trg on public.couranr_payment_refunds;
drop trigger if exists couranr_ledger_cancellation_receivable_trg on public.couranr_payment_events;

drop function if exists public.couranr_get_ledger_reconciliation();
drop function if exists private.couranr_ledger_post_capture();
drop function if exists private.couranr_ledger_post_refund();
drop function if exists private.couranr_ledger_post_cancellation_receivable();
drop function if exists private.couranr_post_ledger_transaction(
  text,text,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb
);

drop table if exists private.couranr_ledger_entries restrict;
drop table if exists private.couranr_ledger_transactions restrict;
drop table if exists private.couranr_ledger_accounts restrict;

commit;
