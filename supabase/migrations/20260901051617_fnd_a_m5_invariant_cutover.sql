-- =====================================================================
-- FOUNDATION GATE A / M5
-- Final invariant validation and authority enforcement.
-- =====================================================================

begin;
set local statement_timeout = '300s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regprocedure('public.couranr_create_quote_version(uuid,uuid,integer,uuid,text,text,integer,integer,numeric,jsonb,jsonb)') is null then
    raise exception 'Gate A M5 requires the M4 command cutover';
  end if;
  if exists (select 1 from public.couranr_payment_obligations where quote_version_id is null)
     or exists (select 1 from public.couranr_service_plans where quote_version_id is null)
     or exists (select 1 from public.couranr_deliveries where quote_version_id is null) then
    raise exception 'Gate A M5 refuses null quote identity on payment/plan/delivery';
  end if;
  if exists (
    select 1 from public.couranr_delivery_requests
     where quote_status <> 'not_quoted' and current_quote_version_id is null
  ) then
    raise exception 'Gate A M5 refuses a commercial request without current quote identity';
  end if;
  if exists (
    select 1
      from public.couranr_payment_obligations o
      join public.couranr_quote_versions q on q.id=o.quote_version_id
      join public.couranr_delivery_requests r on r.id=o.request_id
     where q.request_id is distinct from o.request_id
        or o.business_account_id is distinct from r.business_account_id
        or q.subtotal_cents is distinct from o.amount_cents
        or q.pricing_policy_version is distinct from o.pricing_policy_version
        or q.payer_type is distinct from o.payer_type
        or q.currency is distinct from o.currency
  ) then
    raise exception 'Gate A M5 payment/quote commercial mismatch';
  end if;
  if exists (
    select 1
      from public.couranr_service_plans p
      join public.couranr_payment_obligations o on o.id=p.payment_obligation_id
      join public.couranr_delivery_requests r on r.id=p.request_id
     where p.request_id is distinct from o.request_id
        or p.business_account_id is distinct from r.business_account_id
        or p.business_account_id is distinct from o.business_account_id
        or p.quote_version_id is distinct from o.quote_version_id
  ) then
    raise exception 'Gate A M5 plan/obligation quote mismatch';
  end if;
  if exists (
    select 1
      from public.couranr_deliveries d
      join public.couranr_service_plans p on p.id=d.service_plan_id
      join public.couranr_payment_obligations o on o.id=d.payment_obligation_id
      join public.couranr_delivery_requests r on r.id=d.request_id
     where d.request_id is distinct from p.request_id
        or d.request_id is distinct from o.request_id
        or d.business_account_id is distinct from r.business_account_id
        or d.business_account_id is distinct from p.business_account_id
        or d.business_account_id is distinct from o.business_account_id
        or d.quote_version_id is distinct from p.quote_version_id
        or d.quote_version_id is distinct from o.quote_version_id
  ) then
    raise exception 'Gate A M5 delivery/plan/obligation quote mismatch';
  end if;
end
$guard$;

alter table public.couranr_delivery_requests
  validate constraint couranr_dr_current_quote_request_fk;
alter table public.couranr_payment_obligations
  validate constraint couranr_po_quote_request_fk,
  alter column quote_version_id set not null;
alter table public.couranr_service_plans
  validate constraint couranr_sp_quote_request_fk,
  alter column quote_version_id set not null;
alter table public.couranr_deliveries
  validate constraint couranr_dlv_quote_request_fk,
  alter column quote_version_id set not null;

alter table public.couranr_delivery_requests
  add constraint couranr_dr_quote_identity_completeness_chk check (
    (quote_status = 'not_quoted' and current_quote_version_id is null)
    or (quote_status <> 'not_quoted' and current_quote_version_id is not null)
  );

-- Quote history is immutable for every role, not only by application habit.
create function private.couranr_quote_versions_are_append_only()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
begin
  raise exception 'quote_versions_are_append_only' using errcode='CR409';
end
$fn$;

revoke all on function private.couranr_quote_versions_are_append_only()
  from public,anon,authenticated,service_role;
grant execute on function private.couranr_quote_versions_are_append_only() to service_role;

create trigger couranr_qv_append_only_trg
before update or delete on public.couranr_quote_versions
for each row execute function private.couranr_quote_versions_are_append_only();

