-- Controlled-pilot credit parity for real Business-created requests.
--
-- The pilot-credit settlement model already exists and never fabricates Stripe
-- authorization/capture. This correction closes the Operations UI/E2E gap:
-- a real merchant_portal Business request may be funded by Couranr exactly like
-- an Operations-assisted Business request, while preserving the original source.
--
-- Authority remains narrow:
--   * Operations/admin actor only
--   * requester_kind=business
--   * payer_type=merchant
--   * source in operations|merchant_portal only
--   * exact immutable current quote, no caller-supplied amount
--   * no committed real payment may coexist
--   * all PRC-003 metadata is recorded separately from the quote
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

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
  if not exists (
    select 1 from public.profiles p
    where p.id=p_actor_user_id and p.role='admin'
  ) then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;

  if nullif(btrim(p_reason),'') is null
     or nullif(btrim(p_campaign),'') is null
     or nullif(btrim(p_market),'') is null
     or nullif(btrim(p_category),'') is null
     or length(btrim(p_reason)) > 160
     or length(btrim(p_campaign)) > 120
     or length(btrim(p_market)) > 120
     or length(btrim(p_category)) > 120 then
    raise exception 'promotional_credit_metadata_invalid' using errcode='CR400';
  end if;

  if v_req.requester_kind <> 'business'
     or v_req.business_account_id is null
     or v_req.source not in ('operations','merchant_portal')
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
  -- A pilot credit is an ALTERNATIVE commercial authority, never a second
  -- authority layered over a live Stripe lane. Even not_started/requires_action
  -- can still become a provider hold from a stale payer tab, so Operations must
  -- resolve/cancel that lane before Couranr funding is applied.
  if found then
    raise exception 'payment_path_already_started' using errcode='CR409';
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
      'quoteExpiredAtCredit',v_quote_expired,
      'requestSource',v_req.source
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

-- Reverse-direction invariant. Applying a credit already refuses every live
-- payment obligation above. This trigger closes the race from the other side:
-- once an applied credit exists, no stale merchant/customer tab, webhook or
-- retry may create/reanimate a non-cancelled Stripe obligation for the request.
create or replace function private.couranr_guard_promotional_credit_payment_exclusivity()
returns trigger
language plpgsql
set search_path=''
as $fn$
begin
  if new.payment_state <> 'cancelled'
     and exists (
       select 1
       from public.couranr_promotional_credits c
       where c.request_id=new.request_id
         and c.status='applied'
     ) then
    raise exception 'promotional_credit_already_applied' using errcode='CR409';
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_guard_promotional_credit_payment_exclusivity()
  from public,anon,authenticated,service_role;

drop trigger if exists couranr_po_promotional_credit_exclusivity
  on public.couranr_payment_obligations;
create trigger couranr_po_promotional_credit_exclusivity
before insert or update on public.couranr_payment_obligations
for each row execute function private.couranr_guard_promotional_credit_payment_exclusivity();

commit;
