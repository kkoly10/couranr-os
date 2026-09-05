-- ============================================================================
-- Rollback Hosted Request V1.
--
-- HARD REFUSAL: once even one hosted intake exists, the row is authority and
-- resume evidence. Dropping it would either strand a Consumer-owned request or
-- erase the only durable record of which merchant hosted the intake. Repair
-- forward instead.
-- ============================================================================

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $guard$
begin
  if to_regclass('public.couranr_hosted_request_intakes') is null then
    raise exception 'Hosted Request V1 table is absent; refusing ambiguous rollback';
  end if;
  if exists (select 1 from public.couranr_hosted_request_intakes) then
    raise exception 'Hosted Request V1 has durable intake evidence; repair forward instead of dropping it';
  end if;
end
$guard$;

drop function if exists public.couranr_mark_hosted_delivery_unavailable(uuid,uuid,integer,uuid);
drop function if exists public.couranr_mark_hosted_delivery_not_ready(uuid,uuid,integer,uuid);
drop function if exists public.couranr_mark_hosted_delivery_ready(uuid,uuid,integer,uuid);
drop function if exists public.couranr_begin_hosted_delivery_preparation(uuid,uuid,integer,uuid);
drop function if exists private.couranr_apply_hosted_merchant_readiness(uuid,uuid,integer,uuid,text,text,text[]);
drop function if exists public.couranr_validate_hosted_delivery_request(
  uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,jsonb
);
drop function if exists public.couranr_create_hosted_delivery_request(
  uuid,text,text,text,text,text,text,text,numeric,text,text,boolean,text
);
drop function if exists public.couranr_redeem_hosted_request_intake(text,text);
drop function if exists public.couranr_create_hosted_request_intake(text,text,integer);
drop function if exists public.couranr_resolve_hosted_request_merchant(text);

drop trigger if exists couranr_hri_identity_immutable_trg
  on public.couranr_hosted_request_intakes;
drop function if exists private.couranr_hosted_intake_identity_immutable();
drop table public.couranr_hosted_request_intakes restrict;

-- Restore the exact pre-hosted review ordering.
create or replace function public.couranr_try_auto_accept_standard_request(
  p_request_id uuid
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_submit jsonb;
  v_target text;
  v_lane_reason text;
begin
  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;

  if v_req.request_state<>'pending_couranr_review' or v_req.review_state<>'pending' then
    return v_req;
  end if;

  v_lane_reason:=private.couranr_automatic_lane_reason(v_req.id);
  if v_lane_reason is not null then return v_req; end if;

  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found then return v_req; end if;

  if v_req.requester_kind='consumer' then
    -- CAP-001: the consumer authorizes first, then the standard lane can be
    -- accepted automatically. No authorization means no automatic review.
    if not private.couranr_quote_payer_approved(v_quote) then return v_req; end if;
    v_target:='confirmed';
  elsif v_quote.payer_type='customer' then
    -- Couranr accepts service; the real customer still approves the amount.
    if private.couranr_quote_version_is_expired(v_quote) then return v_req; end if;
    v_target:='awaiting_quote_acceptance';
  else
    select metadata into v_submit
      from public.couranr_delivery_request_events
     where request_id=v_req.id and command='submit_delivery_request'
     order by created_at desc limit 1;

    if v_submit is not null
       and coalesce((v_submit->>'acknowledgment')::boolean,false)
       and (v_submit->>'quoteVersionId') is not distinct from v_quote.id::text then
      if private.couranr_quote_version_is_expired(v_quote) then return v_req; end if;
      v_target:='confirmed';
    else
      -- Service can be accepted, but the business still owns price approval.
      if private.couranr_quote_version_is_expired(v_quote) then return v_req; end if;
      v_target:='awaiting_quote_acceptance';
    end if;
  end if;

  update public.couranr_delivery_requests
     set request_state=v_target,
         review_state='accepted_as_quoted',
         version=version+1,
         updated_at=now()
   where id=v_req.id
     and version=v_req.version
     and request_state='pending_couranr_review'
     and review_state='pending'
  returning * into v_req;

  if not found then
    select * into v_req from public.couranr_delivery_requests where id=p_request_id;
    return v_req;
  end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'system','auto_accept_delivery_request',
    'pending_couranr_review',v_target,
    jsonb_build_object(
      'quoteVersionId',v_quote.id,
      'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,
      'reviewState','accepted_as_quoted',
      'quoteChanged',false,
      'automaticLane',true,
      'payerApprovalPending',v_target='awaiting_quote_acceptance'
    )
  );

  perform public.couranr_resolve_automation_exception(v_req.id,'review');
  return v_req;