-- The six request columns below are now a compatibility projection. Only the
-- quote append primitive sets the transaction-local capability before writing
-- them; other state-machine commands may still update the request normally.
create function private.couranr_protect_request_quote_projection()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
begin
  if (new.current_quote_version_id,new.quote_status,new.pricing_policy_version,
      new.delivery_subtotal_cents,new.included_loaded_miles,
      new.billable_loaded_miles,new.quote_line_items,new.review_reasons)
     is distinct from
     (old.current_quote_version_id,old.quote_status,old.pricing_policy_version,
      old.delivery_subtotal_cents,old.included_loaded_miles,
      old.billable_loaded_miles,old.quote_line_items,old.review_reasons)
     and coalesce(current_setting('couranr.quote_projection_write',true),'')<>'on' then
    raise exception 'quote_projection_requires_named_quote_command' using errcode='CR409';
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_protect_request_quote_projection()
  from public,anon,authenticated,service_role;
grant execute on function private.couranr_protect_request_quote_projection() to service_role;

create trigger couranr_dr_quote_projection_trg
before update on public.couranr_delivery_requests
for each row execute function private.couranr_protect_request_quote_projection();

-- Commercial identity on obligations is immutable and must match its quote.
create function private.couranr_enforce_obligation_quote()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_q public.couranr_quote_versions;
  v_r public.couranr_delivery_requests;
begin
  if tg_op='UPDATE' and
     (new.request_id,new.business_account_id,new.payer_type,new.quote_version_id,
      new.pricing_policy_version,new.amount_cents,new.currency,new.provider)
     is distinct from
     (old.request_id,old.business_account_id,old.payer_type,old.quote_version_id,
      old.pricing_policy_version,old.amount_cents,old.currency,old.provider) then
    raise exception 'payment_obligation_commercial_identity_is_immutable' using errcode='CR409';
  end if;
  select * into v_q from public.couranr_quote_versions
   where id=new.quote_version_id and request_id=new.request_id;
  select * into v_r from public.couranr_delivery_requests where id=new.request_id;
  if v_q.id is null or v_r.id is null
     or new.business_account_id is distinct from v_r.business_account_id
     or new.payer_type is distinct from v_q.payer_type
     or new.pricing_policy_version is distinct from v_q.pricing_policy_version
     or new.amount_cents is distinct from v_q.subtotal_cents
     or new.currency is distinct from v_q.currency then
    raise exception 'payment_obligation_quote_mismatch' using errcode='CR409';
  end if;
  return new;
end
$fn$;

create trigger couranr_po_quote_invariant_trg
before insert or update on public.couranr_payment_obligations
for each row execute function private.couranr_enforce_obligation_quote();

create function private.couranr_enforce_plan_quote()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_o public.couranr_payment_obligations;
  v_r public.couranr_delivery_requests;
begin
  if tg_op='UPDATE' and
     (new.request_id,new.business_account_id,new.payment_obligation_id,
      new.quote_version_id,new.scheduled_pickup_start,new.scheduled_pickup_end,
      new.timezone,new.vehicle_id,new.vehicle_requirement)
     is distinct from
     (old.request_id,old.business_account_id,old.payment_obligation_id,
      old.quote_version_id,old.scheduled_pickup_start,old.scheduled_pickup_end,
      old.timezone,old.vehicle_id,old.vehicle_requirement) then
    raise exception 'service_plan_commitment_is_immutable' using errcode='CR409';
  end if;
  select * into v_o from public.couranr_payment_obligations
   where id=new.payment_obligation_id and request_id=new.request_id;
  select * into v_r from public.couranr_delivery_requests where id=new.request_id;
  if v_o.id is null or v_r.id is null
     or new.business_account_id is distinct from v_r.business_account_id
     or new.quote_version_id is distinct from v_o.quote_version_id
     or (tg_op='INSERT' and new.quote_version_id is distinct from v_r.current_quote_version_id) then
    raise exception 'service_plan_quote_mismatch' using errcode='CR409';
  end if;
  return new;
end
$fn$;

create trigger couranr_sp_quote_invariant_trg
before insert or update on public.couranr_service_plans
for each row execute function private.couranr_enforce_plan_quote();

create function private.couranr_enforce_delivery_quote()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_o public.couranr_payment_obligations;
  v_p public.couranr_service_plans;
  v_q public.couranr_quote_versions;
  v_r public.couranr_delivery_requests;
