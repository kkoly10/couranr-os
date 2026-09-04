-- Roll back 20260904051500_operations_assisted_payer_handoff.
-- Restores the pre-pilot rule: a merchant-paid request can be accepted only
-- when the submit event itself recorded the merchant acknowledging the exact
-- current quote.

begin;

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
  v_target text;
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
    select metadata into v_ack from public.couranr_delivery_request_events
     where request_id=v_req.id and command='submit_delivery_request'
     order by created_at desc limit 1;
    if v_ack is null
       or coalesce((v_ack->>'acknowledgment')::boolean,false) is not true then
      raise exception 'merchant_acknowledgment_missing' using errcode='CR412';
    end if;
    if (v_ack->>'quoteVersionId') is distinct from v_quote.id::text then
      raise exception 'quote_revised_since_acknowledgment' using errcode='CR412';
    end if;
    v_target:='confirmed';
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
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'operations','accept_delivery_request_as_quoted',
    'pending_couranr_review',v_target,
    jsonb_build_object('quoteVersionId',v_quote.id,'quoteNumber',v_quote.quote_number,
      'payerType',v_quote.payer_type,'reviewState','accepted_as_quoted',
      'quoteChanged',false)
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
