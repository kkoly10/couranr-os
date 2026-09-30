-- RR-003b: durable Route Run checkout settlement.
--
-- One accepted Route keeps separate child obligations. This migration performs
-- NO provider I/O, capture, dispatch, delivery creation or custody. It freezes
-- the exact accepted version/payment-profile generation and mints canonical
-- child obligations from server-owned quote rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

do $$ begin
  if to_regclass('public.couranr_route_runs') is null
     or to_regclass('public.couranr_route_run_claims') is null
     or to_regclass('public.couranr_business_payment_profiles') is null
     or to_regclass('public.couranr_payment_obligations') is null then
    raise exception 'route_settlement_requires_rr002_and_rr003a';
  end if;
end $$;

create table public.couranr_route_run_settlements (
  id uuid primary key default gen_random_uuid(),
  route_run_id uuid not null unique references public.couranr_route_runs(id),
  route_version_id uuid not null,
  business_account_id uuid not null references public.business_accounts(id),
  checkout_idempotency_key uuid not null,
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  payment_profile_generation integer not null,
  stripe_customer_id text not null,
  stripe_payment_method_id text not null,
  stripe_livemode boolean not null,
  card_brand text not null,
  card_last4 text not null,
  reference_total_cents integer not null,
  currency text not null default 'usd',
  settlement_state text not null default 'pending_authorization',
  provider_uncertainty_at timestamptz,
  provider_uncertainty_reason text,
  provider_uncertain_obligation_id uuid references public.couranr_payment_obligations(id),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couranr_rrsett_route_version_fk
    foreign key(route_run_id,route_version_id)
    references public.couranr_route_run_versions(route_run_id,id),
  constraint couranr_rrsett_key_uniq unique(route_run_id,checkout_idempotency_key),
  constraint couranr_rrsett_total_chk check(reference_total_cents>0),
  constraint couranr_rrsett_currency_chk check(currency='usd'),
  constraint couranr_rrsett_profile_generation_chk check(payment_profile_generation>=1),
  constraint couranr_rrsett_provider_snapshot_chk check(
    stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
    and stripe_payment_method_id ~ '^pm_[A-Za-z0-9]+$'
    and length(btrim(card_brand))>0 and card_last4 ~ '^[0-9]{4}$'
  ),
  constraint couranr_rrsett_version_chk check(version>=1),
  constraint couranr_rrsett_state_chk check(settlement_state in (
    'pending_authorization','authorization_required','authorization_failed',
    'authorization_unknown','authorized','resource_reserved','capture_pending',
    'recovery_required','captured','ready_for_execution','cancelled'
  )),
  constraint couranr_rrsett_unknown_shape_chk check (
    (settlement_state='authorization_unknown'
      and provider_uncertainty_at is not null and provider_uncertainty_reason is not null
      and provider_uncertain_obligation_id is not null)
    or (settlement_state<>'authorization_unknown'
      and provider_uncertainty_at is null and provider_uncertainty_reason is null
      and provider_uncertain_obligation_id is null)
  )
);

create table public.couranr_route_run_settlement_items (
  settlement_id uuid not null references public.couranr_route_run_settlements(id),
  sequence integer not null,
  request_id uuid not null unique references public.couranr_delivery_requests(id),
  quote_version_id uuid not null references public.couranr_quote_versions(id),
  obligation_id uuid not null unique references public.couranr_payment_obligations(id),
  amount_cents integer not null,
  currency text not null default 'usd',
  authorization_key text unique,
  authorization_attempted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key(settlement_id,sequence),
  constraint couranr_rrsetti_sequence_chk check(sequence between 1 and 5),
  constraint couranr_rrsetti_amount_chk check(amount_cents>0),
  constraint couranr_rrsetti_currency_chk check(currency='usd'),
  constraint couranr_rrsetti_attempt_shape_chk check(
    (authorization_key is null and authorization_attempted_at is null)
    or (authorization_key is not null and authorization_attempted_at is not null)
  )
);
create index couranr_rrsetti_settlement_request_idx
  on public.couranr_route_run_settlement_items(settlement_id,request_id);

create table public.couranr_route_run_settlement_events (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.couranr_route_run_settlements(id),
  actor_user_id uuid references auth.users(id),
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint couranr_rrsette_type_chk check(event_type in (
    'checkout_confirmed','authorization_attempt_started','provider_uncertain','provider_reconciled',
    'authorization_state_changed','resource_reserved','capture_state_changed',
    'recovery_required','ready_for_execution','checkout_cancelled'
  )),
  constraint couranr_rrsette_detail_chk check(jsonb_typeof(detail)='object')
);
create index couranr_rrsette_settlement_created_idx
  on public.couranr_route_run_settlement_events(settlement_id,created_at);

alter table public.couranr_route_run_settlements enable row level security;
alter table public.couranr_route_run_settlement_items enable row level security;
alter table public.couranr_route_run_settlement_events enable row level security;
revoke all on public.couranr_route_run_settlements from public,anon,authenticated,service_role;
revoke all on public.couranr_route_run_settlement_items from public,anon,authenticated,service_role;
revoke all on public.couranr_route_run_settlement_events from public,anon,authenticated,service_role;
grant select on public.couranr_route_run_settlements to service_role;
grant select on public.couranr_route_run_settlement_items to service_role;
grant select on public.couranr_route_run_settlement_events to service_role;

