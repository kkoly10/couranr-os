-- =====================================================================
-- FOUNDATION GATE A / M3
-- Deterministic, idempotent legacy quote backfill.
--
-- Financial history is never normalized to look cleaner:
--   * obligation amount/policy/payer facts mint their own quote identity
--   * request line items are copied only when their arithmetic is exact
--   * incomplete/mismatched original evidence is retained in legacy_evidence
--   * plans and deliveries map through their actual obligation
--   * cross-object disagreement hard-refuses instead of guessing
--
-- UUIDs are deterministic hashes of the request and commercial fact tuple.
-- Re-running this helper before runtime cutover is idempotent.
-- =====================================================================

begin;
set local statement_timeout = '300s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regclass('public.couranr_quote_versions') is null then
    raise exception 'Gate A M3 requires M2 quote schema';
  end if;
  if exists (select 1 from public.couranr_quote_versions where record_origin = 'runtime') then
    raise exception 'M3 cannot run after runtime quote creation has begun';
  end if;
  if exists (
    select 1
      from public.couranr_payment_obligations o
      left join public.couranr_delivery_requests r on r.id = o.request_id
     where r.id is null
        or o.business_account_id is distinct from r.business_account_id
  ) then
    raise exception 'unmappable payment obligation: request missing or tenancy disagrees';
  end if;
  if exists (
    select 1
      from public.couranr_service_plans p
      left join public.couranr_payment_obligations o on o.id = p.payment_obligation_id
      left join public.couranr_delivery_requests r on r.id = p.request_id
     where o.id is null or r.id is null
        or o.request_id is distinct from p.request_id
        or p.business_account_id is distinct from r.business_account_id
        or p.business_account_id is distinct from o.business_account_id
  ) then
    raise exception 'unmappable service plan: request/obligation/tenancy disagrees';
  end if;
  if exists (
    select 1
      from public.couranr_deliveries d
      left join public.couranr_service_plans p on p.id = d.service_plan_id
      left join public.couranr_payment_obligations o on o.id = d.payment_obligation_id
      left join public.couranr_delivery_requests r on r.id = d.request_id
     where p.id is null or o.id is null or r.id is null
        or p.request_id is distinct from d.request_id
        or o.request_id is distinct from d.request_id
        or p.payment_obligation_id is distinct from d.payment_obligation_id
        or d.business_account_id is distinct from r.business_account_id
        or d.business_account_id is distinct from p.business_account_id
        or d.business_account_id is distinct from o.business_account_id
  ) then
    raise exception 'unmappable delivery: request/plan/obligation/tenancy disagrees';
  end if;
end
$guard$;

create function private.couranr_foundation_backfill_quote_versions()
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_req               public.couranr_delivery_requests;
  v_fact              record;
  v_quote_id          uuid;
  v_current_quote_id  uuid;
  v_previous_quote_id uuid;
  v_quote_number      integer;
  v_line_total        bigint;
  v_line_items        jsonb;
  v_provenance        text;
  v_matches_current   boolean;
  v_snapshots_known   boolean;
  v_requests_mapped   bigint;
  v_obligations_mapped bigint;
  v_plans_mapped      bigint;
  v_deliveries_mapped bigint;
