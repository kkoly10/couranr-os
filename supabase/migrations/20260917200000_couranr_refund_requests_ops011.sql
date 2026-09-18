-- Couranr OPS-011 — Refund management (delivery-charge refund REVIEW substrate).
--
-- ADDITIVE, and deliberately a THIN LAYER on top of the refund substrate that
-- P6-004 already shipped in 20260903020000. It creates NO second refund path:
--
--   * money still moves through exactly one table, public.couranr_payment_refunds
--   * the provider is still reached through exactly one convergence path in
--     lib/couranr/fulfillment/commands.ts (convergeRefundAttemptWithProvider)
--   * the balanced ledger still posts from the SAME trigger
--     (private.couranr_ledger_post_refund on couranr_payment_refunds)
--
-- What was missing, and what this adds, is the REVIEW record the screen is
-- named for: OPS-011 "Review delivery-charge refund requests with evidence,
-- policy, Stripe, and ledger effects", states
-- "Pending; approved; processing; partially refunded; refunded; denied;
-- failed", actions "Approve full/partial; deny".
--
-- AUTHORITY
--   REF-001  delivery_refund_authority = "Couranr Operations"; acceptance
--            "No refund path exists outside Operations"; requires a structured
--            reason and evidence. Every command here gates on profiles.role =
--            'admin' and the reason vocabulary is a CHECK, not a free string.
--   REF-002  merchandise price and merchandise refunds are the MERCHANT's.
--            Couranr charges for delivery and approved operating charges only.
--            Hence: the refundable base is derived from the delivery
--            obligation's captured amount and from nothing else, and no reason
--            code in this vocabulary names merchandise.
--   REF-003  a physical return is a NEW Pricing V2 route, never a refund
--            calculation. Nothing here prices a return.
--   TRM-001  never_claim includes "on-time guarantee". No reason code in this
--            vocabulary names lateness, an ETA or a delivery window, so no
--            structured record here can institutionalise compensation for
--            being late. Operations discretion is recorded as
--            'operations_adjustment' with a written note instead.
--   CAN-001  cancellation retentions are derived from the delivery's STORED
--            lifecycle stage by the cancellation saga. This surface does NOT
--            re-derive them and does not accept a retention reason: an
--            Operations-reviewed refund is its own governed settlement.
--
-- THE MONEY RULES, each enforced HERE and not only in the application:
--   1. Amounts are integer cents and are RECOMPUTED server-side. The caller
--      supplies a requested figure; the refundable base is computed under a
--      row lock from captured_amount_cents - refunded_amount_cents.
--   2. An approval above the refundable base is REFUSED (CR422), never
--      clamped, and couranr_rr_amount_within_base_chk makes the clamped row
--      unwritable even by a future bug.
--   3. The sum of refunds against one obligation can never exceed the capture:
--      couranr_po_refund_bounds_chk (20260903020000) plus the one-live-attempt
--      unique index are untouched and still apply.
--   4. The decision is PERSISTED BEFORE any provider work begins, so 'approved'
--      is a durable resumable state and a crash cannot lose it.
--   5. Idempotent by construction: replaying an approval converges on the
--      recorded decision, and the provider idempotency key is derived from the
--      refund-request identity and version — never from the clock.
--
-- Rolling-deploy safe. Applying this migration alone moves no live row: the
-- new table starts empty and the new states are only entered by the new named
-- commands.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

/* ------------------------------------------------------------------ 1 ---
 * The governed reason vocabulary gains ONE value.
 *
 * `operations_reviewed_refund` is the settlement this surface produces. It is
 * deliberately NOT one of the CAN-001 retention reasons, which means the
 * existing couranr_begin_payment_refund CANNOT mint one: its retention CASE
 * has no branch for it and falls through to `refund_reason_invalid` (CR422).
 * So the old full-refund path and this reviewed path cannot be confused for
 * one another in either direction, and the reason-identity lock already in
 * couranr_begin_payment_refund (a standalone full_refund is refused whenever
 * ANY attempt with reason <> 'full_refund' exists) now covers this one too.
 *
 * Widening a CHECK is additive: every existing row still satisfies it.
 */