create or replace function private.couranr_require_route_checkout_member(
  p_business_account_id uuid,p_actor_user_id uuid
) returns void
language plpgsql security definer set search_path='' as $fn$
begin
  if not exists(
    select 1 from public.business_members m
    where m.business_account_id=p_business_account_id
      and m.user_id=p_actor_user_id
      and m.status='active'
      and m.role in ('owner','manager')
  ) then
    raise exception 'route_checkout_access_denied' using errcode='CR403';
  end if;
end
$fn$;
revoke all on function private.couranr_require_route_checkout_member(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.couranr_require_route_checkout_member(uuid,uuid)
  to service_role;

create or replace function private.couranr_route_settlement_view(p_settlement uuid)
returns jsonb language sql stable set search_path='' as $fn$
  select jsonb_build_object(
    'settlementId',s.id,
    'routeRunId',s.route_run_id,
    'businessAccountId',s.business_account_id,
    'state',s.settlement_state,
    'version',s.version,
    'confirmedAt',s.confirmed_at,
    'referenceTotalCents',s.reference_total_cents,
    'currency',s.currency,
    'card',jsonb_build_object('brand',s.card_brand,'last4',s.card_last4),
    'providerOutcomeUnknown',(s.settlement_state='authorization_unknown'),
    'uncertainObligationId',s.provider_uncertain_obligation_id,
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'sequence',i.sequence,
        'requestId',i.request_id,
        'quoteVersionId',i.quote_version_id,
        'obligationId',i.obligation_id,
        'amountCents',i.amount_cents,
        'currency',i.currency,
        'paymentState',o.payment_state,
        'obligationVersion',o.version
      ) order by i.sequence)
      from public.couranr_route_run_settlement_items i
      join public.couranr_payment_obligations o on o.id=i.obligation_id
      where i.settlement_id=s.id
    ),'[]'::jsonb)
  )
  from public.couranr_route_run_settlements s where s.id=p_settlement
$fn$;

-- Keep the ordinary and Route obligation writers on one canonical insertion
-- rule. The callers own their different admission gates; this helper owns
-- supersession, quote freshness, generation and immutable money fields.
create or replace function private.couranr_create_obligation_for_quote(
  p_request public.couranr_delivery_requests,
  p_quote public.couranr_quote_versions,
  p_idempotency_key text
) returns public.couranr_payment_obligations
language plpgsql security invoker set search_path='' as $fn$
declare
  v_ob public.couranr_payment_obligations;
  v_gen integer;
begin
  if p_request.id is null or p_quote.id is null
     or p_quote.request_id is distinct from p_request.id
     or p_request.current_quote_version_id is distinct from p_quote.id
     or p_quote.quote_status<>'estimated'
     or p_quote.subtotal_cents is null or p_quote.subtotal_cents<=0
     or nullif(btrim(p_idempotency_key),'') is null then
    raise exception 'request_has_no_quote' using errcode='CR409';
  end if;

  select * into v_ob from public.couranr_payment_obligations
   where request_id=p_request.id and payment_state<>'cancelled' limit 1;
  if found then
    if v_ob.quote_version_id is not distinct from p_quote.id then
      return v_ob;
    end if;
    if v_ob.payment_state in ('authorized','capture_pending','captured') then
      raise exception 'payment_quote_superseded_requires_resolution' using errcode='CR409';
    end if;
    update public.couranr_payment_obligations set
      payment_state='cancelled',cancelled_at=now(),version=version+1,updated_at=now()
    where id=v_ob.id;
    update public.couranr_payment_access_tokens set
      revoked_at=now(),revoked_reason='quote_superseded'
    where request_id=p_request.id and revoked_at is null;
  end if;

  -- An accepted Route is one of the existing payer-approval proofs checked by
  -- this helper. Passage of time alone cannot unapprove its exact child quote.
  if private.couranr_quote_version_is_expired(p_quote) then
    raise exception 'quote_expired' using errcode='CR410';
  end if;
  select count(*)+1 into v_gen from public.couranr_payment_obligations
   where request_id=p_request.id;
  insert into public.couranr_payment_obligations(
    request_id,business_account_id,payer_type,request_version,quote_version_id,
    pricing_policy_version,amount_cents,currency,payment_state,provider,idempotency_key
  ) values (
    p_request.id,p_request.business_account_id,p_quote.payer_type,p_request.version,p_quote.id,
    p_quote.pricing_policy_version,p_quote.subtotal_cents,p_quote.currency,
    'not_started','stripe',p_idempotency_key||':g'||v_gen::text
  ) returning * into v_ob;
  return v_ob;
end
$fn$;
revoke all on function private.couranr_create_obligation_for_quote(
  public.couranr_delivery_requests,public.couranr_quote_versions,text
) from public,anon,authenticated,service_role;
grant execute on function private.couranr_create_obligation_for_quote(
  public.couranr_delivery_requests,public.couranr_quote_versions,text
) to service_role;