begin
  if exists (select 1 from public.couranr_quote_versions where record_origin = 'runtime') then
    raise exception 'backfill_refuses_after_runtime_quotes';
  end if;

  for v_req in
    select * from public.couranr_delivery_requests order by created_at, id
  loop
    v_quote_number := 0;
    v_previous_quote_id := null;
    v_current_quote_id := null;

    -- Each distinct historical obligation representation gets exactly one
    -- quote. This handles an older payment whose commercial facts differ from
    -- the request's current compatibility projection.
    for v_fact in
      select amount_cents, pricing_policy_version, payer_type,
             min(created_at) as first_created_at,
             min(request_version) as evidence_request_version,
             bool_or(payment_state <> 'cancelled') as has_live_obligation
        from public.couranr_payment_obligations
       where request_id = v_req.id
       group by amount_cents, pricing_policy_version, payer_type
       -- Superseded/cancelled commercial facts are historical predecessors.
       -- The representation matching the current request projection sorts last,
       -- so current_quote_version_id can always point at the append-chain tip.
       order by
         case when amount_cents is not distinct from v_req.delivery_subtotal_cents
                   and pricing_policy_version is not distinct from v_req.pricing_policy_version
                   and payer_type is not distinct from v_req.payer_type
              then 1 else 0 end,
         case when bool_or(payment_state <> 'cancelled') then 1 else 0 end,
         min(created_at), pricing_policy_version, amount_cents, payer_type
    loop
      v_quote_number := v_quote_number + 1;
      v_quote_id := md5(
        'couranr-gate-a:obligation:' || v_req.id::text || ':' ||
        v_fact.amount_cents::text || ':' || v_fact.pricing_policy_version || ':' ||
        v_fact.payer_type
      )::uuid;
      v_matches_current :=
        v_req.delivery_subtotal_cents is not distinct from v_fact.amount_cents
        and v_req.pricing_policy_version is not distinct from v_fact.pricing_policy_version
        and v_req.payer_type is not distinct from v_fact.payer_type;

      v_line_total := public.couranr_quote_line_items_total(v_req.quote_line_items);
      v_snapshots_known := v_matches_current;
      if v_matches_current
         and v_line_total is not null
         and v_line_total = v_fact.amount_cents::bigint then
        v_line_items := v_req.quote_line_items;
        v_provenance := 'verified';
      elsif v_matches_current
            and jsonb_typeof(v_req.quote_line_items) = 'array'
            and jsonb_array_length(v_req.quote_line_items) > 0
            and v_line_total is not null then
        v_line_items := null;
        v_provenance := 'legacy_mismatch';
      else
        v_line_items := null;
        v_provenance := 'legacy_partial';
      end if;

      if not exists (select 1 from public.couranr_quote_versions where id=v_quote_id) then
        insert into public.couranr_quote_versions (
        id, request_id, quote_number, supersedes_quote_version_id,
        created_by_user_id, request_version_at_creation,
        quote_status, pricing_policy_version, payer_type, currency,
        subtotal_cents, included_loaded_miles, billable_loaded_miles,
        quote_line_items, review_reasons,
        pickup_address_snapshot, dropoff_address_snapshot, recipient_snapshot,
        shipment_snapshot, service_configuration_snapshot,
        loaded_distance_miles, route_duration_seconds, distance_source,
        provenance_state, record_origin, legacy_evidence
      ) values (
        v_quote_id, v_req.id, v_quote_number, v_previous_quote_id,
        v_req.created_by, v_fact.evidence_request_version,
        'estimated', v_fact.pricing_policy_version, v_fact.payer_type, 'usd',
        v_fact.amount_cents,
        case when v_matches_current then v_req.included_loaded_miles else null end,
        case when v_matches_current then v_req.billable_loaded_miles else null end,
        v_line_items,
        case when v_matches_current then v_req.review_reasons else '[]'::jsonb end,
        case when v_snapshots_known then v_req.pickup_address else null end,
        case when v_snapshots_known then v_req.dropoff_address else null end,
        case when v_snapshots_known then jsonb_build_object(
          'name', v_req.recipient_name, 'phone', v_req.recipient_phone,
          'email', v_req.recipient_email) else null end,
        case when v_snapshots_known then jsonb_build_object(
          'loadedMiles', v_req.loaded_miles, 'weightLb', v_req.weight_lb,
          'additionalStops', v_req.additional_stops) else null end,
        case when v_snapshots_known then jsonb_build_object(
          'serviceLevel', v_req.service_level,
          'signatureRequired', v_req.signature_required,
          'proofMethod', v_req.proof_method) else null end,
        case when v_snapshots_known then v_req.loaded_miles else null end,
        null,
        case when v_snapshots_known and v_req.loaded_miles is not null
          then 'legacy_request' else null end,
        v_provenance, 'legacy_backfill',
        jsonb_build_object(
          'source', 'payment_obligation',
          'firstObligationCreatedAt', v_fact.first_created_at,
          'requestProjectionMatched', v_matches_current,
          'originalRequestSubtotalCents', v_req.delivery_subtotal_cents,
          'originalRequestPricingPolicyVersion', v_req.pricing_policy_version,
          'originalRequestLineItems', v_req.quote_line_items
        )
        );
      elsif not exists (
        select 1 from public.couranr_quote_versions q
         where q.id=v_quote_id and q.request_id=v_req.id
           and q.quote_number=v_quote_number
           and q.supersedes_quote_version_id is not distinct from v_previous_quote_id
           and q.subtotal_cents is not distinct from v_fact.amount_cents
           and q.pricing_policy_version is not distinct from v_fact.pricing_policy_version
           and q.payer_type is not distinct from v_fact.payer_type
           and q.record_origin='legacy_backfill'
      ) then
        raise exception 'deterministic obligation quote id collision for request %',v_req.id;
      end if;

      update public.couranr_payment_obligations
         set quote_version_id = v_quote_id
       where request_id = v_req.id
         and amount_cents = v_fact.amount_cents
         and pricing_policy_version = v_fact.pricing_policy_version
         and payer_type = v_fact.payer_type
         and quote_version_id is null;

      if v_matches_current then
        v_current_quote_id := v_quote_id;
      end if;
      v_previous_quote_id := v_quote_id;
    end loop;

    -- If the mutable request represents a commercial generation not already
    -- represented by an obligation, preserve it as the last legacy quote.
    if v_req.quote_status <> 'not_quoted' and v_current_quote_id is null then
      v_quote_number := v_quote_number + 1;
      v_quote_id := md5(
        'couranr-gate-a:request:' || v_req.id::text || ':' ||
        coalesce(v_req.delivery_subtotal_cents::text, 'null') || ':' ||
        coalesce(v_req.pricing_policy_version, 'null') || ':' || v_req.payer_type || ':' ||
        v_req.quote_status
      )::uuid;
      v_line_total := public.couranr_quote_line_items_total(v_req.quote_line_items);

      if v_req.quote_status = 'estimated'
         and v_line_total is not null
         and v_line_total = v_req.delivery_subtotal_cents::bigint then
        v_line_items := v_req.quote_line_items;
        v_provenance := 'verified';
      elsif v_req.quote_status = 'estimated'
            and jsonb_typeof(v_req.quote_line_items) = 'array'
            and jsonb_array_length(v_req.quote_line_items) > 0
            and v_line_total is not null then
        v_line_items := null;
        v_provenance := 'legacy_mismatch';
      else
        v_line_items := null;
        v_provenance := 'legacy_partial';
      end if;

      if not exists (select 1 from public.couranr_quote_versions where id=v_quote_id) then
        insert into public.couranr_quote_versions (
        id, request_id, quote_number, supersedes_quote_version_id,
        created_by_user_id, request_version_at_creation,
        quote_status, pricing_policy_version, payer_type, currency,
        subtotal_cents, included_loaded_miles, billable_loaded_miles,
        quote_line_items, review_reasons,
        pickup_address_snapshot, dropoff_address_snapshot, recipient_snapshot,
        shipment_snapshot, service_configuration_snapshot,
        loaded_distance_miles, route_duration_seconds, distance_source,
        provenance_state, record_origin, legacy_evidence
      ) values (
        v_quote_id, v_req.id, v_quote_number, v_previous_quote_id,
        v_req.created_by, v_req.version,
        case when v_req.quote_status = 'not_quoted' then 'invalid' else v_req.quote_status end,
        v_req.pricing_policy_version, v_req.payer_type, 'usd',
        v_req.delivery_subtotal_cents, v_req.included_loaded_miles,
        v_req.billable_loaded_miles, v_line_items, v_req.review_reasons,
        v_req.pickup_address, v_req.dropoff_address,
        jsonb_build_object('name', v_req.recipient_name, 'phone', v_req.recipient_phone,
                           'email', v_req.recipient_email),
        jsonb_build_object('loadedMiles', v_req.loaded_miles, 'weightLb', v_req.weight_lb,
                           'additionalStops', v_req.additional_stops),
        jsonb_build_object('serviceLevel', v_req.service_level,
                           'signatureRequired', v_req.signature_required,
                           'proofMethod', v_req.proof_method),
        v_req.loaded_miles, null,
        case when v_req.loaded_miles is not null then 'legacy_request' else null end,
        v_provenance, 'legacy_backfill',
        jsonb_build_object(
          'source', 'request_projection',
          'requestUpdatedAt', v_req.updated_at,
          'originalQuoteStatus', v_req.quote_status,
          'originalSubtotalCents', v_req.delivery_subtotal_cents,
          'originalPricingPolicyVersion', v_req.pricing_policy_version,
          'originalLineItems', v_req.quote_line_items
        )
        );
      elsif not exists (
        select 1 from public.couranr_quote_versions q
         where q.id=v_quote_id and q.request_id=v_req.id
           and q.quote_number=v_quote_number
           and q.supersedes_quote_version_id is not distinct from v_previous_quote_id
           and q.quote_status is not distinct from
             (case when v_req.quote_status='not_quoted' then 'invalid' else v_req.quote_status end)
           and q.subtotal_cents is not distinct from v_req.delivery_subtotal_cents
           and q.pricing_policy_version is not distinct from v_req.pricing_policy_version
           and q.payer_type is not distinct from v_req.payer_type
           and q.record_origin='legacy_backfill'
      ) then
        raise exception 'deterministic request quote id collision for request %',v_req.id;
      end if;

      v_current_quote_id := v_quote_id;
      v_previous_quote_id := v_quote_id;
    end if;

    -- A delivery or one live obligation is deterministic commercial evidence
    -- when the request projection itself is absent. Canceled alternatives are
    -- never guessed as current.
    if v_current_quote_id is null then
      select o.quote_version_id into v_current_quote_id
        from public.couranr_deliveries d
        join public.couranr_payment_obligations o on o.id = d.payment_obligation_id
       where d.request_id = v_req.id
       limit 1;
    end if;
    if v_current_quote_id is null then
      select quote_version_id into v_current_quote_id
        from public.couranr_payment_obligations
       where request_id = v_req.id and payment_state <> 'cancelled'
       limit 1;
    end if;

    if v_current_quote_id is not null then
      update public.couranr_delivery_requests
         set current_quote_version_id = v_current_quote_id
       where id = v_req.id and current_quote_version_id is null;
    end if;
  end loop;

  if exists (select 1 from public.couranr_payment_obligations where quote_version_id is null) then
    raise exception 'unmappable payment obligation remained after backfill';
  end if;

  update public.couranr_service_plans p
     set quote_version_id = o.quote_version_id
    from public.couranr_payment_obligations o
   where o.id = p.payment_obligation_id
     and p.quote_version_id is null;

  update public.couranr_deliveries d
     set quote_version_id = o.quote_version_id
    from public.couranr_payment_obligations o,
         public.couranr_service_plans p
   where o.id = d.payment_obligation_id
     and p.id = d.service_plan_id
     and p.payment_obligation_id = o.id
     and p.quote_version_id = o.quote_version_id
     and d.quote_version_id is null;

  if exists (
    select 1
      from public.couranr_service_plans p
      join public.couranr_payment_obligations o on o.id = p.payment_obligation_id
     where p.quote_version_id is null
        or p.quote_version_id is distinct from o.quote_version_id
  ) then
    raise exception 'service plan could not be mapped deterministically';
  end if;
  if exists (
    select 1
      from public.couranr_deliveries d
      join public.couranr_service_plans p on p.id = d.service_plan_id
      join public.couranr_payment_obligations o on o.id = d.payment_obligation_id
     where d.quote_version_id is null
        or d.quote_version_id is distinct from p.quote_version_id
        or d.quote_version_id is distinct from o.quote_version_id
  ) then
    raise exception 'delivery/plan/obligation quote mapping disagrees';
  end if;

  select count(*) into v_requests_mapped
    from public.couranr_delivery_requests where current_quote_version_id is not null;
  select count(*) into v_obligations_mapped
    from public.couranr_payment_obligations where quote_version_id is not null;
  select count(*) into v_plans_mapped
    from public.couranr_service_plans where quote_version_id is not null;
  select count(*) into v_deliveries_mapped
    from public.couranr_deliveries where quote_version_id is not null;

  return jsonb_build_object(
    'requestsMapped', v_requests_mapped,
    'obligationsMapped', v_obligations_mapped,
    'plansMapped', v_plans_mapped,
    'deliveriesMapped', v_deliveries_mapped,
    'verified', (select count(*) from public.couranr_quote_versions where provenance_state='verified'),
    'legacyPartial', (select count(*) from public.couranr_quote_versions where provenance_state='legacy_partial'),
    'legacyMismatch', (select count(*) from public.couranr_quote_versions where provenance_state='legacy_mismatch')
  );
end
$fn$;

revoke all on function private.couranr_foundation_backfill_quote_versions()
  from public, anon, authenticated, service_role;

select private.couranr_foundation_backfill_quote_versions();

commit;
