-- Revert only before any credit-backed plan or delivery exists. Once credit
-- settlement has been used, the prior M5 probe produces false incident alerts;
-- prefer forward repair. Never rewrite or delete settlement history.
begin;
set local lock_timeout = '10s';
set local statement_timeout = '120s';

do $guard$
begin
  if to_regprocedure('public.couranr_foundation_integrity()') is null
     or to_regclass('public.couranr_promotional_credits') is null then
    raise exception 'integrity rollback prerequisite missing';
  end if;
  if exists (select 1 from public.couranr_service_plans where promotional_credit_id is not null)
     or exists (select 1 from public.couranr_deliveries where promotional_credit_id is not null) then
    raise exception 'credit settlement history exists; forward repair the integrity probe instead of restoring its obsolete definition';
  end if;
end $guard$;

-- Exact M5 probe semantics, safe only when credit-backed planning has never
-- occurred. Function ownership/grants are retained by CREATE OR REPLACE.
create or replace function public.couranr_foundation_integrity()
returns table(issue_code text,entity_id uuid,detail jsonb)
language sql stable security invoker set search_path=''
as $fn$
  select 'multiple_live_payment_obligations',request_id,jsonb_build_object('count',count(*))
    from public.couranr_payment_obligations
   where payment_state<>'cancelled' group by request_id having count(*)>1
  union all
  select 'multiple_live_service_plans',request_id,jsonb_build_object('count',count(*))
    from public.couranr_service_plans
   where plan_state<>'cancelled' group by request_id having count(*)>1
  union all
  select 'multiple_active_assignments',delivery_id,jsonb_build_object('count',count(*))
    from public.couranr_delivery_assignments
   where assignment_state='active' group by delivery_id having count(*)>1
  union all
  select 'quote_line_item_arithmetic',q.id,
         jsonb_build_object('subtotalCents',q.subtotal_cents,
           'lineItemTotalCents',public.couranr_quote_line_items_total(q.quote_line_items))
    from public.couranr_quote_versions q
   where q.quote_line_items is not null
     and public.couranr_quote_line_items_total(q.quote_line_items)
         is distinct from coalesce(q.subtotal_cents,0)::bigint
  union all
  select 'commercial_request_missing_quote',r.id,jsonb_build_object('quoteStatus',r.quote_status)
    from public.couranr_delivery_requests r
   where r.quote_status<>'not_quoted' and r.current_quote_version_id is null
  union all
  select 'request_quote_projection_mismatch',r.id,
         jsonb_build_object('quoteVersionId',r.current_quote_version_id)
    from public.couranr_delivery_requests r
    join public.couranr_quote_versions q on q.id=r.current_quote_version_id
   where q.request_id is distinct from r.id
      or q.quote_status is distinct from r.quote_status
      or q.pricing_policy_version is distinct from r.pricing_policy_version
      or q.subtotal_cents is distinct from r.delivery_subtotal_cents
      or q.payer_type is distinct from r.payer_type
  union all
  select 'obligation_quote_mismatch',o.id,
         jsonb_build_object('requestId',o.request_id,'quoteVersionId',o.quote_version_id)
    from public.couranr_payment_obligations o
    left join public.couranr_quote_versions q on q.id=o.quote_version_id
    left join public.couranr_delivery_requests r on r.id=o.request_id
   where q.id is null or q.request_id is distinct from o.request_id
      or r.id is null or o.business_account_id is distinct from r.business_account_id
      or q.subtotal_cents is distinct from o.amount_cents
      or q.pricing_policy_version is distinct from o.pricing_policy_version
      or q.payer_type is distinct from o.payer_type or q.currency is distinct from o.currency
  union all
  select 'plan_obligation_quote_mismatch',p.id,
         jsonb_build_object('requestId',p.request_id,'quoteVersionId',p.quote_version_id)
    from public.couranr_service_plans p
    left join public.couranr_payment_obligations o on o.id=p.payment_obligation_id
    left join public.couranr_delivery_requests r on r.id=p.request_id
   where o.id is null or r.id is null or o.request_id is distinct from p.request_id
      or p.business_account_id is distinct from r.business_account_id
      or p.business_account_id is distinct from o.business_account_id
      or o.quote_version_id is distinct from p.quote_version_id
  union all
  select 'delivery_plan_quote_mismatch',d.id,
         jsonb_build_object('requestId',d.request_id,'quoteVersionId',d.quote_version_id)
    from public.couranr_deliveries d
    left join public.couranr_service_plans p on p.id=d.service_plan_id
    left join public.couranr_payment_obligations o on o.id=d.payment_obligation_id
    left join public.couranr_delivery_requests r on r.id=d.request_id
   where p.id is null or o.id is null or r.id is null
      or p.request_id is distinct from d.request_id
      or o.request_id is distinct from d.request_id
      or d.business_account_id is distinct from r.business_account_id
      or d.business_account_id is distinct from p.business_account_id
      or d.business_account_id is distinct from o.business_account_id
      or p.quote_version_id is distinct from d.quote_version_id
      or o.quote_version_id is distinct from d.quote_version_id
  union all
  select 'captured_without_delivery',o.id,jsonb_build_object('requestId',o.request_id)
    from public.couranr_payment_obligations o
   where o.payment_state='captured'
     and not exists(select 1 from public.couranr_deliveries d where d.request_id=o.request_id)
  union all
  select 'captured_amount_inconsistency',o.id,
         jsonb_build_object('amountCents',o.amount_cents,'capturedAmountCents',o.captured_amount_cents)
    from public.couranr_payment_obligations o
   where o.payment_state in ('captured','refunded','partially_refunded')
     and o.captured_amount_cents is distinct from o.amount_cents
  union all
  select 'business_requester_missing_business',r.id,jsonb_build_object('requesterKind',r.requester_kind)
    from public.couranr_delivery_requests r
   where r.requester_kind='business' and r.business_account_id is null
  union all
  select 'consumer_requester_has_business',r.id,jsonb_build_object('requesterKind',r.requester_kind)
    from public.couranr_delivery_requests r
   where r.requester_kind='consumer' and r.business_account_id is not null
  union all
  select 'runtime_quote_contains_multistop',q.id,jsonb_build_object('requestId',q.request_id)
    from public.couranr_quote_versions q
   where q.record_origin='runtime'
     and coalesce(q.shipment_snapshot->>'additionalStops','0') ~ '^[0-9]+$'
     and (q.shipment_snapshot->>'additionalStops')::integer>0
$fn$;

comment on function public.couranr_foundation_integrity() is
  'Read-only Gate A integrity probe. Returns invariant codes and non-PII identifiers/details; performs no mutation.';
revoke all on function public.couranr_foundation_integrity()
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_foundation_integrity() to service_role;

commit;
