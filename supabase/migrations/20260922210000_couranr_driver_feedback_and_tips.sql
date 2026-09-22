-- Delivered-only customer feedback and voluntary, company-collected driver tips.
-- A tip is a separate automatic-capture PaymentIntent, never a quote adjustment.
-- Couranr holds the FULL tip in tips_payable until owner-managed payroll.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$ begin
  if to_regclass('public.couranr_driver_portraits') is null
     or to_regclass('public.couranr_delivery_access_tokens') is null
     or to_regclass('public.couranr_consumer_guest_sessions') is null
     or to_regclass('private.couranr_ledger_transactions') is null
     or to_regprocedure('private.couranr_post_ledger_transaction(text,text,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb)') is null then
    raise exception 'driver_feedback_unknown_schema';
  end if;
end $$;

create table public.couranr_driver_reviews (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.couranr_deliveries(id) on delete restrict,
  request_id uuid not null references public.couranr_delivery_requests(id) on delete restrict,
  assignment_id uuid not null references public.couranr_delivery_assignments(id) on delete restrict,
  driver_id uuid not null references public.couranr_drivers(id) on delete restrict,
  audience text not null check (audience in ('sender','recipient','merchant')),
  rating smallint not null check (rating between 1 and 5),
  comment text check (char_length(comment)<=1000),
  created_at timestamptz not null default now(),
  unique(delivery_id,audience)
);
comment on table public.couranr_driver_reviews is
  'Private delivery-scoped customer feedback. Never public driver advertising or a custody/payment decision.';

create table public.couranr_driver_tips (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.couranr_deliveries(id) on delete restrict,
  request_id uuid not null references public.couranr_delivery_requests(id) on delete restrict,
  assignment_id uuid not null references public.couranr_delivery_assignments(id) on delete restrict,
  driver_id uuid not null references public.couranr_drivers(id) on delete restrict,
  audience text not null check (audience in ('sender','recipient','merchant')),
  amount_cents integer not null check (amount_cents between 100 and 10000),
  currency text not null default 'usd' check (currency='usd'),
  provider_payment_intent_id text unique,
  payment_state text not null default 'prepared'
    check (payment_state in ('prepared','pending','failed','succeeded','partially_refunded','refunded')),
  captured_amount_cents integer not null default 0,
  refunded_amount_cents integer not null default 0,
  disputed_at timestamptz,
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(delivery_id,audience),
  check (captured_amount_cents in (0,amount_cents)),
  check (refunded_amount_cents between 0 and captured_amount_cents),
  check (captured_at is not null or captured_amount_cents=0)
);
comment on table public.couranr_driver_tips is
  'Voluntary tips captured into the Couranr Stripe account. Gross captured tips are payable to the assignment-time driver; payroll/disbursement is external and never automated here.';
create index couranr_driver_tips_driver_idx on public.couranr_driver_tips(driver_id,captured_at desc)
  where captured_amount_cents>0;

alter table public.couranr_driver_reviews enable row level security;
alter table public.couranr_driver_tips enable row level security;
revoke all on public.couranr_driver_reviews,public.couranr_driver_tips from public,anon,authenticated,service_role;
grant select on public.couranr_driver_reviews,public.couranr_driver_tips to service_role;

-- The calling route authenticates first, then SQL re-establishes the exact
-- audience/request/assignment relationship. No client may choose a driver.
create function private.couranr_feedback_assignment(
  p_delivery_id uuid,p_audience text,p_token_hash text,
  p_guest_session_id uuid,p_actor_user_id uuid
) returns public.couranr_delivery_assignments
language plpgsql security definer set search_path=''
as $fn$
declare v_delivery public.couranr_deliveries; v_request public.couranr_delivery_requests;
        v_assignment public.couranr_delivery_assignments; v_count integer;
        v_assignment_id uuid;
