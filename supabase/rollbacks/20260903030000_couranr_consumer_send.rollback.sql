-- =====================================================================
-- ROLLBACK — consumer /send (20260903030000)
--
-- Drops the six consumer commands and the guest-session table, and restores
-- NOT NULL on couranr_delivery_access_tokens.business_account_id.
--
-- EVIDENCE GUARDS — HARD-REFUSE, forward repair required, when history would
-- be destroyed:
--   * any couranr_delivery_requests row with requester_kind = 'consumer'
--     (dropping the commands and the session table would strand real consumer
--     request history behind a FK and erase who could reach it);
--   * any couranr_consumer_guest_sessions row at all (a session is the only
--     record that a guest credential was ever minted);
--   * any couranr_delivery_access_tokens row with a NULL business_account_id
--     (SET NOT NULL would fail mid-transaction anyway; refuse it by name).
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $evidence$
declare v_count bigint;
begin
  select count(*) into v_count from public.couranr_delivery_requests
   where requester_kind = 'consumer';
  if v_count > 0 then
    raise exception
      'consumer_send_rollback_would_strand_consumer_requests: % consumer request(s) exist; forward repair required',
      v_count;
  end if;
end
$evidence$;

do $evidence$
declare v_count bigint;
begin
  select count(*) into v_count from public.couranr_consumer_guest_sessions;
  if v_count > 0 then
    raise exception
      'consumer_send_rollback_would_destroy_guest_sessions: % guest session(s) recorded; forward repair required',
      v_count;
  end if;
exception when undefined_table then
  null;
end
$evidence$;

do $evidence$
declare v_count bigint;
begin
  select count(*) into v_count from public.couranr_delivery_access_tokens
   where business_account_id is null;
  if v_count > 0 then
    raise exception
      'consumer_send_rollback_would_destroy_consumer_tracking_links: % null-business tracking link(s) exist; forward repair required',
      v_count;
  end if;
end
$evidence$;

drop function if exists public.couranr_submit_consumer_delivery_request(uuid,uuid,integer);
drop function if exists public.couranr_calculate_consumer_delivery_request_estimate(
  uuid,uuid,integer,boolean,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text);
drop function if exists public.couranr_create_consumer_delivery_request_draft(
  uuid,text,jsonb,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text);
drop function if exists public.couranr_bind_consumer_guest_request(uuid,uuid);
drop function if exists public.couranr_redeem_consumer_guest_session(text);
drop function if exists public.couranr_create_consumer_guest_session(text,integer);

drop table if exists public.couranr_consumer_guest_sessions restrict;

-- Safe because the evidence guard above proved no NULL exists.
alter table public.couranr_delivery_access_tokens
  alter column business_account_id set not null;

comment on column public.couranr_delivery_access_tokens.business_account_id is null;


/* Restore the pre-030000 bodies VERBATIM (extracted from 20260903010000 and
   20260902161642): the consumer branches leave with this migration, and the
   business behavior they wrapped returns untouched. */

create or replace function public.couranr_apply_payment_intent_state(
  p_provider_event_id text,p_event_type text,p_payment_intent_id text,
  p_intent_status text,p_amount integer,p_amount_capturable integer,
  p_currency text,p_metadata jsonb,
  /* When Stripe actually authorized. The payer approved THEN, not when this
     webhook happened to be processed. */
  p_authorized_at timestamptz default null
)
returns public.couranr_payment_apply_result
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_ob public.couranr_payment_obligations;
  v_quote public.couranr_quote_versions;
  v_req public.couranr_delivery_requests;
  v_out public.couranr_payment_apply_result;
  v_outcome text;
  v_reason text;
  v_target text;
  v_before text;
  v_reqstate text;
  v_ob_id uuid;
  v_req_id uuid;
  v_quote_is_current boolean;
