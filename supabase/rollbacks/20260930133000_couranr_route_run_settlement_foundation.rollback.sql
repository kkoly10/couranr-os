-- RR-003b rollback: safe only before any Route checkout history exists.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

-- Lock before inspecting history: a concurrent checkout must not commit
-- between the empty-history guard and the destructive DROP below.
lock table public.couranr_route_run_settlements,
  public.couranr_route_run_settlement_items,
  public.couranr_route_run_settlement_events in access exclusive mode;

do $$ begin
  if exists(select 1 from public.couranr_route_run_settlements)
     or exists(select 1 from public.couranr_route_run_settlement_events) then
    raise exception 'route_settlement_rollback_refuses_semantic_use';
  end if;
end $$;

drop function public.couranr_claim_route_checkout_maintenance(integer);

-- Restore the pre-RR-003b Operations-only hold-release admission before
-- dropping the Route settlement relations referenced by the forward function.
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
begin
  -- OPS-010 is an Operations screen. Same predicate couranr_decide_activation
  -- uses, so there is one definition of "Operations" in SQL rather than two.
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
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

-- Restore the pre-RR-003b standalone obligation writer before removing the
-- shared helper. This branch is reachable only while no Route checkout exists.
create or replace function public.couranr_create_payment_obligation(
  p_request_id uuid,p_business_account_id uuid,p_idempotency_key text
)
returns public.couranr_payment_obligations
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_ob public.couranr_payment_obligations;
  v_gen integer;
begin
  select * into v_req from public.couranr_delivery_requests
   where id=p_request_id and business_account_id is not distinct from p_business_account_id
   for update;
  if not found then raise exception 'request_not_found' using errcode='CR404'; end if;
  if v_req.request_state not in
     ('confirmed','awaiting_quote_acceptance','quote_revision_required') then
    raise exception 'request_not_payable' using errcode='CR409';
  end if;
  select * into v_quote from public.couranr_quote_versions
   where id=v_req.current_quote_version_id and request_id=v_req.id;
  if not found or v_quote.quote_status<>'estimated'
     or v_quote.subtotal_cents is null or v_quote.subtotal_cents<=0 then
    raise exception 'request_has_no_quote' using errcode='CR409';
  end if;
  select * into v_ob from public.couranr_payment_obligations
   where request_id=v_req.id and payment_state<>'cancelled' limit 1;
  if found then
    if v_ob.quote_version_id is not distinct from v_quote.id then return v_ob; end if;
    if v_ob.payment_state in ('authorized','capture_pending','captured') then
      raise exception 'payment_quote_superseded_requires_resolution' using errcode='CR409';
    end if;
    update public.couranr_payment_obligations set
      payment_state='cancelled',cancelled_at=now(),version=version+1,updated_at=now()
    where id=v_ob.id;
    update public.couranr_payment_access_tokens set
      revoked_at=now(),revoked_reason='quote_superseded'
    where request_id=v_req.id and revoked_at is null;
  end if;
  if private.couranr_quote_version_is_expired(v_quote) then
    raise exception 'quote_expired' using errcode='CR410';
  end if;
  select count(*)+1 into v_gen from public.couranr_payment_obligations where request_id=v_req.id;
  insert into public.couranr_payment_obligations(
    request_id,business_account_id,payer_type,request_version,quote_version_id,
    pricing_policy_version,amount_cents,currency,payment_state,provider,idempotency_key
  ) values (
    v_req.id,v_req.business_account_id,v_quote.payer_type,v_req.version,v_quote.id,
    v_quote.pricing_policy_version,v_quote.subtotal_cents,v_quote.currency,
    'not_started','stripe',p_idempotency_key||':g'||v_gen::text
  ) returning * into v_ob;
  return v_ob;
end
$fn$;

create or replace function private.couranr_guard_accepted_route_child()
returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
  if exists (
    select 1 from public.couranr_route_run_claims c
    join public.couranr_route_runs r on r.id=c.route_run_id
    where c.request_id=old.id and r.route_state='accepted'
  ) then
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
    'sender_cancellation_review_requested','record_business_declared_value'
  ));

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
      'stale',q.id is null or q.request_state<>'draft' or q.version<>s.request_version or
        q.current_quote_version_id is distinct from s.quote_version_id or
        q.pickup_manifest_version<>s.pickup_manifest_version
    ) order by s.sequence) from public.couranr_route_run_stops s
      left join public.couranr_delivery_requests q on q.id=s.request_id
      left join public.couranr_route_run_claims c on c.request_id=s.request_id and c.route_run_id=r.id
      where s.route_version_id=v.id),'[]'::jsonb))
  from public.couranr_route_runs r join public.couranr_route_run_versions v
    on v.route_run_id=r.id and v.version=p_version where r.id=p_route
$fn$;

drop trigger couranr_route_child_payment_token_guard
  on public.couranr_payment_access_tokens;
drop function private.couranr_guard_route_child_payment_token();
drop function public.couranr_sync_route_run_settlement(uuid,uuid,uuid,boolean);
drop function public.couranr_mark_route_settlement_provider_unknown(uuid,uuid,uuid,uuid,text);
drop function public.couranr_begin_route_child_authorization(uuid,uuid,uuid,uuid);
drop function public.couranr_read_route_run_settlement(uuid,uuid,uuid);
drop function public.couranr_begin_route_run_checkout(uuid,uuid,uuid,integer,uuid);
drop function private.couranr_route_settlement_view(uuid);
drop function private.couranr_require_route_checkout_member(uuid,uuid);
drop function private.couranr_create_obligation_for_quote(
  public.couranr_delivery_requests,public.couranr_quote_versions,text
);

drop table public.couranr_route_run_settlement_events restrict;
drop table public.couranr_route_run_settlement_items restrict;
drop table public.couranr_route_run_settlements restrict;

commit;