end
$fn$;

create or replace function public.couranr_accept_delivery_request_as_quoted(
  p_request_id uuid,p_business_account_id uuid,p_expected_version integer,
  p_actor_user_id uuid
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_ack jsonb;
  v_submit_actor text;
  v_target text;
  v_operations_assisted boolean := false;
begin
  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id and business_account_id is not distinct from p_business_account_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.current_quote_version_id is null then
    raise exception 'no_server_quote_to_confirm' using errcode='CR422';
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found or v_quote.quote_status<>'estimated' or v_quote.subtotal_cents is null then
    raise exception 'no_server_quote_to_confirm' using errcode='CR422';
  end if;

  if v_req.requester_kind='consumer' then
    if private.couranr_quote_payer_approved(v_quote) then
      v_target:='confirmed';
    else
      raise exception 'consumer_quote_not_payer_approved' using errcode='CR409';
    end if;
  elsif v_quote.payer_type='merchant' then
    select metadata, actor_type into v_ack, v_submit_actor
      from public.couranr_delivery_request_events
     where request_id=v_req.id and command='submit_delivery_request'
     order by created_at desc limit 1;

    if v_ack is not null
       and coalesce((v_ack->>'acknowledgment')::boolean,false) is true then
      if (v_ack->>'quoteVersionId') is distinct from v_quote.id::text then
        raise exception 'quote_revised_since_acknowledgment' using errcode='CR412';
      end if;
      v_target:='confirmed';
    elsif v_req.source='operations'
       and v_submit_actor='operations'
       and v_ack is not null
       and (v_ack->>'quoteVersionId') is not distinct from v_quote.id::text then
      /*
       * Couranr may approve SERVICE, but it may not approve the merchant's
       * price. Leave the exact immutable quote waiting for the real Business
       * payer to authorize it through the existing payment path.
       *
       * Because that approval has not happened yet, the 15-minute commercial
       * window still applies now. Refusing before the state transition keeps
       * the request in review where Operations can mint Quote N+1.
       */
      if private.couranr_quote_version_is_expired(v_quote) then
        raise exception 'quote_expired' using errcode='CR410';
      end if;
      v_operations_assisted:=true;
      v_target:='awaiting_quote_acceptance';
    else
      raise exception 'merchant_acknowledgment_missing' using errcode='CR412';
    end if;
  else
    v_target:='awaiting_quote_acceptance';
  end if;

  if v_target='confirmed'
     and private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode='CR410';
  end if;

  update public.couranr_delivery_requests set
    request_state=v_target,review_state='accepted_as_quoted',
    version=p_expected_version+1,updated_at=now()
  where id=v_req.id and version=p_expected_version
    and request_state='pending_couranr_review' and review_state='pending'
  returning * into v_req;
  if not found then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'operations','accept_delivery_request_as_quoted',
    'pending_couranr_review',v_target,
    jsonb_build_object(
      'quoteVersionId',v_quote.id,
      'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,
      'reviewState','accepted_as_quoted',
      'quoteChanged',false,
      'operationsAssisted',v_operations_assisted,
      'payerApprovalPending',v_target='awaiting_quote_acceptance'
    )
  );
  return v_req;
end
$fn$;

revoke all on function public.couranr_try_auto_accept_standard_request(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_try_auto_accept_standard_request(uuid) to service_role;

revoke all on function public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid) to service_role;

commit;