begin
  select * into v_delivery from public.couranr_deliveries where id=p_delivery_id;
  if not found or v_delivery.fulfillment_state<>'delivered' then
    raise exception 'feedback_unavailable' using errcode='CR404';
  end if;
  select * into v_request from public.couranr_delivery_requests where id=v_delivery.request_id;
  if p_audience='recipient' then
    if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
       or not exists(select 1 from public.couranr_delivery_access_tokens t
         where t.token_hash=p_token_hash and t.request_id=v_request.id
           and t.audience='recipient' and t.revoked_at is null and t.expires_at>now()) then
      raise exception 'feedback_unavailable' using errcode='CR404';
    end if;
  elsif p_audience='sender' then
    if v_request.requester_kind<>'consumer' or p_guest_session_id is null
       or not exists(select 1 from public.couranr_consumer_guest_sessions s
          where s.id=p_guest_session_id and s.request_id=v_request.id
            and s.revoked_at is null and s.expires_at>now()) then
      raise exception 'feedback_unavailable' using errcode='CR404';
    end if;
  elsif p_audience='merchant' then
    if v_request.business_account_id is null or p_actor_user_id is null
       or not exists(select 1 from public.business_members bm
          where bm.business_account_id=v_request.business_account_id
            and bm.user_id=p_actor_user_id and bm.status='active'
            and bm.role in ('owner','manager','dispatcher')) then
      raise exception 'feedback_unavailable' using errcode='CR404';
    end if;
  else
    raise exception 'feedback_unavailable' using errcode='CR404';
  end if;
  select count(*),min(id::text)::uuid into v_count,v_assignment_id
    from public.couranr_delivery_assignments
   where delivery_id=p_delivery_id and assignment_state='completed';
  if v_count<>1 then raise exception 'feedback_assignment_ambiguous' using errcode='CR409'; end if;
  select * into v_assignment from public.couranr_delivery_assignments where id=v_assignment_id;
  if p_actor_user_id is not null and p_audience='merchant'
     and exists(select 1 from public.couranr_drivers d where d.id=v_assignment.driver_id and d.user_id=p_actor_user_id) then
    raise exception 'driver_self_feedback_refused' using errcode='CR403';
  end if;
  return v_assignment;
end $fn$;

create function public.couranr_submit_driver_review(
  p_delivery_id uuid,p_audience text,p_token_hash text,p_guest_session_id uuid,
  p_actor_user_id uuid,p_rating integer,p_comment text
) returns public.couranr_driver_reviews
language plpgsql security definer set search_path=''
as $fn$
declare v_assignment public.couranr_delivery_assignments;
        v_request_id uuid; v_row public.couranr_driver_reviews;
begin
  if p_rating not between 1 and 5 or char_length(coalesce(p_comment,''))>1000 then
    raise exception 'review_input_invalid' using errcode='CR422';
  end if;
  v_assignment:=private.couranr_feedback_assignment(
    p_delivery_id,p_audience,p_token_hash,p_guest_session_id,p_actor_user_id);
  select request_id into v_request_id from public.couranr_deliveries where id=p_delivery_id;
  insert into public.couranr_driver_reviews(
    delivery_id,request_id,assignment_id,driver_id,audience,rating,comment
  ) values (
    p_delivery_id,v_request_id,v_assignment.id,v_assignment.driver_id,p_audience,p_rating,
    nullif(btrim(coalesce(p_comment,'')),'')
  ) on conflict(delivery_id,audience) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.couranr_driver_reviews
      where delivery_id=p_delivery_id and audience=p_audience;
    if v_row.rating<>p_rating or coalesce(v_row.comment,'')<>coalesce(nullif(btrim(coalesce(p_comment,'')),''),'') then
      raise exception 'review_already_submitted' using errcode='CR409';
    end if;
  end if;
  return v_row;
end $fn$;

create function public.couranr_prepare_driver_tip(
  p_delivery_id uuid,p_audience text,p_token_hash text,p_guest_session_id uuid,
  p_actor_user_id uuid,p_amount_cents integer
) returns public.couranr_driver_tips
language plpgsql security definer set search_path=''
as $fn$
declare v_assignment public.couranr_delivery_assignments;
        v_request_id uuid; v_row public.couranr_driver_tips;
begin
  if p_amount_cents not between 100 and 10000 then
    raise exception 'tip_amount_invalid' using errcode='CR422';
  end if;
  v_assignment:=private.couranr_feedback_assignment(
    p_delivery_id,p_audience,p_token_hash,p_guest_session_id,p_actor_user_id);
  select request_id into v_request_id from public.couranr_deliveries where id=p_delivery_id;
  insert into public.couranr_driver_tips(
    delivery_id,request_id,assignment_id,driver_id,audience,amount_cents
  ) values (
    p_delivery_id,v_request_id,v_assignment.id,v_assignment.driver_id,p_audience,p_amount_cents
  ) on conflict(delivery_id,audience) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.couranr_driver_tips
      where delivery_id=p_delivery_id and audience=p_audience;
    if v_row.amount_cents<>p_amount_cents then
      raise exception 'tip_amount_already_chosen' using errcode='CR409';
    end if;
  end if;
  return v_row;
end $fn$;

create function public.couranr_get_driver_feedback(
  p_delivery_id uuid,p_audience text,p_token_hash text,p_guest_session_id uuid,p_actor_user_id uuid
) returns jsonb
language plpgsql security definer set search_path=''
as $fn$
declare v_assignment public.couranr_delivery_assignments;
        v_review public.couranr_driver_reviews; v_tip public.couranr_driver_tips;