-- An accepted child is frozen against standalone mutation. The one checkout
-- transition below is deliberately narrow and requires its settlement item to
-- exist in the same transaction; later Route execution needs its own command.
create or replace function private.couranr_guard_accepted_route_child()
returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
  if exists (
    select 1 from public.couranr_route_run_claims c
    join public.couranr_route_runs r on r.id=c.route_run_id
    where c.request_id=old.id and r.route_state='accepted'
  ) then
    if tg_op='UPDATE'
       and current_setting('couranr.route_checkout_request_id',true)=old.id::text
       and old.request_state='draft' and new.request_state='confirmed'
       and old.submitted_at is null and new.submitted_at is not null
       and new.version=old.version+1
       and (to_jsonb(new)-array['request_state','version','submitted_at','updated_at'])
           =(to_jsonb(old)-array['request_state','version','submitted_at','updated_at'])
       and exists(
         select 1 from public.couranr_route_run_claims c
         join public.couranr_route_run_settlements s
           on s.route_run_id=c.route_run_id and s.route_version_id=c.route_version_id
         join public.couranr_route_run_settlement_items i
           on i.settlement_id=s.id and i.request_id=old.id
         where c.request_id=old.id and s.settlement_state='pending_authorization'
           and i.quote_version_id=old.current_quote_version_id
       ) then
      return new;
    end if;
    raise exception 'route_child_claimed' using errcode='CR409';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$fn$;

alter table public.couranr_delivery_request_events
  drop constraint couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check(command in (
    'create_delivery_request_draft','create_hosted_delivery_request',
    'calculate_delivery_request_estimate','create_quote_version',
    'submit_delivery_request','validate_hosted_delivery_request',
    'begin_delivery_request_review','accept_delivery_request_as_quoted',
    'auto_accept_delivery_request','auto_plan_delivery_request',
    'requote_delivery_request','decline_delivery_request',
    'record_payer_quote_approval','begin_delivery_preparation',
    'mark_delivery_ready','mark_delivery_not_ready','mark_delivery_unavailable',
    'cancel_delivery_request','apply_promotional_credit','record_consumer_trust',
    'record_recipient_adult_attestation','issue_recipient_dropoff_code',
    'sender_cancellation_review_requested','record_business_declared_value',
    'route_checkout_confirmed'
  ));

-- The accepted snapshot's request CAS generation is historical evidence.
-- Checkout legitimately advances mutable child requests without changing
-- their accepted quote/manifest identity; the detail must not call that stale.
create or replace function private.couranr_route_run_draft_view(p_route uuid,p_version integer)
returns jsonb language sql stable set search_path='' as $fn$
  select jsonb_build_object(
    'routeRunId',r.id,'businessAccountId',r.business_account_id,'state',r.route_state,
    'version',v.version,'currentVersion',r.current_version,'title',v.title,
    'draftOnly',(r.route_state='draft'),'bookingAvailable',false,
    'executionAvailable',false,'stopCount',v.stop_count,
    'referenceQuoteTotalCents',v.reference_quote_total_cents,
    'quoteBasis','independent_delivery_quotes_not_a_route_offer',
    'acceptedVersion',r.accepted_version,'acceptedAt',r.accepted_at,
    'abandonedAt',r.abandoned_at,'cancelledAt',r.cancelled_at,
    'stops',coalesce((select jsonb_agg(jsonb_build_object(
      'sequence',s.sequence,'requestId',s.request_id,'quoteVersionId',s.quote_version_id,
      'requestVersion',s.request_version,'pickupManifestVersion',s.pickup_manifest_version,
      'claimed',c.request_id is not null,
      'stale',q.id is null or
        (r.route_state='draft' and (q.request_state<>'draft' or q.version<>s.request_version)) or
        q.current_quote_version_id is distinct from s.quote_version_id or
        q.pickup_manifest_version<>s.pickup_manifest_version
    ) order by s.sequence) from public.couranr_route_run_stops s
      left join public.couranr_delivery_requests q on q.id=s.request_id
      left join public.couranr_route_run_claims c on c.request_id=s.request_id and c.route_run_id=r.id
      where s.route_version_id=v.id),'[]'::jsonb))
  from public.couranr_route_runs r join public.couranr_route_run_versions v
    on v.route_run_id=r.id and v.version=p_version where r.id=p_route
$fn$;

create or replace function public.couranr_create_payment_obligation(
  p_request_id uuid,p_business_account_id uuid,p_idempotency_key text
) returns public.couranr_payment_obligations
language plpgsql security invoker set search_path='' as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
begin
  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id and business_account_id is not distinct from p_business_account_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state not in
     ('confirmed','awaiting_quote_acceptance','quote_revision_required') then
    raise exception 'request_not_payable' using errcode='CR409';
  end if;
  -- Checkout creates Route child obligations through the shared private
  -- helper. The ordinary payment entry point must not hand its caller that
  -- same obligation and start an unrelated PaymentIntent for a frozen child.
  if exists(
    select 1 from public.couranr_route_run_claims c
    join public.couranr_route_runs r on r.id=c.route_run_id
    where c.request_id=v_req.id and r.route_state='accepted'
  ) then
    raise exception 'route_child_payment_owned_by_settlement' using errcode='CR409';
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  return private.couranr_create_obligation_for_quote(v_req,v_quote,p_idempotency_key);
end
$fn$;

-- The merchant/customer payment-link flow can fetch an existing obligation
-- without calling create_payment_obligation. Fence that sibling entry point
-- at its token INSERT boundary, so a claimed child never acquires a separate
-- standalone payer capability after Route checkout.
create function private.couranr_guard_route_child_payment_token()
returns trigger language plpgsql security definer set search_path='' as $fn$
begin
  if exists(
    select 1 from public.couranr_route_run_claims c
    join public.couranr_route_runs r on r.id=c.route_run_id
    where c.request_id=new.request_id and r.route_state='accepted'
  ) then
    raise exception 'route_child_payment_owned_by_settlement' using errcode='CR409';
  end if;
  return new;
