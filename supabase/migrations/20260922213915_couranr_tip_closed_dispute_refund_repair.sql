-- Forward repair for TIP-001 provider reconciliation.
--
-- Stripe retains a won, prevented, or warning-closed dispute as historical
-- charge evidence after a later refund. Those non-loss dispute amounts are
-- bounded by the captured charge, not by the charge's remaining unrefunded
-- principal. Open disputes and lost disputes keep the stricter non-overlap
-- rule because the current tip ledger has no overlap-allocation model.
--
-- No rows are rewritten. The command remains service-role-only and keeps the
-- existing capture/refund/dispute ledger trigger as the money authority.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $guard$
declare v_definition text;
begin
  if to_regclass('public.couranr_driver_tips') is null
     or to_regprocedure('public.couranr_settle_driver_tip(uuid,text,uuid,uuid,text,integer,integer,integer,text,text,text,integer)') is null then
    raise exception 'tip_closed_dispute_repair_unknown_schema';
  end if;
  v_definition:=regexp_replace(
    pg_get_functiondef('public.couranr_settle_driver_tip(uuid,text,uuid,uuid,text,integer,integer,integer,text,text,text,integer)'::regprocedure),
    '\s','','g');
  if position('v_dispute_amount>v_capture-v_refund' in v_definition)=0 then
    raise exception 'tip_closed_dispute_repair_unrecognized_settlement_function';
  end if;
end
$guard$;

-- EXCLUSIVE conflicts with the ROW SHARE lock acquired by SELECT ... FOR
-- UPDATE inside the settlement command, so no in-flight old command can cross
-- the function cutover. Plain SHARE ROW EXCLUSIVE does not provide that fence.
lock table public.couranr_driver_tips in exclusive mode;

create or replace function public.couranr_settle_driver_tip(
  p_tip_id uuid,p_intent_id text,p_delivery_id uuid,p_driver_id uuid,
  p_status text,p_amount_cents integer,p_amount_received_cents integer,
  p_refunded_amount_cents integer,p_currency text,p_dispute_id text,
  p_dispute_status text,p_disputed_amount_cents integer
) returns public.couranr_driver_tips
language plpgsql security definer set search_path=''
as $fn$
declare v_row public.couranr_driver_tips; v_capture integer; v_refund integer;
        v_dispute_status text; v_dispute_amount integer; v_dispute_open boolean;
        v_dispute_final boolean; v_dispute_closed_non_loss boolean;
