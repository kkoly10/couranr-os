-- P6-004 / ACP-033 — Couranr financial ledger V1.
--
-- ADDITIVE. This closes the missing balanced-ledger substrate before P10
-- analytics/alerting. It never calls Stripe and never changes a quote, payment
-- amount, refund amount, fulfillment state, or provider identifier.
--
-- Authority:
--   docs/couranr-mvp/PRODUCT_SPEC.md §10: immutable balanced ledger;
--   authorization is not revenue; capture creates revenue; refund/adjustment
--   is a new transaction rather than a rewrite.
--
-- Boundary:
--   the ledger lives in private, which is not a PostgREST db-schema.
--   anon/authenticated have no schema/table/function access. The server reads
--   through one service-role-only public reconciliation RPC.
--
-- Posting:
--   * successful capture:
--       Dr stripe_clearing
--       Dr promotional_credit_expense (when an applied credit exists)
--       Cr delivery_revenue (standard quote = paid + credit)
--   * successful provider refund:
--       Dr refund_expense
--       Cr stripe_clearing
--   * confirmed-before-delivery governed cancellation receivable:
--       Dr accounts_receivable
--       Cr delivery_revenue
--
-- Zero-refund settlements and authorization/release are deliberately absent:
-- neither moves captured money and authorization is not revenue.
--
-- Every posting is keyed by the canonical source row, is replay-safe, and is
-- written atomically by database triggers in the same transaction as the
-- authoritative source change.

begin;

create table if not exists private.couranr_ledger_accounts (
  code text primary key,
  name text not null,
  category text not null
    check (category in ('asset','liability','revenue','expense')),
  normal_side text not null
    check (normal_side in ('debit','credit')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into private.couranr_ledger_accounts(code,name,category,normal_side)
values
  ('stripe_clearing','Stripe clearing','asset','debit'),
  ('accounts_receivable','Accounts receivable','asset','debit'),
  ('delivery_revenue','Delivery revenue','revenue','credit'),
  ('overnight_revenue','Overnight revenue','revenue','credit'),
  ('waiting_revenue','Waiting revenue','revenue','credit'),
  ('return_revenue','Return revenue','revenue','credit'),
  ('tips_payable','Tips payable','liability','credit'),
  ('toll_parking_reimbursement','Toll and parking reimbursement','revenue','credit'),
  ('processing_expense','Payment processing expense','expense','debit'),
  ('promotional_credit_expense','Promotional credit expense','expense','debit'),
  ('refund_expense','Refund expense','expense','debit'),
  ('dispute_expense','Dispute expense','expense','debit'),
  ('tax_liability','Tax liability','liability','credit')
on conflict (code) do nothing;

create table if not exists private.couranr_ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null
    check (source_kind in ('capture','refund','cancellation_receivable')),
  source_id text not null,
  request_id uuid not null references public.couranr_delivery_requests(id)
    on update restrict on delete restrict,
  obligation_id uuid references public.couranr_payment_obligations(id)
    on update restrict on delete restrict,
  quote_version_id uuid references public.couranr_quote_versions(id)
    on update restrict on delete restrict,
  currency text not null check (currency='usd'),
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(source_kind,source_id)
);

create table if not exists private.couranr_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references private.couranr_ledger_transactions(id)
    on update restrict on delete restrict,
  account_code text not null references private.couranr_ledger_accounts(code)
    on update restrict on delete restrict,
  side text not null check (side in ('debit','credit')),
  amount_cents integer not null check (amount_cents > 0),
  created_at timestamptz not null default now()
);

create index if not exists couranr_ledger_transactions_request_idx
  on private.couranr_ledger_transactions(request_id, occurred_at desc);
create index if not exists couranr_ledger_transactions_obligation_idx
  on private.couranr_ledger_transactions(obligation_id, occurred_at desc)
  where obligation_id is not null;
create index if not exists couranr_ledger_entries_tx_idx
  on private.couranr_ledger_entries(transaction_id);
create index if not exists couranr_ledger_entries_account_idx
  on private.couranr_ledger_entries(account_code, created_at);

comment on table private.couranr_ledger_transactions is
  'Append-only P6-004 financial transactions. Source-row identity makes posting replay-safe.';
comment on table private.couranr_ledger_entries is
  'Append-only P6-004 double-entry legs. Every transaction is written through couranr_post_ledger_transaction.';
comment on column private.couranr_ledger_transactions.metadata is
  'Non-PII operational dimensions only; never addresses, phone/email, message bodies, proof URLs, tokens, or card data.';

