-- Controlled Pilot credit audit: allow an Operations-approved promotional
-- credit to settle the exact current quote even when its payer-authorization
-- window has elapsed. We DO NOT refresh, change or backdate the quote. Instead
-- we record that the quote was expired when Couranr chose to fund it.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

alter table public.couranr_promotional_credits
  add column if not exists quote_expired_at_credit boolean not null default false;

create or replace function public.couranr_apply_promotional_credit(
  p_request_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_reason text,
  p_campaign text,
  p_market text,
  p_category text
)
returns public.couranr_promotional_credits
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_ob public.couranr_payment_obligations;
  v_credit public.couranr_promotional_credits;
  v_from text;
  v_quote_expired boolean;
begin
  select * into v_req
    from public.couranr_delivery_requests
   where id=p_request_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.version is distinct from p_expected_version then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;
  if v_req.requester_kind <> 'business'
     or v_req.business_account_id is null
     or v_req.source <> 'operations'
     or v_req.payer_type <> 'merchant' then
    raise exception 'promotional_credit_not_permitted' using errcode='CR403';
  end if;
  if v_req.request_state not in ('quote_revision_required','awaiting_quote_acceptance','confirmed') then
    raise exception 'request_not_creditable' using errcode='CR409';
  end if;
  if v_req.current_quote_version_id is null then
    raise exception 'no_server_quote_to_credit' using errcode='CR422';
  end if;

  select * into v_quote
    from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found or v_quote.quote_status <> 'estimated' or v_quote.subtotal_cents is null then
    raise exception 'no_server_quote_to_credit' using errcode='CR422';
  end if;

  v_quote_expired := private.couranr_quote_version_is_expired(v_quote);

  select * into v_ob
    from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state <> 'cancelled'
   order by created_at desc
   limit 1;
  if found and v_ob.payment_state in ('authorized','capture_pending','captured','refunded','partially_refunded') then
    raise exception 'payment_already_committed' using errcode='CR409';
  end if;

  select * into v_credit
    from public.couranr_promotional_credits
   where request_id=v_req.id and quote_version_id=v_quote.id;
  if found then return v_credit; end if;

  update public.couranr_promotional_credits
     set status='voided',voided_at=now()
   where request_id=v_req.id and status='applied';

  insert into public.couranr_promotional_credits(
    request_id,business_account_id,quote_version_id,
    standard_quote_cents,amount_paid_cents,promotional_credit_cents,currency,
    reason,campaign,market,category,approved_by,quote_expired_at_credit
  ) values (
    v_req.id,v_req.business_account_id,v_quote.id,
    v_quote.subtotal_cents,0,v_quote.subtotal_cents,'usd',
    btrim(p_reason),btrim(p_campaign),btrim(p_market),btrim(p_category),
    p_actor_user_id,v_quote_expired
  )
  returning * into v_credit;

  v_from:=v_req.request_state;
  update public.couranr_delivery_requests
     set request_state='confirmed',version=version+1,updated_at=now()
   where id=v_req.id and version=p_expected_version
  returning * into v_req;
  if not found then raise exception 'version_or_state_conflict' using errcode='CR409'; end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'operations','apply_promotional_credit',
    v_from,'confirmed',
    jsonb_build_object(
      'promotionalCreditId',v_credit.id,
      'quoteVersionId',v_quote.id,
      'quoteNumber',v_quote.quote_number,
      'standardQuoteCents',v_credit.standard_quote_cents,
      'amountPaidCents',v_credit.amount_paid_cents,
      'promotionalCreditCents',v_credit.promotional_credit_cents,
      'reason',v_credit.reason,
      'campaign',v_credit.campaign,
      'market',v_credit.market,
      'category',v_credit.category,
      'quoteExpiredAtCredit',v_quote_expired
    )
  );
  return v_credit;
end
$fn$;

revoke all on function public.couranr_apply_promotional_credit(
  uuid,integer,uuid,text,text,text,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_apply_promotional_credit(
  uuid,integer,uuid,text,text,text,text
) to service_role;

commit;