begin
  select * into v_row from public.couranr_driver_tips where id=p_tip_id for update;
  if not found or v_row.provider_payment_intent_id is distinct from p_intent_id
     or v_row.delivery_id<>p_delivery_id or v_row.driver_id<>p_driver_id
     or v_row.amount_cents<>p_amount_cents or p_currency<>'usd'
     or p_status not in ('succeeded','processing','requires_payment_method',
                         'requires_action','requires_confirmation','canceled') then
    raise exception 'tip_provider_mismatch' using errcode='CR409';
  end if;
  v_capture:=case when p_status='succeeded' then p_amount_received_cents else 0 end;
  if v_capture not in (0,v_row.amount_cents) then
    raise exception 'tip_capture_mismatch' using errcode='CR409';
  end if;
  -- Stripe webhooks can arrive out of order. A stale pre-capture snapshot
  -- must not reverse an already-posted tip or retry forever.
  if v_capture<v_row.captured_amount_cents then return v_row; end if;
  v_refund:=coalesce(p_refunded_amount_cents,0);
  if v_refund<v_row.refunded_amount_cents then return v_row; end if;
  if v_refund>v_capture then
    raise exception 'tip_refund_mismatch' using errcode='CR409';
  end if;
  v_dispute_status:=coalesce(p_dispute_status,'none');
  v_dispute_amount:=coalesce(p_disputed_amount_cents,0);
  if p_dispute_id is null then
    if v_dispute_status<>'none' or v_dispute_amount<>0 then
      raise exception 'tip_dispute_mismatch' using errcode='CR409';
    end if;
    if v_row.provider_dispute_id is not null then
      v_dispute_status:=v_row.dispute_status;
      v_dispute_amount:=v_row.disputed_amount_cents;
    end if;
  elsif v_dispute_status not in (
      'warning_needs_response','warning_under_review','needs_response','under_review',
      'warning_closed','won','lost','prevented'
    ) then
    raise exception 'tip_dispute_mismatch' using errcode='CR409';
  end if;

  -- Validate the effective dispute after restoring stored evidence. Otherwise
  -- a no-dispute provider snapshot could bypass the open/lost principal cap.
  v_dispute_closed_non_loss:=v_dispute_status in ('warning_closed','won','prevented');
  if v_dispute_status<>'none' and (
       v_dispute_amount<=0
       or v_dispute_amount>v_capture
       or (not v_dispute_closed_non_loss and v_dispute_amount>v_capture-v_refund)
     ) then
    raise exception 'tip_dispute_mismatch' using errcode='CR409';
  end if;

  -- Never let an out-of-order provider snapshot replace one dispute identity,
  -- alter its gross amount, or regress a terminal result. Those shapes require
  -- additive adjustment/reversal ledger semantics rather than a row rewrite.
  if v_row.provider_dispute_id is not null and p_dispute_id is not null then
    if p_dispute_id is distinct from v_row.provider_dispute_id then
      raise exception 'tip_dispute_identity_conflict' using errcode='CR409';
    end if;
    if v_dispute_amount<>v_row.disputed_amount_cents then
      raise exception 'tip_dispute_amount_conflict' using errcode='CR409';
    end if;
    if v_row.dispute_status in ('warning_closed','won','lost','prevented')
       and v_dispute_status<>v_row.dispute_status then
      raise exception 'tip_dispute_transition_unsupported' using errcode='CR409';
    end if;
  end if;
  v_dispute_open:=v_dispute_status in (
    'warning_needs_response','warning_under_review','needs_response','under_review');
  v_dispute_final:=v_dispute_status in ('warning_closed','won','lost','prevented');
  update public.couranr_driver_tips set
    captured_amount_cents=v_capture,
    refunded_amount_cents=v_refund,
    captured_at=case when v_capture>0 then coalesce(captured_at,now()) else captured_at end,
    provider_dispute_id=coalesce(provider_dispute_id,p_dispute_id),
    dispute_status=case when p_dispute_id is null then dispute_status else v_dispute_status end,
    disputed_amount_cents=case when p_dispute_id is null then disputed_amount_cents else v_dispute_amount end,
    disputed_at=case when p_dispute_id is not null then coalesce(disputed_at,now()) else disputed_at end,
    dispute_closed_at=case when v_dispute_final then coalesce(dispute_closed_at,now())
                           when v_dispute_open then null else dispute_closed_at end,
    payment_state=case
      when v_capture>0 and v_refund=v_capture then 'refunded'
      when v_dispute_status='lost' then 'dispute_lost'
      when v_dispute_open then 'disputed'
      when v_capture>0 and v_refund>0 then 'partially_refunded'
      when v_capture>0 then 'succeeded'
      when p_status in ('requires_payment_method','canceled') then 'failed'
      else 'pending' end,
    updated_at=now()
  where id=p_tip_id returning * into v_row;
  return v_row;
end
$fn$;

comment on function public.couranr_settle_driver_tip(uuid,text,uuid,uuid,text,integer,integer,integer,text,text,text,integer) is
  'Reconciles one company-held driver-tip PaymentIntent from fresh provider evidence. Closed non-loss disputes remain historical and do not block later refunds.';

revoke all on function public.couranr_settle_driver_tip(uuid,text,uuid,uuid,text,integer,integer,integer,text,text,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_settle_driver_tip(uuid,text,uuid,uuid,text,integer,integer,integer,text,text,text,integer)
  to service_role;

commit;
