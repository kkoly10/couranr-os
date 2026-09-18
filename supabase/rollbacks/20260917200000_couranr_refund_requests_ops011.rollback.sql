-- =====================================================================
-- ROLLBACK — OPS-011 refund review substrate (20260917190000)
--
-- Removes the review layer and restores couranr_pr_reason_chk to the
-- five-value vocabulary 20260903020000 established.
--
-- EVIDENCE GUARD, twice over. A refund DECISION is commercial history in the
-- same way a refund attempt is: it records that Couranr Operations approved or
-- denied giving a payer their delivery charge back, who decided, and on what
-- figure. Dropping the table would erase that. And restoring the narrower
-- reason CHECK while any 'operations_reviewed_refund' attempt exists would
-- fail on the constraint anyway — or, worse, would leave the database
-- describing money it can no longer explain.
--
-- Both refuse rather than destroy. Forward repair only.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $evidence$
declare
  v_reviews  bigint;
  v_attempts bigint;
begin
  begin
    select count(*) into v_reviews from public.couranr_refund_requests;
  exception when undefined_table then
    v_reviews := 0;
  end;

  if v_reviews > 0 then
    raise exception
      'ops011_rollback_would_destroy_refund_decisions: % refund review decision(s) recorded; forward repair required',
      v_reviews;
  end if;

  begin
    select count(*) into v_attempts
      from public.couranr_payment_refunds
     where reason = 'operations_reviewed_refund';
  exception when undefined_table then
    v_attempts := 0;
  end;

  if v_attempts > 0 then
    raise exception
      'ops011_rollback_would_orphan_refund_attempts: % operations-reviewed refund attempt(s) exist; narrowing couranr_pr_reason_chk would make them unexplainable; forward repair required',
      v_attempts;
  end if;
end
$evidence$;

-- The triggers first, so nothing can write through them while the table goes.
drop trigger if exists couranr_refund_request_follow_attempt_trg
  on public.couranr_payment_refunds;
drop function if exists public.couranr_refund_request_follow_attempt();

drop trigger if exists couranr_refund_settlement_identity_guard_trg
  on public.couranr_payment_refunds;
drop function if exists public.couranr_refund_settlement_identity_guard();

drop function if exists public.couranr_begin_approved_refund(uuid,uuid);
drop function if exists public.couranr_approve_refund_request(uuid,uuid,integer,integer);
drop function if exists public.couranr_deny_refund_request(uuid,uuid,integer,text);
drop function if exists public.couranr_open_refund_request(uuid,uuid,text,text,text,uuid,uuid);

-- Proven empty by the evidence guard above. RESTRICT, never CASCADE: if
-- anything came to depend on this table the drop must fail loudly.
drop table if exists public.couranr_refund_requests restrict;

-- Restore the five-value vocabulary VERBATIM from 20260903020000
-- (extracted, not retyped).
alter table public.couranr_payment_refunds
  drop constraint if exists couranr_pr_reason_chk;
alter table public.couranr_payment_refunds
  add constraint couranr_pr_reason_chk check (reason in (
    'full_refund','cancel_before_confirmation',
    'cancel_after_confirmation_before_arrival','failed_pickup_after_arrival',
    'couranr_caused_failure'));

commit;