-- The schema default ACL created in ACP-008 grants broad service_role DML.
-- Narrow these three tables explicitly: application code may read, but only
-- the SECURITY DEFINER posting function may insert; nobody may update/delete
-- financial evidence.
revoke all on private.couranr_ledger_accounts from public, anon, authenticated, service_role;
revoke all on private.couranr_ledger_transactions from public, anon, authenticated, service_role;
revoke all on private.couranr_ledger_entries from public, anon, authenticated, service_role;
grant select on private.couranr_ledger_accounts to service_role;
grant select on private.couranr_ledger_transactions to service_role;
grant select on private.couranr_ledger_entries to service_role;

create or replace function private.couranr_post_ledger_transaction(
  p_source_kind text,
  p_source_id text,
  p_request_id uuid,
  p_obligation_id uuid,
  p_quote_version_id uuid,
  p_currency text,
  p_occurred_at timestamptz,
  p_metadata jsonb,
  p_entries jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_tx_id uuid;
  v_existing jsonb;
  v_expected jsonb;
  v_debits bigint;
  v_credits bigint;
  v_bad integer;
begin
  if p_source_kind not in ('capture','refund','cancellation_receivable') then
    raise exception using errcode='CR400', message='ledger_source_kind_invalid';
  end if;
  if nullif(btrim(coalesce(p_source_id,'')),'') is null then
    raise exception using errcode='CR400', message='ledger_source_id_required';
  end if;
  if p_request_id is null or p_currency <> 'usd' or p_occurred_at is null then
    raise exception using errcode='CR400', message='ledger_identity_invalid';
  end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 2 then
    raise exception using errcode='CR400', message='ledger_entries_invalid';
  end if;

  -- Concurrent duplicate webhook/recovery calls must converge on one posting,
  -- not race into the UNIQUE(source_kind,source_id) constraint.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_source_kind || ':' || p_source_id, 0)
  );

  with legs as (
    select
      e->>'account' account_code,
      e->>'side' side,
      case when (e->>'amountCents') ~ '^[0-9]+$'
        then (e->>'amountCents')::bigint else null end amount_cents
    from jsonb_array_elements(p_entries) e
  )
  select
    coalesce(sum(amount_cents) filter (where side='debit'),0),
    coalesce(sum(amount_cents) filter (where side='credit'),0),
    count(*) filter (
      where account_code is null
         or side is null
         or side not in ('debit','credit')
         or amount_cents is null
         or amount_cents <= 0
         or not exists (
           select 1 from private.couranr_ledger_accounts a
           where a.code=legs.account_code and a.active
         )
    )
  into v_debits,v_credits,v_bad
  from legs;

  if v_bad <> 0 or v_debits <= 0 or v_debits <> v_credits then
    raise exception using errcode='CR409', message='ledger_transaction_unbalanced';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'account', e->>'account',
      'side', e->>'side',
      'amountCents', (e->>'amountCents')::integer
    )
    order by e->>'account', e->>'side', (e->>'amountCents')::integer
  ), '[]'::jsonb)
  into v_expected
  from jsonb_array_elements(p_entries) e;

  select t.id into v_tx_id
  from private.couranr_ledger_transactions t
  where t.source_kind=p_source_kind and t.source_id=p_source_id
  for update;

  if v_tx_id is not null then
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'account', le.account_code,
        'side', le.side,
        'amountCents', le.amount_cents
      )
      order by le.account_code,le.side,le.amount_cents
    ),'[]'::jsonb)
    into v_existing
    from private.couranr_ledger_entries le
    where le.transaction_id=v_tx_id;

    if v_existing <> v_expected
       or not exists (
         select 1
         from private.couranr_ledger_transactions t
         where t.id=v_tx_id
           and t.request_id=p_request_id
           and t.obligation_id is not distinct from p_obligation_id
           and t.quote_version_id is not distinct from p_quote_version_id
           and t.currency=p_currency
       )
    then
      raise exception using errcode='CR409', message='ledger_source_conflict';
    end if;
    return v_tx_id;
  end if;

  insert into private.couranr_ledger_transactions(
    source_kind,source_id,request_id,obligation_id,quote_version_id,
    currency,occurred_at,metadata
  ) values (
    p_source_kind,p_source_id,p_request_id,p_obligation_id,p_quote_version_id,
    p_currency,p_occurred_at,coalesce(p_metadata,'{}'::jsonb)
  ) returning id into v_tx_id;

  insert into private.couranr_ledger_entries(transaction_id,account_code,side,amount_cents)
  select
    v_tx_id,
    e->>'account',
    e->>'side',
    (e->>'amountCents')::integer
  from jsonb_array_elements(p_entries) e;

  return v_tx_id;
end;
$$;