begin
  if nullif(btrim(p_provider_event_id),'') is null then
    raise exception 'provider_event_id_required' using errcode='CR422';
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where provider_payment_intent_id=p_payment_intent_id;
  if not found then
    return row('rejected',null,null,null,null,'unknown_payment_intent')
      ::public.couranr_payment_apply_result;
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_ob.quote_version_id and request_id=v_ob.request_id;
  select * into v_req from public.couranr_delivery_requests where id=v_ob.request_id;
  v_quote_is_current := found and v_req.current_quote_version_id is not distinct from v_ob.quote_version_id;

  if not found or v_quote.id is null then
    v_outcome:='rejected';v_reason:='obligation_quote_missing';
  elsif p_amount is distinct from v_ob.amount_cents then
    v_outcome:='rejected';v_reason:='amount_mismatch';
  elsif lower(coalesce(p_currency,'')) is distinct from v_ob.currency then
    v_outcome:='rejected';v_reason:='currency_mismatch';
  elsif coalesce(p_metadata->>'paymentObligationId','')<>v_ob.id::text then
    v_outcome:='rejected';v_reason:='metadata_obligation_mismatch';
  elsif coalesce(p_metadata->>'couranrRequestId','')<>v_ob.request_id::text then
    v_outcome:='rejected';v_reason:='metadata_request_mismatch';
  elsif v_ob.business_account_id is not null
        and coalesce(p_metadata->>'businessAccountId','')<>v_ob.business_account_id::text then
    v_outcome:='rejected';v_reason:='metadata_business_mismatch';
  elsif v_ob.business_account_id is null
        and nullif(p_metadata->>'businessAccountId','') is not null then
    v_outcome:='rejected';v_reason:='metadata_business_mismatch';
  elsif nullif(p_metadata->>'quoteVersionId','') is null
        and v_quote.record_origin<>'legacy_backfill' then
    v_outcome:='rejected';v_reason:='metadata_quote_missing';
  elsif nullif(p_metadata->>'quoteVersionId','') is not null
        and (p_metadata->>'quoteVersionId')<>v_ob.quote_version_id::text then
    v_outcome:='rejected';v_reason:='metadata_quote_mismatch';
  elsif v_ob.payment_state='capture_pending' then
    v_outcome:='ignored';v_reason:='capture_reconciliation_is_authoritative';
  else
    case p_event_type
      when 'payment_intent.amount_capturable_updated' then
        if p_intent_status='requires_capture'
           and p_amount_capturable is not distinct from v_ob.amount_cents then
          /* QVL-001. THIS is the customer payer approving the quote: reaching
             requires_capture is what makes the obligation 'authorized', moves
             the request to 'confirmed' and records record_payer_quote_approval
             below. So it is the last boundary at which the 15-minute window
             can still refuse - and it must, because an obligation or intent
             created while the quote was fresh must not make the price
             immortal. Refused as a governed 'rejected' outcome, so nothing is
             authorized, no approval is recorded and Quote N is untouched. */
          /* Evaluated AS OF THE AUTHORIZATION, not as of now(). A payer who
             confirmed at 14:30 approved inside the window even if 3DS, a
             retry or a webhook backlog delivers this at 15:20 - and the rule
             is that an approval obtained in time is never undone by later
             time passing. Falls back to now() only when the caller cannot
             supply the moment. */
          if private.couranr_quote_version_is_expired(
               v_quote, coalesce(p_authorized_at, now())) then
            v_outcome:='rejected';v_reason:='quote_expired';
          else
            v_target:='authorized';v_outcome:='applied';
            if not v_quote_is_current then v_reason:='authorized_for_superseded_quote'; end if;
          end if;
        else
          v_outcome:='rejected';v_reason:='not_fully_capturable';
        end if;
      when 'payment_intent.requires_action' then
        v_target:='requires_action';v_outcome:='applied';
      when 'payment_intent.payment_failed' then
        v_target:='failed';v_outcome:='applied';
      when 'payment_intent.canceled' then
        v_target:='cancelled';v_outcome:='applied';
      else
        v_outcome:='ignored';v_reason:='unhandled_event_type';
    end case;
  end if;
  /* §A EVIDENCE UPGRADE. The synchronous reconcile path authorizes with NO
     provider instant (processing_fallback, by design — PaymentIntent.created
     is mint time, not approval). When the signature-verified webhook for the
     SAME authorization later arrives with the trusted event.created, the row
     is already 'authorized' and the state machine would shrug it off as
     already_in_state — losing the audit truth forever. Instead: converge the
     provider evidence onto the same obligation. State does not move, no
     approval is re-evaluated (an approval already granted is never undone),
     the event id keeps webhook idempotency, and only a fallback-sourced row
     can upgrade — trusted provider evidence is never overwritten. */
  if v_outcome='applied' and v_target='authorized'
     and v_ob.payment_state='authorized'
     and p_authorized_at is not null
     and v_ob.authorized_at_source='processing_fallback' then
    begin
      insert into public.couranr_payment_events(
        obligation_id,request_id,provider,provider_event_id,event_type,
        payment_state_before,payment_state_after,outcome,detail
      ) values (
        v_ob.id,v_ob.request_id,'stripe',p_provider_event_id,p_event_type,
        'authorized','authorized','applied',
        jsonb_build_object('paymentIntentId',p_payment_intent_id,
          'reason','authorization_time_reconciled',
          'providerAuthorizedAt',p_authorized_at,
          'previousAuthorizedAt',v_ob.authorized_at,
          'previousSource','processing_fallback')
      );
    exception when unique_violation then
      return row('duplicate',v_ob.id,v_ob.request_id,v_ob.payment_state,null,null)
        ::public.couranr_payment_apply_result;
    end;
    update public.couranr_payment_obligations set
      authorized_at=p_authorized_at,
      authorized_at_source='provider_event',
      version=version+1,updated_at=now()
    where id=v_ob.id and payment_state='authorized';
    select request_state into v_reqstate from public.couranr_delivery_requests
     where id=v_ob.request_id;
    return row('applied',v_ob.id,v_ob.request_id,'authorized',v_reqstate,
               'authorization_time_reconciled')
      ::public.couranr_payment_apply_result;
  end if;
  if v_outcome='applied' and v_ob.payment_state=v_target then
    v_outcome:='ignored';v_reason:='already_in_state';
  end if;
  v_before:=v_ob.payment_state;

  begin
    insert into public.couranr_payment_events(
      obligation_id,request_id,provider,provider_event_id,event_type,
      payment_state_before,payment_state_after,outcome,detail
    ) values (
      v_ob.id,v_ob.request_id,'stripe',p_provider_event_id,p_event_type,v_before,
      case when v_outcome='applied' then v_target else v_before end,v_outcome,
      jsonb_build_object('paymentIntentId',p_payment_intent_id,
        'intentStatus',p_intent_status,'amount',p_amount,
        'amountCapturable',p_amount_capturable,'currency',p_currency,
        'quoteVersionId',v_ob.quote_version_id,
        'currentQuoteVersionId',v_req.current_quote_version_id,'reason',v_reason)
    );
  exception when unique_violation then
    return row('duplicate',v_ob.id,v_ob.request_id,v_ob.payment_state,null,null)
      ::public.couranr_payment_apply_result;
  end;
  if v_outcome<>'applied' then
    return row(v_outcome,v_ob.id,v_ob.request_id,v_ob.payment_state,null,v_reason)
      ::public.couranr_payment_apply_result;
  end if;

  v_ob_id:=v_ob.id;v_req_id:=v_ob.request_id;
  update public.couranr_payment_obligations set
    payment_state=v_target,
    /* Correction (batch 3 §A): the provider's trusted authorization instant is
       the commercial evidence; Couranr's processing moment is bookkeeping.
       When the caller cannot supply a trustworthy provider instant the row
       says so (processing_fallback) instead of dressing processing time up
       as an authorization time. */
    authorized_at=case when v_target='authorized'
                       then coalesce(p_authorized_at, now()) else authorized_at end,
    authorization_processed_at=case when v_target='authorized'
                       then now() else authorization_processed_at end,
    authorized_at_source=case when v_target='authorized'
                       then case when p_authorized_at is not null
                                 then 'provider_event' else 'processing_fallback' end
                       else authorized_at_source end,
    failed_at=case when v_target='failed' then now() else failed_at end,
    cancelled_at=case when v_target='cancelled' then now() else cancelled_at end,
    version=version+1,updated_at=now()
  where id=v_ob_id and payment_state=v_before and payment_state<>'capture_pending'
  returning * into v_ob;
  if not found then
    return row('ignored',v_ob_id,v_req_id,v_before,null,'state_changed_during_apply')
      ::public.couranr_payment_apply_result;
  end if;

  if v_target='authorized' then
    select * into v_req from public.couranr_delivery_requests
     where id=v_ob.request_id for update;
    if v_req.current_quote_version_id is not distinct from v_ob.quote_version_id
       and v_req.request_state in ('awaiting_quote_acceptance','quote_revision_required') then
      v_reqstate:=v_req.request_state;
      update public.couranr_delivery_requests set
        request_state='confirmed',version=version+1,updated_at=now()
      where id=v_req.id returning * into v_req;
      insert into public.couranr_delivery_request_events(
        request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
      ) values (
        v_req.id,null,'system','record_payer_quote_approval',v_reqstate,'confirmed',
        jsonb_build_object('quoteVersionId',v_ob.quote_version_id,
          'payerType',v_ob.payer_type,'paymentObligationId',v_ob.id,
          'authorizedAmountCents',v_ob.amount_cents,
          'pricingPolicyVersion',v_ob.pricing_policy_version,
          'paymentState','authorized','captured',false)
      );
    end if;
    update public.couranr_payment_access_tokens set
      revoked_at=now(),revoked_reason='payment_authorized'
    where request_id=v_ob.request_id and revoked_at is null;
  end if;
  select request_state into v_reqstate from public.couranr_delivery_requests
   where id=v_ob.request_id;
  return row('applied',v_ob.id,v_ob.request_id,v_ob.payment_state,v_reqstate,v_reason)
    ::public.couranr_payment_apply_result;
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

  if v_quote.payer_type='merchant' then
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

  /* QVL-001, and ONLY on the branch that CONFIRMS. Operations accepting is not
     payer approval, and Couranr's own review latency must not expire a quote:
     a customer-paid request reviewed at 09:16 moves to awaiting_quote_acceptance
     normally, and the window is then enforced where the CUSTOMER actually
     approves. The merchant branch does confirm, so it is guarded - and a
     merchant who acknowledged in time is exempt via the predicate, so this only
     ever refuses a price nobody approved. */
  if v_target = 'confirmed'
     and private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode = 'CR410';
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

commit;