alter table public.couranr_payment_refunds
  drop constraint if exists couranr_pr_reason_chk;
alter table public.couranr_payment_refunds
  add constraint couranr_pr_reason_chk check (reason in (
    'full_refund','cancel_before_confirmation',
    'cancel_after_confirmation_before_arrival','failed_pickup_after_arrival',
    'couranr_caused_failure','operations_reviewed_refund'));

/* ------------------------------------------------------------------ 2 ---
 * The review record.
 */
create table if not exists public.couranr_refund_requests (
  id                     uuid primary key default gen_random_uuid(),

  request_id             uuid not null,
  obligation_id          uuid not null,
  -- Mirrors the obligation's nullable tenancy: NULL is a consumer request,
  -- which is how every other canonical reader scopes (SQL NULL semantics, so
  -- a business can never reach a consumer row or another tenant's).
  business_account_id    uuid,

  -- EVIDENCE (REF-001). Both optional and both merely REFERENCES: this table
  -- never copies incident detail, photo paths, addresses or message bodies.
  incident_id            uuid,
  problem_report_id      uuid,

  requested_by           text not null,
  reason_code            text not null,
  detail                 text not null default '',

  request_state          text not null default 'pending',

  -- Server-computed at decision time, under a row lock on the obligation.
  -- NEVER supplied by a caller: the caller supplies only a requested figure,
  -- which is validated against this.
  refundable_base_cents  integer,
  approved_amount_cents  integer,

  decided_by             uuid,
  decided_at             timestamptz,
  denial_reason          text,

  -- The single provider attempt this decision produced, in the EXISTING
  -- refunds table. One decision, one attempt, forever.
  refund_attempt_id      uuid,

  version                integer not null default 1,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint couranr_rr_request_fk foreign key (request_id)
    references public.couranr_delivery_requests (id)
    on update cascade on delete restrict,
  constraint couranr_rr_obligation_fk foreign key (obligation_id)
    references public.couranr_payment_obligations (id)
    on update cascade on delete restrict,
  constraint couranr_rr_incident_fk foreign key (incident_id)
    references public.couranr_delivery_incidents (id)
    on update cascade on delete restrict,
  constraint couranr_rr_problem_report_fk foreign key (problem_report_id)
    references public.couranr_customer_problem_reports (id)
    on update cascade on delete restrict,
  constraint couranr_rr_attempt_fk foreign key (refund_attempt_id)
    references public.couranr_payment_refunds (id)
    on update cascade on delete restrict,
  constraint couranr_rr_decided_by_fk foreign key (decided_by)
    references public.profiles (id)
    on update cascade on delete restrict,

  -- EXACTLY the seven states ui_screen_registry.json OPS-011 names.
  constraint couranr_rr_state_chk check (request_state in (
    'pending','approved','processing','partially_refunded','refunded',
    'denied','failed')),

  constraint couranr_rr_requested_by_chk check (
    requested_by in ('merchant','customer','operations')),

  /* The structured reason (REF-001). Delivery-service only: no value names
     merchandise (REF-002) and no value names lateness, an ETA or a delivery
     window (TRM-001 never_claim "on-time guarantee"). */
  constraint couranr_rr_reason_chk check (reason_code in (
    'service_not_performed',
    'couranr_caused_failure',
    'duplicate_delivery_charge',
    'incorrect_delivery_charge',
    'operations_adjustment')),

  constraint couranr_rr_detail_chk check (length(detail) <= 4000),
  constraint couranr_rr_denial_reason_chk check (
    denial_reason is null or length(btrim(denial_reason)) between 1 and 2000),
  constraint couranr_rr_version_chk check (version >= 1),

  -- Integer cents, strictly positive when present.
  constraint couranr_rr_base_positive_chk check (
    refundable_base_cents is null or refundable_base_cents > 0),
  constraint couranr_rr_amount_positive_chk check (
    approved_amount_cents is null or approved_amount_cents > 0),

  /* THE OVER-REFUND GUARD, structural.
     An approved figure above the base this decision was computed against is
     UNWRITABLE. Even if every application check were deleted, a clamped or
     inflated approval could not be persisted. */
  constraint couranr_rr_amount_within_base_chk check (
    approved_amount_cents is null
    or (refundable_base_cents is not null
        and approved_amount_cents <= refundable_base_cents)),

  -- A pending request carries no decision of any kind.
  constraint couranr_rr_pending_clean_chk check (
    request_state <> 'pending'
    or (approved_amount_cents is null and refundable_base_cents is null
        and decided_by is null and decided_at is null
        and denial_reason is null and refund_attempt_id is null)),

  -- A denial is a recorded decision with a written reason and NO money.
  constraint couranr_rr_denied_stamp_chk check (
    request_state <> 'denied'
    or (decided_by is not null and decided_at is not null
        and denial_reason is not null
        and approved_amount_cents is null and refund_attempt_id is null)),

  /* An approval is durable BEFORE any provider work: the figures and the
     decider are stamped, and the attempt does not exist yet. */
  constraint couranr_rr_approved_stamp_chk check (
    request_state <> 'approved'
    or (decided_by is not null and decided_at is not null
        and refundable_base_cents is not null
        and approved_amount_cents is not null
        and refund_attempt_id is null)),

  /* Everything past 'approved' names the ONE attempt it produced. */
  constraint couranr_rr_settling_stamp_chk check (
    request_state not in ('processing','partially_refunded','refunded','failed')
    or (decided_by is not null and decided_at is not null
        and refundable_base_cents is not null
        and approved_amount_cents is not null
        and refund_attempt_id is not null)),

  /* A FULL settlement means the approved figure was the whole base; a PARTIAL
     one means it was strictly less. Neither can lie about the other. */
  constraint couranr_rr_full_settlement_chk check (
    request_state <> 'refunded'
    or approved_amount_cents = refundable_base_cents),
  constraint couranr_rr_partial_settlement_chk check (
    request_state <> 'partially_refunded'
    or approved_amount_cents < refundable_base_cents)
);

comment on table public.couranr_refund_requests is
  'OPS-011 delivery-charge refund REVIEW record (REF-001: Couranr Operations is the only refund authority). One decision per request; the money itself moves through couranr_payment_refunds, which is unchanged. Couranr refunds its own delivery charge only — merchandise price and merchandise refunds are the merchant''s (REF-002).';
comment on column public.couranr_refund_requests.refundable_base_cents is
  'Server-computed at decision time under a row lock: captured_amount_cents - coalesce(refunded_amount_cents,0). Never a caller parameter. The approved figure is validated against this and a larger figure is REFUSED, not clamped.';
comment on column public.couranr_refund_requests.approved_amount_cents is
  'Integer cents actually approved. Equal to refundable_base_cents for a full refund, strictly less for a partial one.';
comment on column public.couranr_refund_requests.refund_attempt_id is
  'The single couranr_payment_refunds attempt this decision produced. One decision, one attempt: enforced unique.';

/* At most ONE live review per obligation. A denied or settled request is
   history and does not block a later, separately reviewed one. */
create unique index if not exists couranr_rr_one_live_per_obligation_uniq
  on public.couranr_refund_requests (obligation_id)
  where request_state in ('pending','approved','processing');

/* One decision, one attempt — from the other direction too. */
create unique index if not exists couranr_rr_attempt_uniq
  on public.couranr_refund_requests (refund_attempt_id)
  where refund_attempt_id is not null;

create index if not exists couranr_rr_queue_idx
  on public.couranr_refund_requests (request_state, created_at desc);
create index if not exists couranr_rr_request_idx
  on public.couranr_refund_requests (request_id, created_at desc);

alter table public.couranr_refund_requests enable row level security;
-- The schema default ACL grants broad DML on every new public table; narrow it
-- explicitly. Append + advance only: a refund decision is never deleted.
revoke all on public.couranr_refund_requests from public, anon, authenticated;
revoke all on public.couranr_refund_requests from service_role;
grant select, insert, update on public.couranr_refund_requests to service_role;

/* ------------------------------------------------------------------ 3 ---
 * couranr_open_refund_request — record an inbound delivery-charge refund
 * request for Operations review.
 */
create or replace function public.couranr_open_refund_request(
  p_request_id        uuid,
  p_actor_user_id     uuid,
  p_requested_by      text,
  p_reason_code       text,
  p_detail            text,
  p_incident_id       uuid,
  p_problem_report_id uuid
)
returns public.couranr_refund_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
  v_ob   public.couranr_payment_obligations;
  v_rr   public.couranr_refund_requests;
begin
  -- REF-001: no refund path exists outside Operations.
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  if p_requested_by is null
     or p_requested_by not in ('merchant','customer','operations') then
    raise exception 'refund_requester_invalid' using errcode = 'CR422';
  end if;

  select * into v_ob from public.couranr_payment_obligations
   where request_id = p_request_id
   order by created_at desc limit 1;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  /* Only CAPTURED money can be given back (§7). An authorization is released,
     not refunded, and an uncaptured obligation has nothing to return. */
  if v_ob.payment_state not in ('captured','refunded') then
    raise exception 'only_captured_money_may_be_refunded' using errcode = 'CR409';
  end if;

  if p_incident_id is not null and not exists (
    select 1 from public.couranr_delivery_incidents
     where id = p_incident_id and request_id = p_request_id
  ) then
    raise exception 'incident_not_on_this_request' using errcode = 'CR422';
  end if;
  if p_problem_report_id is not null and not exists (
    select 1 from public.couranr_customer_problem_reports
     where id = p_problem_report_id and request_id = p_request_id
  ) then
    raise exception 'problem_report_not_on_this_request' using errcode = 'CR422';
  end if;

  begin
    insert into public.couranr_refund_requests(
      request_id, obligation_id, business_account_id,
      incident_id, problem_report_id,
      requested_by, reason_code, detail
    ) values (
      p_request_id, v_ob.id, v_ob.business_account_id,
      p_incident_id, p_problem_report_id,
      p_requested_by, p_reason_code, coalesce(p_detail, '')
    ) returning * into v_rr;
  exception when unique_violation then
    -- couranr_rr_one_live_per_obligation_uniq: a review is already open. Two
    -- inbound requests for the same money are ONE review, not two.
    raise exception 'refund_request_already_open' using errcode = 'CR409';
  end;

  return v_rr;
end
$fn$;

/* ------------------------------------------------------------------ 4 ---
 * couranr_deny_refund_request — a denial is a recorded decision.
 */
create or replace function public.couranr_deny_refund_request(
  p_refund_request_id uuid,
  p_actor_user_id     uuid,
  p_expected_version  integer,
  p_denial_reason     text
)
returns public.couranr_refund_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
  v_rr   public.couranr_refund_requests;
begin
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  select * into v_rr from public.couranr_refund_requests
   where id = p_refund_request_id for update;
  if not found then
    raise exception 'refund_request_not_found' using errcode = 'CR404';
  end if;

  -- Idempotent replay: a denial replayed is the same denial.
  if v_rr.request_state = 'denied' then
    return v_rr;
  end if;
  if v_rr.request_state <> 'pending' then
    raise exception 'refund_request_already_decided' using errcode = 'CR409';
  end if;
  if p_expected_version is null or p_expected_version <> v_rr.version then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;
  if nullif(btrim(coalesce(p_denial_reason,'')),'') is null then
    raise exception 'denial_reason_required' using errcode = 'CR422';
  end if;

  update public.couranr_refund_requests
     set request_state = 'denied',
         denial_reason = btrim(p_denial_reason),
         decided_by    = p_actor_user_id,
         decided_at    = now(),
         version       = version + 1,
         updated_at    = now()
   where id = v_rr.id and version = p_expected_version
  returning * into v_rr;
  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  return v_rr;
end
$fn$;

/* ------------------------------------------------------------------ 5 ---
 * couranr_approve_refund_request — THE MONEY GUARD.
 *
 * Records the decision and NOTHING ELSE. No attempt row, no provider call, no
 * obligation write. That separation is deliberate and is the same discipline
 * capture and refund already use: persist the intent first, so a process that
 * dies here leaves a durable 'approved' decision to resume rather than an
 * ambiguous half-state.
 *
 * The caller supplies a REQUESTED figure. It is never trusted: the refundable
 * base is recomputed here, under a row lock on the obligation, and a request
 * above it is REFUSED.
 */
create or replace function public.couranr_approve_refund_request(
  p_refund_request_id     uuid,
  p_actor_user_id         uuid,
  p_expected_version      integer,
  p_requested_amount_cents integer
)
returns public.couranr_refund_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
  v_rr   public.couranr_refund_requests;
  v_ob   public.couranr_payment_obligations;
  v_base integer;
begin
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  /* THE SERIALISATION POINT. Two Operations users approving the same request
     at the same moment both arrive here; one waits for the other's commit and
     then sees a row that is no longer 'pending', which the replay branch below
     converges instead of double-approving. */
  select * into v_rr from public.couranr_refund_requests
   where id = p_refund_request_id for update;
  if not found then
    raise exception 'refund_request_not_found' using errcode = 'CR404';
  end if;

  if v_rr.request_state = 'denied' then
    raise exception 'refund_request_already_denied' using errcode = 'CR409';
  end if;

  /* IDEMPOTENT REPLAY. An approval already recorded is THE approval — the
     same decision, the same figures, the same decider. The second caller
     receives it and moves on; no second decision and no second attempt is
     ever created. */
  if v_rr.request_state <> 'pending' then
    return v_rr;
  end if;

  if p_expected_version is null or p_expected_version <> v_rr.version then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  select * into v_ob from public.couranr_payment_obligations
   where id = v_rr.obligation_id for update;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;

  if v_ob.payment_state <> 'captured' then
    raise exception 'only_captured_money_may_be_refunded' using errcode = 'CR409';
  end if;
  if v_ob.captured_amount_cents is null or v_ob.captured_amount_cents <= 0 then
    raise exception 'captured_amount_missing' using errcode = 'CR422';
  end if;
  if v_ob.provider_payment_intent_id is null then
    raise exception 'obligation_has_no_payment_intent' using errcode = 'CR422';
  end if;

  /* A settlement already established on this obligation by ANY other governed
     path (a cancellation retention, a standalone full refund) owns the money.
     Reviewing a second one on top of it is refused here rather than being
     discovered later by couranr_pr_one_live_attempt_uniq. */
  if exists (
    select 1 from public.couranr_payment_refunds
     where obligation_id = v_ob.id
       and attempt_state in ('requested','pending_unknown','succeeded','settled_no_refund_due')
  ) then
    raise exception 'refund_already_settled_or_in_flight' using errcode = 'CR409';
  end if;

  /* THE SERVER-SIDE FIGURE. Integer cents, recomputed from stored money under
     the lock above. There is no path by which a browser figure becomes this. */
  v_base := v_ob.captured_amount_cents - coalesce(v_ob.refunded_amount_cents, 0);
  if v_base <= 0 then
    raise exception 'nothing_left_to_refund' using errcode = 'CR409';
  end if;

  if p_requested_amount_cents is null then
    raise exception 'refund_amount_required' using errcode = 'CR422';
  end if;
  if p_requested_amount_cents <= 0 then
    raise exception 'refund_amount_not_positive' using errcode = 'CR422';
  end if;
  /* REFUSED, NEVER CLAMPED. Silently reducing an over-large approval would
     make the Operations screen and the money disagree, and would hide the
     mistake that produced the figure. */
  if p_requested_amount_cents > v_base then
    raise exception 'refund_amount_exceeds_refundable' using errcode = 'CR422';
  end if;

  update public.couranr_refund_requests
     set request_state         = 'approved',
         refundable_base_cents = v_base,
         approved_amount_cents = p_requested_amount_cents,
         decided_by            = p_actor_user_id,
         decided_at            = now(),
         version               = version + 1,
         updated_at            = now()
   where id = v_rr.id and version = p_expected_version
  returning * into v_rr;
  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_payment_events(
    obligation_id, request_id, provider, provider_event_id, event_type,
    payment_state_before, payment_state_after, outcome, detail
  ) values (
    v_ob.id, v_ob.request_id, 'stripe',
    -- Event-derived and deterministic: the refund request plus the version it
    -- decided. A replay collides on couranr_pe_provider_event_uniq rather than
    -- minting a second approval event.
    'couranr:refund_request_approved:' || v_rr.id::text || ':v' || p_expected_version::text,
    'couranr.refund_request.approved',
    v_ob.payment_state, v_ob.payment_state, 'applied',
    jsonb_build_object(
      'refundRequestId', v_rr.id,
      'reasonCode', v_rr.reason_code,
      'refundableBaseCents', v_base,
      'approvedAmountCents', p_requested_amount_cents,
      'partial', (p_requested_amount_cents < v_base),
      'actorUserId', p_actor_user_id)
  );

  return v_rr;
end
$fn$;

/* ------------------------------------------------------------------ 6 ---
 * couranr_begin_approved_refund — turn a recorded approval into THE attempt.
 *
 * Writes one row into the EXISTING couranr_payment_refunds, which is what
 * makes every downstream guarantee apply unchanged: the one-live-attempt
 * unique index, couranr_po_refund_bounds_chk, couranr_complete_payment_refund,
 * and the balanced-ledger trigger private.couranr_ledger_post_refund.
 *
 * The provider idempotency key is EVENT-DERIVED — the refund request's id and
 * the version it was approved at — so a replay reuses the identical key and a
 * clock change cannot produce a second one.
 */
create or replace function public.couranr_begin_approved_refund(
  p_refund_request_id uuid,
  p_actor_user_id     uuid
)
returns public.couranr_payment_refunds
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role     text;
  v_rr       public.couranr_refund_requests;
  v_ob       public.couranr_payment_obligations;
  v_existing public.couranr_payment_refunds;
  v_refund   public.couranr_payment_refunds;
  v_base     integer;
begin
  select role into v_role from public.profiles where id = p_actor_user_id;
  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  select * into v_rr from public.couranr_refund_requests
   where id = p_refund_request_id for update;
  if not found then
    raise exception 'refund_request_not_found' using errcode = 'CR404';
  end if;

  /* Idempotent replay: the attempt this decision produced already exists.
     Return it so the caller converges on the SAME provider operation. */
  if v_rr.refund_attempt_id is not null then
    select * into v_existing from public.couranr_payment_refunds
     where id = v_rr.refund_attempt_id;
    if not found then
      raise exception 'refund_attempt_missing' using errcode = 'CR404';
    end if;
    return v_existing;
  end if;

  if v_rr.request_state <> 'approved' then
    raise exception 'refund_request_not_approved' using errcode = 'CR409';
  end if;
  if v_rr.approved_amount_cents is null or v_rr.refundable_base_cents is null then
    raise exception 'refund_decision_incomplete' using errcode = 'CR422';
  end if;

  select * into v_ob from public.couranr_payment_obligations
   where id = v_rr.obligation_id for update;
  if not found then
    raise exception 'obligation_not_found' using errcode = 'CR404';
  end if;
  if v_ob.payment_state <> 'captured' then
    raise exception 'only_captured_money_may_be_refunded' using errcode = 'CR409';
  end if;

  /* RE-VALIDATE AGAINST THE MONEY AS IT IS NOW, not as it was at approval.
     Another governed settlement could have landed between the decision and
     this call; the approved figure must still fit. Refused, never clamped. */
  v_base := v_ob.captured_amount_cents - coalesce(v_ob.refunded_amount_cents, 0);
  if v_base <= 0 then
    raise exception 'nothing_left_to_refund' using errcode = 'CR409';
  end if;
  if v_rr.approved_amount_cents > v_base then
    raise exception 'refund_amount_exceeds_refundable' using errcode = 'CR422';
  end if;

  begin
    insert into public.couranr_payment_refunds(
      obligation_id, request_id, provider_payment_intent_id,
      amount_cents, retained_cents, reason, refund_key, attempt_state,
      actor_user_id
    ) values (
      v_ob.id, v_ob.request_id, v_ob.provider_payment_intent_id,
      v_rr.approved_amount_cents,
      v_base - v_rr.approved_amount_cents,
      'operations_reviewed_refund',
      -- THE NAMED MINTER, in SQL. Event-derived: refund-request identity plus
      -- the version the approval was recorded at. Never now(), never random.
      'couranr:refund-request:' || v_rr.id::text || ':v' || (v_rr.version - 1)::text,
      'requested',
      p_actor_user_id
    ) returning * into v_refund;
  exception when unique_violation then
    /* Either couranr_pr_one_live_attempt_uniq (another governed settlement
       won the race for this obligation) or couranr_pr_refund_key_uniq (this
       exact decision was already begun by a concurrent caller). Re-read: if
       OUR key is there, converge on it; otherwise the obligation is spoken
       for and this decision must not create a second provider refund. */
    select * into v_existing from public.couranr_payment_refunds
     where refund_key = 'couranr:refund-request:' || v_rr.id::text || ':v' || (v_rr.version - 1)::text;
    if found then
      return v_existing;
    end if;
    raise exception 'refund_already_settled_or_in_flight' using errcode = 'CR409';
  end;

  update public.couranr_refund_requests
     set request_state    = 'processing',
         refund_attempt_id = v_refund.id,
         version          = version + 1,
         updated_at       = now()
   where id = v_rr.id;

  update public.couranr_payment_obligations
     set version = version + 1, updated_at = now()
   where id = v_ob.id;

  insert into public.couranr_payment_events(
    obligation_id, request_id, provider, provider_event_id, event_type,
    payment_state_before, payment_state_after, outcome, detail
  ) values (
    v_ob.id, v_ob.request_id, 'stripe',
    'couranr:refund_request_begun:' || v_refund.id::text,
    'couranr.refund_request.begun',
    v_ob.payment_state, v_ob.payment_state, 'applied',
    jsonb_build_object(
      'refundRequestId', v_rr.id,
      'refundId', v_refund.id,
      'amountCents', v_refund.amount_cents,
      'retainedCents', v_refund.retained_cents,
      'reason', v_refund.reason,
      'actorUserId', p_actor_user_id)
  );

  return v_refund;
end
$fn$;

/* ------------------------------------------------------------------ 7 ---
 * The review record FOLLOWS the attempt — it never leads it.
 *
 * Every terminal money outcome is written by the existing
 * couranr_complete_payment_refund / couranr_mark_payment_refund_unknown. This
 * trigger mirrors that outcome onto the review record in the SAME
 * transaction, which is what makes 'failed' a REAL recorded state rather than
 * an exception that vanishes, and what makes 'refunded' vs
 * 'partially_refunded' a fact about the money rather than a claim by the UI.
 */
create or replace function public.couranr_refund_request_follow_attempt()
returns trigger
language plpgsql security definer set search_path=''
as $fn$
declare
  v_rr    public.couranr_refund_requests;
  v_state text;
begin
  select * into v_rr from public.couranr_refund_requests
   where refund_attempt_id = new.id for update;
  if not found then
    -- Not a reviewed refund (a cancellation settlement, a standalone full
    -- refund). Those surfaces own their own records.
    return new;
  end if;

  v_state := case new.attempt_state
    when 'requested'      then 'processing'
    when 'pending_unknown' then 'processing'
    when 'failed'         then 'failed'
    when 'succeeded'      then
      case when new.amount_cents >= v_rr.refundable_base_cents
           then 'refunded' else 'partially_refunded' end
    else null end;

  if v_state is null or v_state = v_rr.request_state then
    return new;
  end if;

  update public.couranr_refund_requests
     set request_state = v_state,
         version       = version + 1,
         updated_at    = now()
   where id = v_rr.id;

  return new;
end
$fn$;

comment on function public.couranr_refund_request_follow_attempt() is
  'Mirrors a couranr_payment_refunds outcome onto its OPS-011 review record in the same transaction. SECURITY DEFINER because the writer of the attempt row is not necessarily privileged on the review table; it reads and writes only the single linked review row.';

drop trigger if exists couranr_refund_request_follow_attempt_trg
  on public.couranr_payment_refunds;
create trigger couranr_refund_request_follow_attempt_trg
  after insert or update of attempt_state, amount_cents
  on public.couranr_payment_refunds
  for each row
  execute function public.couranr_refund_request_follow_attempt();

/* ------------------------------------------------------------------ 7b --
 * ONE OBLIGATION, ONE SETTLEMENT FAMILY.
 *
 * Found by adversarial review of THIS diff, and introduced by it.
 *
 * Widening couranr_pr_reason_chk made `operations_reviewed_refund` a reason
 * the rest of the system had never seen, and OPS-009's payment recovery panel
 * classifies an attempt by `reason <> 'full_refund'`. So a FAILED reviewed
 * refund on a cancelled delivery reads to that panel as
 * "cancellation-governed", and its Resume settlement action would have
 * re-derived a CAN-001 figure and settled THAT amount instead of the one
 * Couranr Operations actually approved — with the review record left pointing
 * at the failed attempt, describing money it did not move.
 *
 * couranr_begin_payment_refund already refuses to let a standalone
 * `full_refund` override a cancellation-governed settlement (B3-I / B3-J).
 * This is the same rule, made GENERAL and enforced for every writer at once:
 * once an obligation has an attempt under some governed reason, a later
 * attempt under a DIFFERENT reason is refused. Retrying the SAME reason is
 * untouched, which is the documented recovery path.
 *
 * A trigger rather than a rewrite of couranr_begin_payment_refund on purpose:
 * that function is applied, frozen money code, and a create-or-replace would
 * reset its grants. This is additive, covers every insert path including the
 * new one, and changes no existing function.
 */
create or replace function public.couranr_refund_settlement_identity_guard()
returns trigger
language plpgsql security definer set search_path=''
as $fn$
declare v_other text;
begin
  select reason into v_other
    from public.couranr_payment_refunds
   where obligation_id = new.obligation_id
     and reason is distinct from new.reason
   limit 1;

  if v_other is not null then
    raise exception 'refund_settlement_reason_conflict' using errcode = 'CR409';
  end if;

  return new;
end
$fn$;

comment on function public.couranr_refund_settlement_identity_guard() is
  'Binds one payment obligation to one governed refund reason. A second settlement under a DIFFERENT reason is refused for every writer, so no surface can override a settlement another surface already established. Retrying the SAME reason is unaffected.';

drop trigger if exists couranr_refund_settlement_identity_guard_trg
  on public.couranr_payment_refunds;
create trigger couranr_refund_settlement_identity_guard_trg
  before insert on public.couranr_payment_refunds
  for each row
  execute function public.couranr_refund_settlement_identity_guard();

revoke all on function public.couranr_refund_settlement_identity_guard()
  from public, anon, authenticated, service_role;

/* ------------------------------------------------------------------ 8 ---
 * Grants. Every command is service-role only and gates on Operations itself.
 * A create-or-replace RESETS a function's grants, so these are stated here
 * even for functions this migration introduces, and EXECUTE is revoked from
 * PUBLIC (not only anon/authenticated) because the schema default ACL grants
 * through PUBLIC.
 */
revoke all on function public.couranr_open_refund_request(uuid,uuid,text,text,text,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_open_refund_request(uuid,uuid,text,text,text,uuid,uuid)
  to service_role;

revoke all on function public.couranr_deny_refund_request(uuid,uuid,integer,text)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_deny_refund_request(uuid,uuid,integer,text)
  to service_role;

revoke all on function public.couranr_approve_refund_request(uuid,uuid,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_approve_refund_request(uuid,uuid,integer,integer)
  to service_role;

revoke all on function public.couranr_begin_approved_refund(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_begin_approved_refund(uuid,uuid)
  to service_role;

-- The trigger function is reached only by the trigger, never by a caller.
revoke all on function public.couranr_refund_request_follow_attempt()
  from public, anon, authenticated, service_role;

commit;