revoke all on function private.couranr_post_ledger_transaction(
  text,text,uuid,uuid,uuid,text,timestamptz,jsonb,jsonb
) from public,anon,authenticated,service_role;

create or replace function private.couranr_ledger_post_capture()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_credit public.couranr_promotional_credits%rowtype;
  v_credit_cents integer := 0;
  v_standard_cents integer;
  v_entries jsonb;
begin
  if new.captured_amount_cents is null
     or (old.captured_amount_cents is not null
         and old.captured_amount_cents=new.captured_amount_cents)
  then
    return new;
  end if;

  select * into v_credit
  from public.couranr_promotional_credits pc
  where pc.request_id=new.request_id
    and pc.quote_version_id=new.quote_version_id
    and pc.status='applied'
  limit 1;

  if v_credit.id is not null then
    if v_credit.amount_paid_cents <> new.captured_amount_cents
       or v_credit.standard_quote_cents <>
          new.captured_amount_cents + v_credit.promotional_credit_cents
    then
      raise exception using errcode='CR409', message='ledger_promotional_credit_mismatch';
    end if;
    v_credit_cents := v_credit.promotional_credit_cents;
  end if;

  v_standard_cents := new.captured_amount_cents + v_credit_cents;
  v_entries := jsonb_build_array(
    jsonb_build_object('account','stripe_clearing','side','debit','amountCents',new.captured_amount_cents),
    jsonb_build_object('account','delivery_revenue','side','credit','amountCents',v_standard_cents)
  );
  if v_credit_cents > 0 then
    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object('account','promotional_credit_expense','side','debit','amountCents',v_credit_cents)
    );
  end if;

  perform private.couranr_post_ledger_transaction(
    'capture',
    new.id::text,
    new.request_id,
    new.id,
    new.quote_version_id,
    new.currency,
    coalesce(new.captured_at,now()),
    jsonb_build_object(
      'payerType',new.payer_type,
      'pricingPolicyVersion',new.pricing_policy_version,
      'promotionalCreditCents',v_credit_cents
    ),
    v_entries
  );
  return new;
end;
$$;

create or replace function private.couranr_ledger_post_refund()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ob public.couranr_payment_obligations%rowtype;
begin
  if new.attempt_state <> 'succeeded'
     or (old.attempt_state='succeeded' and old.amount_cents=new.amount_cents)
  then
    return new;
  end if;

  select * into strict v_ob
  from public.couranr_payment_obligations
  where id=new.obligation_id;

  perform private.couranr_post_ledger_transaction(
    'refund',
    new.id::text,
    new.request_id,
    new.obligation_id,
    v_ob.quote_version_id,
    'usd',
    new.updated_at,
    jsonb_build_object(
      'reason',new.reason,
      'retainedCents',new.retained_cents
    ),
    jsonb_build_array(
      jsonb_build_object('account','refund_expense','side','debit','amountCents',new.amount_cents),
      jsonb_build_object('account','stripe_clearing','side','credit','amountCents',new.amount_cents)
    )
  );
  return new;
end;
$$;

create or replace function private.couranr_ledger_post_cancellation_receivable()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_ob public.couranr_payment_obligations%rowtype;
  v_amount integer;
begin
  if new.event_type <> 'couranr.cancellation.receivable'
     or new.outcome <> 'applied'
  then
    return new;
  end if;

  v_amount := case
    when coalesce(new.detail->>'retainedDueCents','') ~ '^[0-9]+$'
      then (new.detail->>'retainedDueCents')::integer
    else 0
  end;
  if v_amount <= 0 then
    raise exception using errcode='CR409', message='ledger_receivable_amount_invalid';
  end if;

  select * into strict v_ob
  from public.couranr_payment_obligations
  where id=new.obligation_id;

  perform private.couranr_post_ledger_transaction(
    'cancellation_receivable',
    new.id::text,
    v_ob.request_id,
    v_ob.id,
    v_ob.quote_version_id,
    v_ob.currency,
    new.created_at,
    jsonb_build_object(
      'governedReason',new.detail->>'governedReason',
      'collected',false
    ),
    jsonb_build_array(
      jsonb_build_object('account','accounts_receivable','side','debit','amountCents',v_amount),
      jsonb_build_object('account','delivery_revenue','side','credit','amountCents',v_amount)
    )
  );
  return new;
end;
$$;

revoke all on function private.couranr_ledger_post_capture() from public,anon,authenticated,service_role;
revoke all on function private.couranr_ledger_post_refund() from public,anon,authenticated,service_role;
revoke all on function private.couranr_ledger_post_cancellation_receivable() from public,anon,authenticated,service_role;

