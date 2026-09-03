-- =====================================================================
-- COURANR PAYMENT AUTHORIZATION EVIDENCE (launch batch 3 §A)
--
-- Fixes the PR #40 deferral: a Stripe authorization that actually happened at
-- provider time T1 but was processed by Couranr at T2 recorded
-- authorized_at = T2. QVL already evaluated the trusted provider time
-- (p_authorized_at) — only the ROW STAMP lied.
--
-- From this migration on:
--   authorized_at              = the provider's trusted authorization instant
--                                where available (signature-verified
--                                event.created), else Couranr processing time
--   authorization_processed_at = when Couranr applied/reconciled it (always)
--   authorized_at_source       = 'provider_event' when authorized_at carries
--                                the trusted provider instant;
--                                'processing_fallback' when the provider
--                                instant was UNKNOWN at processing and
--                                authorized_at carries processing time
--
-- A later signature-verified webhook for the same authorization UPGRADES a
-- processing_fallback row to the trusted provider instant (audited, state
-- unchanged, idempotent under the provider event id). Trusted evidence is
-- never overwritten and no provider time is ever fabricated.
--
-- HISTORY: existing rows are NOT rewritten. Their authorized_at was always
-- processing time, so the backfill records exactly that
-- (authorization_processed_at := authorized_at, source := processing_fallback)
-- and nothing else. No historical provider time is invented.
--
-- ADDITIVE: two columns, one CHECK, one in-place function replacement
-- (same 9-argument signature). Re-runnable throughout.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regprocedure('public.couranr_apply_payment_intent_state(text,text,text,text,integer,integer,text,jsonb,timestamptz)') is null then
    raise exception 'authorization evidence requires the 9-argument apply command (20260902161642)';
  end if;
end
$guard$;

alter table public.couranr_payment_obligations
  add column if not exists authorization_processed_at timestamptz,
  add column if not exists authorized_at_source text;

comment on column public.couranr_payment_obligations.authorized_at is
  'The authorization instant. Source discipline since batch 3 §A: the provider''s trusted instant when authorized_at_source=provider_event; Couranr processing time when processing_fallback (provider instant unknown). Historical rows predate the distinction and were always processing time.';
comment on column public.couranr_payment_obligations.authorization_processed_at is
  'When Couranr processed/reconciled the authorization transition. Always local server time; never the commercial approval instant.';
comment on column public.couranr_payment_obligations.authorized_at_source is
  'provider_event: authorized_at is the signature-verified provider instant. processing_fallback: the provider instant was unknown when processed; authorized_at carries processing time until a verified event upgrades it.';

alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_authorized_source_chk;
alter table public.couranr_payment_obligations
  add constraint couranr_po_authorized_source_chk check (
    authorized_at_source is null
    or authorized_at_source in ('provider_event','processing_fallback'));

/* Backfill FROM EVIDENCE ONLY: the historical stamp WAS processing time.
   MUST run BEFORE the evidence CHECK below — ADD CONSTRAINT validates every
   existing row at once, so on any database that already holds authorized
   obligations (production, or the pre-seeded backfill suite) the reverse
   order fails with "is violated by some row". Caught executed, not read:
   e2e/disposable/foundationBackfill.mjs. */
update public.couranr_payment_obligations
   set authorization_processed_at = authorized_at,
       authorized_at_source = 'processing_fallback'
 where authorized_at is not null
   and (authorization_processed_at is null or authorized_at_source is null);

/* One-directional, like the stamp fix: a row that carries an authorization
   stamp must say where it came from, and processing evidence must exist with
   it. Rows never authorized carry neither. */
alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_authorization_evidence_chk;
alter table public.couranr_payment_obligations
  add constraint couranr_po_authorization_evidence_chk check (
    (authorized_at is null)
    or (authorized_at_source is not null and authorization_processed_at is not null));

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

revoke all on function public.couranr_apply_payment_intent_state(
  text,text,text,text,integer,integer,text,jsonb,timestamptz
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_apply_payment_intent_state(
  text,text,text,text,integer,integer,text,jsonb,timestamptz
) to service_role;

commit;