begin
  v_assignment:=private.couranr_feedback_assignment(
    p_delivery_id,p_audience,p_token_hash,p_guest_session_id,p_actor_user_id);
  select * into v_review from public.couranr_driver_reviews
    where delivery_id=p_delivery_id and audience=p_audience;
  select * into v_tip from public.couranr_driver_tips
    where delivery_id=p_delivery_id and audience=p_audience;
  return jsonb_build_object(
    'driverName',v_assignment.driver_display_name_snapshot,
    'review',case when v_review.id is null then null else jsonb_build_object(
      'rating',v_review.rating,'comment',v_review.comment,'createdAt',v_review.created_at) end,
    'tip',case when v_tip.id is null then null else jsonb_build_object(
      'amountCents',v_tip.amount_cents,'paymentState',v_tip.payment_state,
      'capturedAmountCents',v_tip.captured_amount_cents,
      'refundedAmountCents',v_tip.refunded_amount_cents,
      'disputed',v_tip.disputed_at is not null) end);
end $fn$;

create function public.couranr_attach_driver_tip_intent(p_tip_id uuid,p_intent_id text)
returns public.couranr_driver_tips
language plpgsql security definer set search_path=''
as $fn$
declare v_row public.couranr_driver_tips;
begin
  if p_intent_id !~ '^pi_[A-Za-z0-9]{8,}$' then
    raise exception 'tip_intent_invalid' using errcode='CR422';
  end if;
  select * into v_row from public.couranr_driver_tips where id=p_tip_id for update;
  if not found or (v_row.provider_payment_intent_id is not null
                   and v_row.provider_payment_intent_id<>p_intent_id) then
    raise exception 'tip_intent_conflict' using errcode='CR409';
  end if;
  update public.couranr_driver_tips
     set provider_payment_intent_id=p_intent_id,
         payment_state=case when payment_state='prepared' then 'pending' else payment_state end,
         updated_at=now()
   where id=p_tip_id returning * into v_row;
  return v_row;
end $fn$;

-- Called only after the signed Couranr webhook or a fresh Stripe retrieve.
-- Metadata and amount are verified AGAINST the prepared row. A refund may be
-- observed before the capture webhook; both ledger legs then post atomically.
create function public.couranr_settle_driver_tip(
  p_tip_id uuid,p_intent_id text,p_delivery_id uuid,p_driver_id uuid,
  p_status text,p_amount_cents integer,p_amount_received_cents integer,
  p_refunded_amount_cents integer,p_currency text,p_disputed boolean
) returns public.couranr_driver_tips
language plpgsql security definer set search_path=''
as $fn$
declare v_row public.couranr_driver_tips; v_capture integer; v_refund integer;
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
  update public.couranr_driver_tips set
    captured_amount_cents=v_capture,
    refunded_amount_cents=v_refund,
    captured_at=case when v_capture>0 then coalesce(captured_at,now()) else captured_at end,
    disputed_at=case when p_disputed then coalesce(disputed_at,now()) else disputed_at end,
    payment_state=case
      when v_capture>0 and v_refund=v_capture then 'refunded'
      when v_capture>0 and v_refund>0 then 'partially_refunded'
      when v_capture>0 then 'succeeded'
      when p_status in ('requires_payment_method','canceled') then 'failed'
      else 'pending' end,
    updated_at=now()
  where id=p_tip_id returning * into v_row;
  return v_row;
end $fn$;

-- Existing ledger helper retains its complete validation/idempotency contract;
-- extend only its closed source-kind allowlist with a preflight exact substring.
alter table private.couranr_ledger_transactions drop constraint couranr_ledger_transactions_source_kind_check;
alter table private.couranr_ledger_transactions add constraint couranr_ledger_transactions_source_kind_check
  check (source_kind in ('capture','refund','cancellation_receivable','tip','tip_refund'));
do $fn$
declare v_definition text;
begin
  v_definition:=pg_get_functiondef('private.couranr_post_ledger_transaction(text,text,uuid,uuid,uuid,text,timestamp with time zone,jsonb,jsonb)'::regprocedure);
  if position('p_source_kind not in (''capture'',''refund'',''cancellation_receivable'')' in v_definition)=0 then
    raise exception 'ledger_source_guard_unrecognized';
  end if;
  execute replace(v_definition,
    'p_source_kind not in (''capture'',''refund'',''cancellation_receivable'')',
    'p_source_kind not in (''capture'',''refund'',''cancellation_receivable'',''tip'',''tip_refund'')');
end $fn$;

