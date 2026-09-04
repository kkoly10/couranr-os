-- =====================================================================
-- PILOT: OPERATIONS-ASSISTED BUSINESS PAYER HANDOFF
--
-- An Operations-created Business request deliberately submits with
-- acknowledgment=false: Operations entering a phone/text/email order is not
-- the merchant approving a price. The old accept-as-quoted function treated
-- every merchant-paid request as though that approval had to exist at submit,
-- so a truthful Operations-assisted request could never leave review.
--
-- New rule:
--   * merchant self-service + matching acknowledgment => confirmed (unchanged)
--   * Operations-assisted + merchant pays + no acknowledgment
--       => awaiting_quote_acceptance
--   * customer/consumer rules remain unchanged
--
-- The unapproved Operations-assisted quote is checked for QVL-001 expiry
-- BEFORE Couranr moves it out of review, so an expired quote remains
-- re-quotable instead of becoming stranded in awaiting_quote_acceptance.
-- Operations still never supplies payer approval.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regprocedure(
    'public.couranr_accept_delivery_request_as_quoted(uuid,uuid,integer,uuid)'
  ) is null then
    raise exception 'Operations-assisted payer handoff requires accept-as-quoted';
  end if;
  if to_regprocedure(
    'private.couranr_quote_version_is_expired(public.couranr_quote_versions,timestamptz)'
  ) is null then
    raise exception 'Operations-assisted payer handoff requires QVL-001';
  end if;
end
$guard$;

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

revoke all on function public.couranr_accept_delivery_request_as_quoted(
  uuid,uuid,integer,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_accept_delivery_request_as_quoted(
  uuid,uuid,integer,uuid
) to service_role;

commit;