end
$fn$;
revoke all on function private.couranr_guard_route_child_payment_token()
  from public,anon,authenticated,service_role;
create trigger couranr_route_child_payment_token_guard
before insert on public.couranr_payment_access_tokens
for each row execute function private.couranr_guard_route_child_payment_token();

create or replace function public.couranr_begin_route_run_checkout(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_expected_version integer,p_idempotency_key uuid
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_version public.couranr_route_run_versions;
  v_profile public.couranr_business_payment_profiles;
  v_existing public.couranr_route_run_settlements;
  v_settlement public.couranr_route_run_settlements;
  v_stop public.couranr_route_run_stops;
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_ob public.couranr_payment_obligations;
  v_total bigint:=0;
  v_currency text:=null;
  v_count integer:=0;
begin
  perform private.couranr_require_route_checkout_member(p_business_account_id,p_actor_user_id);
  if p_expected_version is null or p_expected_version<1 or p_idempotency_key is null then
    raise exception 'route_checkout_input_invalid' using errcode='CR422';
  end if;

  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id and business_account_id=p_business_account_id
   for update;
  if not found then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
  if v_route.route_state<>'accepted' then
    raise exception 'route_checkout_requires_accepted' using errcode='CR409';
  end if;
  if v_route.accepted_version<>p_expected_version or v_route.current_version<>p_expected_version then
    raise exception 'route_version_conflict' using errcode='CR409';
  end if;
  select * into strict v_version from public.couranr_route_run_versions
   where route_run_id=v_route.id and version=v_route.accepted_version;

  select * into v_existing from public.couranr_route_run_settlements
   where route_run_id=v_route.id for update;
  if found then
    if v_existing.checkout_idempotency_key=p_idempotency_key then
      return private.couranr_route_settlement_view(v_existing.id);
    end if;
    raise exception 'route_checkout_already_started' using errcode='CR409';
  end if;

  select * into v_profile from public.couranr_business_payment_profiles
   where business_account_id=p_business_account_id for update;
  if not found or v_profile.stripe_customer_id is null
     or v_profile.default_payment_method_id is null
     or v_profile.stripe_customer_livemode is null
     or nullif(btrim(v_profile.card_brand),'') is null
     or v_profile.card_last4 !~ '^[0-9]{4}$' then
    raise exception 'route_checkout_saved_card_required' using errcode='CR409';
  end if;

  perform q.id
    from public.couranr_route_run_stops rs
    join public.couranr_delivery_requests q on q.id=rs.request_id
   where rs.route_version_id=v_version.id
   order by q.id for update of q;

  for v_stop in
    select * from public.couranr_route_run_stops
     where route_version_id=v_version.id order by sequence
  loop
    v_count:=v_count+1;
    select * into v_req from public.couranr_delivery_requests where id=v_stop.request_id;
    if not found or v_req.business_account_id is distinct from p_business_account_id
       or v_req.request_state<>'draft'
       or v_req.current_quote_version_id is distinct from v_stop.quote_version_id
       or v_req.version<>v_stop.request_version
       or v_req.pickup_manifest_version<>v_stop.pickup_manifest_version
       or v_req.payer_type<>'merchant'
       or not exists(
         select 1 from public.couranr_route_run_claims c
          where c.route_run_id=v_route.id
            and c.route_version_id=v_version.id
            and c.request_id=v_req.id
       ) then
      raise exception 'route_checkout_child_stale' using errcode='CR409';
    end if;
    if exists(select 1 from public.couranr_payment_obligations o where o.request_id=v_req.id) then
      raise exception 'route_checkout_child_payment_exists' using errcode='CR409';
    end if;

    select * into v_quote from public.couranr_quote_versions
     where id=v_stop.quote_version_id and request_id=v_req.id
       and quote_status='estimated' and subtotal_cents is not null and subtotal_cents>0;
    if not found or not private.couranr_quote_payer_approved(v_quote) then
      raise exception 'route_checkout_quote_not_approved' using errcode='CR409';
    end if;
    if v_currency is null then v_currency:=v_quote.currency;
    elsif v_currency is distinct from v_quote.currency then
      raise exception 'route_checkout_currency_mismatch' using errcode='CR409';
    end if;
    v_total:=v_total+v_quote.subtotal_cents;
  end loop;

  if v_count<>v_version.stop_count or v_count not between 2 and 5
     or v_total<>v_version.reference_quote_total_cents or v_total>2147483647
     or lower(coalesce(v_currency,''))<>'usd' then
    raise exception 'route_checkout_total_mismatch' using errcode='CR409';
  end if;

  insert into public.couranr_route_run_settlements(
    route_run_id,route_version_id,business_account_id,checkout_idempotency_key,
    confirmed_by,payment_profile_generation,stripe_customer_id,
    stripe_payment_method_id,stripe_livemode,card_brand,card_last4,
    reference_total_cents,currency
  ) values (
    v_route.id,v_version.id,p_business_account_id,p_idempotency_key,
    p_actor_user_id,v_profile.current_generation,v_profile.stripe_customer_id,
    v_profile.default_payment_method_id,v_profile.stripe_customer_livemode,
    v_profile.card_brand,v_profile.card_last4,v_total,'usd'
  ) returning * into v_settlement;

  for v_stop in
    select * from public.couranr_route_run_stops
     where route_version_id=v_version.id order by sequence
  loop
    select * into strict v_req from public.couranr_delivery_requests where id=v_stop.request_id;
    select * into strict v_quote from public.couranr_quote_versions where id=v_stop.quote_version_id;
    v_ob:=private.couranr_create_obligation_for_quote(
      v_req,v_quote,'route:'||v_settlement.id::text||':stop:'||v_stop.sequence::text
    );

    insert into public.couranr_route_run_settlement_items(
      settlement_id,sequence,request_id,quote_version_id,obligation_id,amount_cents,currency
    ) values (
      v_settlement.id,v_stop.sequence,v_req.id,v_quote.id,v_ob.id,
      v_quote.subtotal_cents,v_quote.currency
    );
    perform set_config('couranr.route_checkout_request_id',v_req.id::text,true);
    update public.couranr_delivery_requests
       set request_state='confirmed',submitted_at=now(),version=version+1,updated_at=now()
     where id=v_req.id and version=v_stop.request_version and request_state='draft';
    if not found then
      raise exception 'route_checkout_child_stale' using errcode='CR409';
    end if;
    perform set_config('couranr.route_checkout_request_id','',true);
    insert into public.couranr_delivery_request_events(
      request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
    ) values (
      v_req.id,p_actor_user_id,'merchant','route_checkout_confirmed','draft','confirmed',
      jsonb_build_object('routeRunId',v_route.id,'routeVersionId',v_version.id,
        'quoteVersionId',v_quote.id,'paymentObligationId',v_ob.id,
        'acceptedRouteVersion',v_route.accepted_version)
    );
  end loop;

  insert into public.couranr_route_run_settlement_events(
    settlement_id,actor_user_id,event_type,detail
  ) values (
    v_settlement.id,p_actor_user_id,'checkout_confirmed',
    jsonb_build_object(
      'routeRunId',v_route.id,'acceptedVersion',v_route.accepted_version,
      'stopCount',v_count,'referenceTotalCents',v_total,
      'paymentProfileGeneration',v_profile.current_generation
    )
  );
  return private.couranr_route_settlement_view(v_settlement.id);
exception when unique_violation then
  select * into v_existing from public.couranr_route_run_settlements
   where route_run_id=p_route_run_id;
  if found and v_existing.checkout_idempotency_key=p_idempotency_key then
    return private.couranr_route_settlement_view(v_existing.id);
  end if;
  raise;
end
$fn$;

create or replace function public.couranr_read_route_run_settlement(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare v_settlement public.couranr_route_run_settlements;
begin
  perform private.couranr_assert_route_run_member(p_business_account_id,p_actor_user_id,false);
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=p_route_run_id and business_account_id=p_business_account_id;
  if not found then return null; end if;
  return private.couranr_route_settlement_view(v_settlement.id);
end
$fn$;

-- Durable provider attempt identity is committed BEFORE the server calls
-- Stripe. A lost response retries the same key only inside the conservative
-- idempotency horizon; beyond it the Route is held for provider reconciliation.
create or replace function public.couranr_begin_route_child_authorization(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_obligation_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_settlement public.couranr_route_run_settlements;
  v_item public.couranr_route_run_settlement_items;
  v_ob public.couranr_payment_obligations;
begin
  perform private.couranr_require_route_checkout_member(p_business_account_id,p_actor_user_id);
  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id and business_account_id=p_business_account_id for update;
  if not found then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=v_route.id and business_account_id=p_business_account_id for update;
  if not found then raise exception 'route_settlement_not_found' using errcode='CR404'; end if;
  if v_route.route_state<>'accepted'
     or v_route.accepted_version is distinct from v_route.current_version
     or v_settlement.route_version_id is distinct from (
       select id from public.couranr_route_run_versions
        where route_run_id=v_route.id and version=v_route.accepted_version)
     or v_settlement.settlement_state not in
       ('pending_authorization','authorization_required','authorization_unknown')
     or (v_settlement.settlement_state='authorization_unknown'
         and v_settlement.provider_uncertain_obligation_id is distinct from p_obligation_id) then
    raise exception 'route_authorization_state_conflict' using errcode='CR409';
  end if;
  select * into v_item from public.couranr_route_run_settlement_items
   where settlement_id=v_settlement.id and obligation_id=p_obligation_id for update;
  if not found then raise exception 'route_authorization_item_not_found' using errcode='CR404'; end if;
  if exists(
    select 1 from public.couranr_route_run_settlement_items prev
    join public.couranr_payment_obligations po on po.id=prev.obligation_id
    where prev.settlement_id=v_settlement.id and prev.sequence<v_item.sequence
      and po.payment_state<>'authorized'
  ) then
    raise exception 'route_authorization_order_conflict' using errcode='CR409';
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where id=v_item.obligation_id for update;
  if v_ob.payment_state not in ('not_started','requires_action')
     or (v_ob.payment_state='requires_action' and v_ob.provider_payment_intent_id is null) then
    raise exception 'route_authorization_item_state_conflict' using errcode='CR409';
  end if;
  if v_settlement.settlement_state='authorization_required'
     and v_ob.payment_state<>'requires_action' then
    raise exception 'route_authorization_state_conflict' using errcode='CR409';
  end if;
  if v_item.authorization_attempted_at is not null
     and v_item.authorization_attempted_at<=now()-interval '23 hours'
     and v_ob.provider_payment_intent_id is null then
    if v_settlement.settlement_state='authorization_unknown' then
      return jsonb_build_object('outcome','manual_reconciliation_required');
    end if;
    update public.couranr_route_run_settlements
       set settlement_state='authorization_unknown',
           provider_uncertainty_at=now(),
           provider_uncertainty_reason='provider_attempt_window_elapsed',
           provider_uncertain_obligation_id=v_ob.id,
           version=version+1,updated_at=now()
     where id=v_settlement.id;
    insert into public.couranr_route_run_settlement_events(
      settlement_id,actor_user_id,event_type,detail
    ) values(v_settlement.id,p_actor_user_id,'provider_uncertain',
      jsonb_build_object('obligationId',v_ob.id,'reason','provider_attempt_window_elapsed'));
    return jsonb_build_object('outcome','manual_reconciliation_required');
  end if;
  if v_item.authorization_key is null then
    update public.couranr_route_run_settlement_items
       set authorization_key='couranr:route:'||v_settlement.id::text||
         ':obligation:'||v_ob.id::text||':g1',
           authorization_attempted_at=now()
     where settlement_id=v_settlement.id and sequence=v_item.sequence
     returning * into v_item;
    insert into public.couranr_route_run_settlement_events(
      settlement_id,actor_user_id,event_type,detail
    ) values(v_settlement.id,p_actor_user_id,'authorization_attempt_started',
      jsonb_build_object('sequence',v_item.sequence,'obligationId',v_ob.id,
        'attemptGeneration',1));
  end if;
  return jsonb_build_object(
    'outcome','attempt_ready',
    'reconcilingUnknown',(v_settlement.settlement_state='authorization_unknown'),
    'settlementId',v_settlement.id,
    'obligationId',v_ob.id,'requestId',v_ob.request_id,
    'quoteVersionId',v_ob.quote_version_id,'sequence',v_item.sequence,
    'amountCents',v_ob.amount_cents,'currency',v_ob.currency,
    'payerType',v_ob.payer_type,'pricingPolicyVersion',v_ob.pricing_policy_version,
    'requestVersion',v_ob.request_version,'obligationVersion',v_ob.version,
    'paymentState',v_ob.payment_state,'providerPaymentIntentId',v_ob.provider_payment_intent_id,
    'idempotencyKey',v_item.authorization_key,
    'stripeCustomerId',v_settlement.stripe_customer_id,
    'stripePaymentMethodId',v_settlement.stripe_payment_method_id,
    'stripeLivemode',v_settlement.stripe_livemode
  );
end
$fn$;

create or replace function public.couranr_mark_route_settlement_provider_unknown(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_obligation_id uuid,p_reason text
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare v_settlement public.couranr_route_run_settlements;
begin
  perform private.couranr_require_route_checkout_member(p_business_account_id,p_actor_user_id);
  if nullif(btrim(p_reason),'') is null then
    raise exception 'route_settlement_unknown_reason_required' using errcode='CR422';
  end if;
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=p_route_run_id and business_account_id=p_business_account_id
   for update;
  if not found then raise exception 'route_settlement_not_found' using errcode='CR404'; end if;
  if v_settlement.settlement_state not in
     ('pending_authorization','authorization_required','authorization_unknown') then
    raise exception 'route_settlement_unknown_state_invalid' using errcode='CR409';
  end if;
  if not exists(select 1 from public.couranr_route_run_settlement_items
                where settlement_id=v_settlement.id and obligation_id=p_obligation_id
                  and authorization_key is not null)
     or (v_settlement.settlement_state='authorization_unknown'
         and v_settlement.provider_uncertain_obligation_id is distinct from p_obligation_id) then
    raise exception 'route_settlement_unknown_item_invalid' using errcode='CR409';
  end if;
  update public.couranr_route_run_settlements
     set settlement_state='authorization_unknown',
         provider_uncertainty_at=coalesce(provider_uncertainty_at,now()),
         provider_uncertainty_reason=left(btrim(p_reason),120),
         provider_uncertain_obligation_id=p_obligation_id,
         version=version+1,updated_at=now()
   where id=v_settlement.id
   returning * into v_settlement;
  insert into public.couranr_route_run_settlement_events(
    settlement_id,actor_user_id,event_type,detail
  ) values(v_settlement.id,p_actor_user_id,'provider_uncertain',
    jsonb_build_object('reason',v_settlement.provider_uncertainty_reason));
  return private.couranr_route_settlement_view(v_settlement.id);
end
$fn$;

create or replace function public.couranr_sync_route_run_settlement(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_provider_reconciled boolean default false
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  v_settlement public.couranr_route_run_settlements;
  v_before text;
  v_target text;
  v_total integer;
  v_authorized integer;
  v_captured integer;
  v_failed integer;
  v_action integer;
  v_pending integer;
  v_released integer;
begin
  perform private.couranr_require_route_checkout_member(p_business_account_id,p_actor_user_id);
  select * into v_settlement from public.couranr_route_run_settlements
   where route_run_id=p_route_run_id and business_account_id=p_business_account_id
   for update;
  if not found then raise exception 'route_settlement_not_found' using errcode='CR404'; end if;
  if p_provider_reconciled and v_settlement.settlement_state<>'authorization_unknown' then
    raise exception 'route_settlement_no_unknown_to_reconcile' using errcode='CR409';
  end if;

  select count(*),
    count(*) filter(where o.payment_state='authorized'),
    count(*) filter(where o.payment_state='captured'),
    count(*) filter(where o.payment_state='failed'),
    count(*) filter(where o.payment_state='requires_action'),
    count(*) filter(where o.payment_state='capture_pending'),
    count(*) filter(where o.payment_state='cancelled')
  into v_total,v_authorized,v_captured,v_failed,v_action,v_pending,v_released
  from public.couranr_route_run_settlement_items i
  join public.couranr_payment_obligations o on o.id=i.obligation_id
  where i.settlement_id=v_settlement.id;

  if v_settlement.settlement_state='authorization_unknown' and not p_provider_reconciled then
    return private.couranr_route_settlement_view(v_settlement.id);
  end if;
  if v_settlement.settlement_state='authorization_unknown'
     and not exists(
       select 1 from public.couranr_payment_events pe
       where pe.obligation_id=v_settlement.provider_uncertain_obligation_id
         and pe.created_at>v_settlement.provider_uncertainty_at
         and pe.event_type in (
           'payment_intent.amount_capturable_updated','payment_intent.requires_action',
           'payment_intent.payment_failed','payment_intent.canceled'
         )
         and pe.outcome in ('applied','ignored')
     ) then
    raise exception 'route_settlement_provider_reconciliation_evidence_required'
      using errcode='CR409';
  end if;

  v_before:=v_settlement.settlement_state;
  v_target:=case
    -- A Route in recovery must never be silently re-armed by a status read.
    -- After every outstanding hold is released it can settle as failed; any
    -- remaining authorized/captured child still requires explicit recovery.
    when v_before='recovery_required' and (v_authorized>0 or v_captured>0)
      then 'recovery_required'
    when v_captured=v_total and v_total>0 then 'captured'
    when v_captured>0 and v_captured<v_total then 'recovery_required'
    when v_pending>0 then 'capture_pending'
    when v_authorized=v_total and v_total>0 then
      case when v_before in ('resource_reserved','capture_pending') then v_before else 'authorized' end
    when v_failed>0 and v_authorized>0 then 'recovery_required'
    when v_failed>0 then 'authorization_failed'
    when v_released>0 and v_authorized=0 and v_captured=0
      then 'authorization_failed'
    when v_action>0 then 'authorization_required'
    else 'pending_authorization'
  end;

  update public.couranr_route_run_settlements
     set settlement_state=v_target,
         provider_uncertainty_at=case when p_provider_reconciled then null else provider_uncertainty_at end,
         provider_uncertainty_reason=case when p_provider_reconciled then null else provider_uncertainty_reason end,
         provider_uncertain_obligation_id=case when p_provider_reconciled then null else provider_uncertain_obligation_id end,
         version=case when v_target is distinct from v_before or p_provider_reconciled then version+1 else version end,
         updated_at=case when v_target is distinct from v_before or p_provider_reconciled then now() else updated_at end
   where id=v_settlement.id returning * into v_settlement;

  if v_target is distinct from v_before or p_provider_reconciled then
    insert into public.couranr_route_run_settlement_events(
      settlement_id,actor_user_id,event_type,detail
    ) values (
      v_settlement.id,p_actor_user_id,
      case when p_provider_reconciled then 'provider_reconciled' else 'authorization_state_changed' end,
      jsonb_build_object('from',v_before,'to',v_target,
        'authorized',v_authorized,'captured',v_captured,'failed',v_failed,'actionRequired',v_action)
    );
  end if;
  return private.couranr_route_settlement_view(v_settlement.id);
end
$fn$;

-- Extend the existing canonical hold-release admission only for an exact
-- failed, pre-capture Route settlement. All ordinary Operations behavior and
-- canonical release/cancel event/version semantics remain unchanged.
create or replace function public.couranr_begin_payment_release(
  p_obligation_id    uuid,
  p_actor_user_id    uuid,
  p_expected_version integer,
  p_reason           text
)
returns public.couranr_payment_apply_result
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_role text;
  v_ob   public.couranr_payment_obligations;
  v_route_id uuid;
  v_route public.couranr_route_runs;
  v_settlement public.couranr_route_run_settlements;
begin
  -- OPS-010 is an Operations screen. Same predicate couranr_decide_activation
  -- uses, so there is one definition of "Operations" in SQL rather than two.
  select role into v_role from public.profiles where id = p_actor_user_id;
  -- Even Operations cannot release a healthy Route child out from under its
  -- settlement. A failed Route can release an uncaptured sibling hold even if
  -- another child was already captured and requires separate refund recovery.
  select s.route_run_id into v_route_id
    from public.couranr_route_run_settlement_items i
    join public.couranr_route_run_settlements s on s.id=i.settlement_id
   where i.obligation_id=p_obligation_id;
  if v_route_id is not null then
    select * into v_route from public.couranr_route_runs
     where id=v_route_id for update;
    select * into v_settlement from public.couranr_route_run_settlements
     where route_run_id=v_route_id for update;
    if v_role is distinct from 'admin' then
      perform private.couranr_require_route_checkout_member(
        v_settlement.business_account_id,p_actor_user_id);
    end if;
    if v_route.route_state<>'accepted'
       or v_settlement.settlement_state not in
         ('authorization_failed','recovery_required')
       or exists(
         select 1 from public.couranr_route_run_settlement_items i
         where i.settlement_id=v_settlement.id and i.obligation_id=p_obligation_id
           and (exists(select 1 from public.couranr_service_plans p
                        where p.request_id=i.request_id)
             or exists(select 1 from public.couranr_deliveries d
                        where d.request_id=i.request_id))
       ) then
      raise exception 'route_release_requires_failed_settlement'
        using errcode='CR409';
    end if;
  elsif v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'release_requires_a_reason' using errcode = 'CR400';
  end if;

  select * into v_ob
    from public.couranr_payment_obligations
   where id = p_obligation_id
     for update;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  -- Idempotent replay: an operator who retries after a timeout must be told
  -- what already happened, not handed a conflict. CAP-001's capture branch
  -- makes the same promise for the same reason.
  if v_ob.payment_state = 'cancelled' then
    return row('ignored', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
               'already_released')::public.couranr_payment_apply_result;
  end if;

  /* Batch 3 §B: THE STALE-QUOTE HOLD. Stripe can place a real authorization
     hold while Couranr's commercial authorization is refused (quote_expired
     and the metadata rejections in couranr_apply_payment_intent_state) — the
     obligation then sits in 'not_started' or 'requires_action' with a LIVE
     provider hold and, before this change, no command could release it
     ('only_an_authorized_hold_may_be_released'). Those two states join
     'authorized' as releasable; everything at or past capture stays refused —
     captured money is a REFUND, never a release. */
  if v_ob.payment_state not in ('authorized','not_started','requires_action') then
    raise exception 'only_an_authorized_hold_may_be_released' using errcode = 'CR409';
  end if;
  -- UNREACHABLE, and kept deliberately. couranr_po_authorized_needs_intent_chk
  -- is `payment_state <> 'authorized' OR provider_payment_intent_id IS NOT NULL`,
  -- so the database already forbids the row this branch describes - proven by
  -- R19 in e2e/disposable/releaseAuthorization.mjs, which gets 23514 trying to
  -- insert one. Defence in depth against that CHECK being relaxed later, not a
  -- live path, and no test claims to cover it.
  if v_ob.provider_payment_intent_id is null then
    -- Reachable since §B for the stale states: a not_started obligation with
    -- no intent attached has no provider hold, so there is nothing to release.
    raise exception 'obligation_has_no_payment_intent' using errcode = 'CR422';
  end if;
  if p_expected_version is null or p_expected_version <> v_ob.version then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  /*
   * BUMP THE VERSION FIRST, so this ATTEMPT has an identity.
   *
   * This is not bookkeeping - it is what makes a retry possible, and getting it
   * wrong made the first version of this command worse than not having it.
   *
   * The event id below is version-scoped, copying the captureEventId convention
   * in lib/couranr/payments/states.ts. That convention works for capture ONLY
   * because couranr_begin_payment_capture bumps the version on every cycle.
   * This command originally did not, on the reasoning that a release should not
   * move the row - so a second attempt rebuilt the SAME id and died on
   * couranr_pe_provider_event_uniq with 23505. Measured, not theorised: attempt
   * one returned `applied` with version still 1, attempt two returned
   * `23505 duplicate key value violates unique constraint`.
   *
   * The consequence was that ONE failed Stripe call made a hold permanently
   * un-releasable - strictly worse than shipping nothing, because the operator
   * has a button that can never work again.
   *
   * payment_state is still NOT changed here; that part of the design stands.
   * Only `version` moves, which is exactly what "a distinct attempt" means.
   */
  update public.couranr_payment_obligations
     set version    = version + 1,
         updated_at = now()
   where id = p_obligation_id
     and version = p_expected_version
     and payment_state in ('authorized','not_started','requires_action')
  returning * into v_ob;
  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_payment_events (
    obligation_id, request_id, provider, provider_event_id, event_type,
    payment_state_before, payment_state_after, outcome, detail
  ) values (
    v_ob.id, v_ob.request_id, 'stripe',
    'couranr:release_begun:' || v_ob.id::text || ':v' || v_ob.version::text,
    'couranr.release.begun',
    v_ob.payment_state, v_ob.payment_state, 'applied',
    jsonb_build_object('reason', btrim(p_reason), 'actorUserId', p_actor_user_id)
  );

  return row('applied', v_ob.id, v_ob.request_id, v_ob.payment_state, null,
             null)::public.couranr_payment_apply_result;
end
$fn$;

revoke all on function public.couranr_begin_route_run_checkout(uuid,uuid,uuid,integer,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_read_route_run_settlement(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_begin_route_child_authorization(uuid,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_mark_route_settlement_provider_unknown(uuid,uuid,uuid,uuid,text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_sync_route_run_settlement(uuid,uuid,uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_begin_route_run_checkout(uuid,uuid,uuid,integer,uuid) to service_role;
grant execute on function public.couranr_read_route_run_settlement(uuid,uuid,uuid) to service_role;
grant execute on function public.couranr_begin_route_child_authorization(uuid,uuid,uuid,uuid) to service_role;
grant execute on function public.couranr_mark_route_settlement_provider_unknown(uuid,uuid,uuid,uuid,text) to service_role;
grant execute on function public.couranr_sync_route_run_settlement(uuid,uuid,uuid,boolean) to service_role;

comment on table public.couranr_route_run_settlements is
  'RR-003 checkout saga over separate canonical child obligations. This table is not an aggregate charge and creates no capture/dispatch/custody authority.';

commit;