drop trigger if exists couranr_ledger_capture_trg on public.couranr_payment_obligations;
create trigger couranr_ledger_capture_trg
after update of captured_amount_cents on public.couranr_payment_obligations
for each row execute function private.couranr_ledger_post_capture();

drop trigger if exists couranr_ledger_refund_trg on public.couranr_payment_refunds;
create trigger couranr_ledger_refund_trg
after update of attempt_state on public.couranr_payment_refunds
for each row execute function private.couranr_ledger_post_refund();

drop trigger if exists couranr_ledger_cancellation_receivable_trg on public.couranr_payment_events;
create trigger couranr_ledger_cancellation_receivable_trg
after insert on public.couranr_payment_events
for each row execute function private.couranr_ledger_post_cancellation_receivable();

-- Existing commercial evidence, if any, is projected once. The source-key
-- uniqueness makes this safe to replay.
do $$
declare
  r record;
  v_credit public.couranr_promotional_credits%rowtype;
  v_credit_cents integer;
  v_standard_cents integer;
  v_entries jsonb;
begin
  for r in
    select o.*
    from public.couranr_payment_obligations o
    where o.captured_amount_cents is not null
  loop
    v_credit_cents := 0;
    v_credit := null;
    select * into v_credit
    from public.couranr_promotional_credits pc
    where pc.request_id=r.request_id
      and pc.quote_version_id=r.quote_version_id
      and pc.status='applied'
    limit 1;
    if v_credit.id is not null then
      if v_credit.amount_paid_cents <> r.captured_amount_cents
         or v_credit.standard_quote_cents <>
            r.captured_amount_cents + v_credit.promotional_credit_cents
      then
        raise exception using errcode='CR409', message='ledger_backfill_credit_mismatch';
      end if;
      v_credit_cents := v_credit.promotional_credit_cents;
    end if;
    v_standard_cents := r.captured_amount_cents + v_credit_cents;
    v_entries := jsonb_build_array(
      jsonb_build_object('account','stripe_clearing','side','debit','amountCents',r.captured_amount_cents),
      jsonb_build_object('account','delivery_revenue','side','credit','amountCents',v_standard_cents)
    );
    if v_credit_cents > 0 then
      v_entries := v_entries || jsonb_build_array(
        jsonb_build_object('account','promotional_credit_expense','side','debit','amountCents',v_credit_cents)
      );
    end if;
    perform private.couranr_post_ledger_transaction(
      'capture',r.id::text,r.request_id,r.id,r.quote_version_id,r.currency,
      coalesce(r.captured_at,r.updated_at),
      jsonb_build_object('payerType',r.payer_type,'pricingPolicyVersion',r.pricing_policy_version,'promotionalCreditCents',v_credit_cents),
      v_entries
    );
  end loop;

  for r in
    select pr.*,o.quote_version_id
    from public.couranr_payment_refunds pr
    join public.couranr_payment_obligations o on o.id=pr.obligation_id
    where pr.attempt_state='succeeded'
  loop
    perform private.couranr_post_ledger_transaction(
      'refund',r.id::text,r.request_id,r.obligation_id,r.quote_version_id,'usd',
      r.updated_at,
      jsonb_build_object('reason',r.reason,'retainedCents',r.retained_cents),
      jsonb_build_array(
        jsonb_build_object('account','refund_expense','side','debit','amountCents',r.amount_cents),
        jsonb_build_object('account','stripe_clearing','side','credit','amountCents',r.amount_cents)
      )
    );
  end loop;

  for r in
    select pe.*,o.request_id,o.quote_version_id,o.currency
    from public.couranr_payment_events pe
    join public.couranr_payment_obligations o on o.id=pe.obligation_id
    where pe.event_type='couranr.cancellation.receivable'
      and pe.outcome='applied'
  loop
    perform private.couranr_post_ledger_transaction(
      'cancellation_receivable',r.id::text,r.request_id,r.obligation_id,
      r.quote_version_id,r.currency,r.created_at,
      jsonb_build_object('governedReason',r.detail->>'governedReason','collected',false),
      jsonb_build_array(
        jsonb_build_object('account','accounts_receivable','side','debit','amountCents',(r.detail->>'retainedDueCents')::integer),
        jsonb_build_object('account','delivery_revenue','side','credit','amountCents',(r.detail->>'retainedDueCents')::integer)
      )
    );
  end loop;
end;
$$;