begin
  if tg_op='UPDATE' and
     (new.request_id,new.business_account_id,new.payment_obligation_id,
      new.service_plan_id,new.quote_version_id,new.pricing_policy_version,
      new.captured_amount_cents,new.currency,new.pickup_address,new.dropoff_address,
      new.recipient,new.shipment,new.service_level,new.signature_required,
      new.proof_method,new.scheduled_pickup_start,new.scheduled_pickup_end,
      new.timezone,new.vehicle_id,new.vehicle_requirement)
     is distinct from
     (old.request_id,old.business_account_id,old.payment_obligation_id,
      old.service_plan_id,old.quote_version_id,old.pricing_policy_version,
      old.captured_amount_cents,old.currency,old.pickup_address,old.dropoff_address,
      old.recipient,old.shipment,old.service_level,old.signature_required,
      old.proof_method,old.scheduled_pickup_start,old.scheduled_pickup_end,
      old.timezone,old.vehicle_id,old.vehicle_requirement) then
    raise exception 'delivery_commercial_snapshot_is_immutable' using errcode='CR409';
  end if;
  select * into v_o from public.couranr_payment_obligations where id=new.payment_obligation_id;
  select * into v_p from public.couranr_service_plans where id=new.service_plan_id;
  select * into v_q from public.couranr_quote_versions where id=new.quote_version_id;
  select * into v_r from public.couranr_delivery_requests where id=new.request_id;
  if v_o.id is null or v_p.id is null or v_q.id is null or v_r.id is null
     or v_o.request_id is distinct from new.request_id
     or v_p.request_id is distinct from new.request_id
     or v_q.request_id is distinct from new.request_id
     or new.business_account_id is distinct from v_r.business_account_id
     or new.quote_version_id is distinct from v_o.quote_version_id
     or new.quote_version_id is distinct from v_p.quote_version_id
     or new.quote_version_id is distinct from v_r.current_quote_version_id
     or new.pricing_policy_version is distinct from v_q.pricing_policy_version
     or new.captured_amount_cents is distinct from coalesce(v_o.captured_amount_cents,v_o.amount_cents)
     or new.currency is distinct from v_o.currency
     or new.pickup_address is distinct from v_q.pickup_address_snapshot
     or new.dropoff_address is distinct from v_q.dropoff_address_snapshot
     or new.recipient is distinct from v_q.recipient_snapshot
     or new.shipment is distinct from v_q.shipment_snapshot
     or new.service_level is distinct from v_q.service_configuration_snapshot->>'serviceLevel'
     or new.signature_required is distinct from
        coalesce((v_q.service_configuration_snapshot->>'signatureRequired')::boolean,false)
     or new.proof_method is distinct from v_q.service_configuration_snapshot->>'proofMethod'
     or new.scheduled_pickup_start is distinct from v_p.scheduled_pickup_start
     or new.scheduled_pickup_end is distinct from v_p.scheduled_pickup_end
     or new.timezone is distinct from v_p.timezone
     or new.vehicle_id is distinct from v_p.vehicle_id
     or new.vehicle_requirement is distinct from v_p.vehicle_requirement then
    raise exception 'delivery_quote_mismatch' using errcode='CR409';
  end if;
  return new;
end
$fn$;

create trigger couranr_dlv_quote_invariant_trg
before insert or update on public.couranr_deliveries
for each row execute function private.couranr_enforce_delivery_quote();

revoke all on function private.couranr_enforce_obligation_quote()
  from public,anon,authenticated,service_role;
revoke all on function private.couranr_enforce_plan_quote()
  from public,anon,authenticated,service_role;
revoke all on function private.couranr_enforce_delivery_quote()
  from public,anon,authenticated,service_role;
grant execute on function private.couranr_enforce_obligation_quote() to service_role;
grant execute on function private.couranr_enforce_plan_quote() to service_role;
grant execute on function private.couranr_enforce_delivery_quote() to service_role;

-- Permanent read-only integrity probe. It returns identifiers and invariant
-- facts only; no customer contact/address payload is emitted.
create function public.couranr_foundation_integrity()
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

-- No browser posture changes are tolerated at cutover.
do $security$
declare v_table text;
begin
  foreach v_table in array array[
    'couranr_delivery_requests','couranr_delivery_request_events',
    'couranr_quote_versions','couranr_payment_obligations','couranr_payment_events',
    'couranr_service_plans','couranr_deliveries','couranr_delivery_events',
    'couranr_delivery_assignments'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
       where n.nspname='public' and c.relname=v_table and c.relrowsecurity
    ) then
      raise exception 'RLS unexpectedly disabled on %',v_table;
    end if;
    if has_table_privilege('anon','public.'||v_table,'INSERT,UPDATE,DELETE')
       or has_table_privilege('authenticated','public.'||v_table,'INSERT,UPDATE,DELETE') then
      raise exception 'browser mutation grant unexpectedly present on %',v_table;
    end if;
  end loop;
end
$security$;

revoke all on table public.couranr_quote_versions from public,anon,authenticated,service_role;
grant select,insert on table public.couranr_quote_versions to service_role;

commit;