create function private.couranr_post_driver_tip_ledger()
returns trigger language plpgsql security definer set search_path=''
as $fn$
declare v_delta integer;
begin
  if new.captured_amount_cents>old.captured_amount_cents then
    perform private.couranr_post_ledger_transaction(
      'tip',new.id::text,new.request_id,null,null,'usd',new.captured_at,
      jsonb_build_object('driverId',new.driver_id,'assignmentId',new.assignment_id),
      jsonb_build_array(
        jsonb_build_object('account','stripe_clearing','side','debit','amountCents',new.captured_amount_cents),
        jsonb_build_object('account','tips_payable','side','credit','amountCents',new.captured_amount_cents)));
  end if;
  v_delta:=new.refunded_amount_cents-old.refunded_amount_cents;
  if v_delta>0 then
    perform private.couranr_post_ledger_transaction(
      'tip_refund',new.id::text||':'||new.refunded_amount_cents::text,new.request_id,null,null,
      'usd',now(),jsonb_build_object('driverId',new.driver_id),
      jsonb_build_array(
        jsonb_build_object('account','tips_payable','side','debit','amountCents',v_delta),
        jsonb_build_object('account','stripe_clearing','side','credit','amountCents',v_delta)));
  end if;
  return new;
end $fn$;
create trigger couranr_driver_tip_ledger
  after update of captured_amount_cents,refunded_amount_cents on public.couranr_driver_tips
  for each row execute function private.couranr_post_driver_tip_ledger();

-- Preserve every legacy reconciliation field, but include the new liability
-- in the clearing equation. The base function is retained byte-for-byte under
-- a new name, avoiding a wholesale rewrite of existing money reconciliation.
alter function public.couranr_get_ledger_reconciliation()
  rename to couranr_get_ledger_reconciliation_base;
create function public.couranr_get_ledger_reconciliation()
returns jsonb language sql security invoker set search_path=''
as $fn$
with base as (select public.couranr_get_ledger_reconciliation_base() v),
tips as (
  select coalesce(sum(captured_amount_cents),0)::bigint captured,
         coalesce(sum(refunded_amount_cents),0)::bigint refunded
  from public.couranr_driver_tips
),
tip_balance as (
  select coalesce(sum(case when e.side='credit' then e.amount_cents else -e.amount_cents end),0)::bigint payable
  from private.couranr_ledger_entries e where e.account_code='tips_payable'
),
missing as (
  select
    (select count(*) from public.couranr_driver_tips t
      left join private.couranr_ledger_transactions l
        on l.source_kind='tip' and l.source_id=t.id::text
      where t.captured_amount_cents>0 and l.id is null)::integer captures,
    (select count(*) from public.couranr_driver_tips t
      left join (
        select split_part(l.source_id,':',1)::uuid tip_id,
               sum(e.amount_cents) filter(where e.account_code='tips_payable' and e.side='debit') refunded
        from private.couranr_ledger_transactions l
        join private.couranr_ledger_entries e on e.transaction_id=l.id
        where l.source_kind='tip_refund' group by split_part(l.source_id,':',1)
      ) l on l.tip_id=t.id
      where t.refunded_amount_cents>coalesce(l.refunded,0))::integer refunds
)
select b.v || jsonb_build_object(
  'tipCapturedCents',t.captured,
  'tipRefundedCents',t.refunded,
  'tipsPayableCents',p.payable,
  'missingTipCaptures',m.captures,
  'missingTipRefunds',m.refunds,
  'expectedStripeClearingCents',
    (b.v->>'capturedCents')::bigint-(b.v->>'refundedCents')::bigint+t.captured-t.refunded,
  'balanced',
    (b.v->>'unbalancedTransactions')::integer=0
    and (b.v->>'missingCaptures')::integer=0
    and (b.v->>'missingRefunds')::integer=0
    and (b.v->>'missingReceivables')::integer=0
    and m.captures=0 and m.refunds=0
    and p.payable=t.captured-t.refunded
    and (b.v->>'stripeClearingCents')::bigint=
      (b.v->>'capturedCents')::bigint-(b.v->>'refundedCents')::bigint+t.captured-t.refunded
)
from base b cross join tips t cross join tip_balance p cross join missing m;
$fn$;
revoke all on function public.couranr_get_ledger_reconciliation() from public,anon,authenticated,service_role;
grant execute on function public.couranr_get_ledger_reconciliation() to service_role;

revoke all on function private.couranr_feedback_assignment(uuid,text,text,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.couranr_post_driver_tip_ledger()
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_submit_driver_review(uuid,text,text,uuid,uuid,integer,text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_prepare_driver_tip(uuid,text,text,uuid,uuid,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_get_driver_feedback(uuid,text,text,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_attach_driver_tip_intent(uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_settle_driver_tip(uuid,text,uuid,uuid,text,integer,integer,integer,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_submit_driver_review(uuid,text,text,uuid,uuid,integer,text) to service_role;
grant execute on function public.couranr_prepare_driver_tip(uuid,text,text,uuid,uuid,integer) to service_role;
grant execute on function public.couranr_get_driver_feedback(uuid,text,text,uuid,uuid) to service_role;
grant execute on function public.couranr_attach_driver_tip_intent(uuid,text) to service_role;
grant execute on function public.couranr_settle_driver_tip(uuid,text,uuid,uuid,text,integer,integer,integer,text,boolean) to service_role;
commit;