create or replace function public.couranr_get_ledger_reconciliation()
returns jsonb
language sql
security invoker
set search_path=''
as $$
with
source as (
  select
    coalesce((select sum(captured_amount_cents) from public.couranr_payment_obligations where captured_amount_cents is not null),0)::bigint captured_cents,
    coalesce((select sum(amount_cents) from public.couranr_payment_refunds where attempt_state='succeeded'),0)::bigint refunded_cents,
    coalesce((
      select sum((detail->>'retainedDueCents')::bigint)
      from public.couranr_payment_events
      where event_type='couranr.cancellation.receivable'
        and outcome='applied'
        and coalesce(detail->>'retainedDueCents','') ~ '^[0-9]+$'
    ),0)::bigint receivable_cents
),
balances as (
  select
    coalesce(sum(case when e.side='debit' then e.amount_cents else -e.amount_cents end)
      filter (where e.account_code='stripe_clearing'),0)::bigint stripe_clearing_cents,
    coalesce(sum(case when e.side='credit' then e.amount_cents else -e.amount_cents end)
      filter (where e.account_code='delivery_revenue'),0)::bigint delivery_revenue_cents,
    coalesce(sum(case when e.side='debit' then e.amount_cents else -e.amount_cents end)
      filter (where e.account_code='promotional_credit_expense'),0)::bigint promotional_credit_expense_cents,
    coalesce(sum(case when e.side='debit' then e.amount_cents else -e.amount_cents end)
      filter (where e.account_code='refund_expense'),0)::bigint refund_expense_cents,
    coalesce(sum(case when e.side='debit' then e.amount_cents else -e.amount_cents end)
      filter (where e.account_code='accounts_receivable'),0)::bigint accounts_receivable_cents
  from private.couranr_ledger_entries e
),
missing as (
  select
    (select count(*)
     from public.couranr_payment_obligations o
     left join private.couranr_ledger_transactions t
       on t.source_kind='capture' and t.source_id=o.id::text
     where o.captured_amount_cents is not null and t.id is null)::integer missing_captures,
    (select count(*)
     from public.couranr_payment_refunds r
     left join private.couranr_ledger_transactions t
       on t.source_kind='refund' and t.source_id=r.id::text
     where r.attempt_state='succeeded' and t.id is null)::integer missing_refunds,
    (select count(*)
     from public.couranr_payment_events pe
     left join private.couranr_ledger_transactions t
       on t.source_kind='cancellation_receivable' and t.source_id=pe.id::text
     where pe.event_type='couranr.cancellation.receivable'
       and pe.outcome='applied' and t.id is null)::integer missing_receivables
),
unbalanced as (
  select count(*)::integer count
  from (
    select t.id
    from private.couranr_ledger_transactions t
    join private.couranr_ledger_entries e on e.transaction_id=t.id
    group by t.id
    having sum(e.amount_cents) filter(where e.side='debit')
        <> sum(e.amount_cents) filter(where e.side='credit')
  ) x
),
recent as (
  select coalesce(jsonb_agg(row_to_json(x) order by x.occurred_at desc),'[]'::jsonb) items
  from (
    select t.id,t.source_kind,t.request_id,t.obligation_id,t.currency,t.occurred_at,
           coalesce(sum(e.amount_cents) filter(where e.side='debit'),0)::integer amount_cents
    from private.couranr_ledger_transactions t
    join private.couranr_ledger_entries e on e.transaction_id=t.id
    group by t.id
    order by t.occurred_at desc
    limit 50
  ) x
)
select jsonb_build_object(
  'balanced',
    u.count=0
    and m.missing_captures=0
    and m.missing_refunds=0
    and m.missing_receivables=0
    and b.stripe_clearing_cents=(s.captured_cents-s.refunded_cents),
  'capturedCents',s.captured_cents,
  'refundedCents',s.refunded_cents,
  'governedReceivableCents',s.receivable_cents,
  'stripeClearingCents',b.stripe_clearing_cents,
  'deliveryRevenueCents',b.delivery_revenue_cents,
  'promotionalCreditExpenseCents',b.promotional_credit_expense_cents,
  'refundExpenseCents',b.refund_expense_cents,
  'accountsReceivableCents',b.accounts_receivable_cents,
  'expectedStripeClearingCents',s.captured_cents-s.refunded_cents,
  'unbalancedTransactions',u.count,
  'missingCaptures',m.missing_captures,
  'missingRefunds',m.missing_refunds,
  'missingReceivables',m.missing_receivables,
  'recentTransactions',r.items,
  'generatedAt',now()
)
from source s cross join balances b cross join missing m cross join unbalanced u cross join recent r;
$$;

revoke all on function public.couranr_get_ledger_reconciliation()
  from public,anon,authenticated;
grant execute on function public.couranr_get_ledger_reconciliation()
  to service_role;

commit;
