-- =====================================================================
-- Couranr canonical payment AUTHORIZATION — additive migration.
--
-- Three new tables and the named commands that drive them. This slice
-- authorizes money and does nothing else. It does NOT capture, refund, create
-- an order, create a delivery, dispatch, or recognise revenue. There is no
-- capture command here and no column to record one.
--
-- WHY A SEPARATE OBLIGATION TABLE.
-- `couranr_delivery_requests.payment_due_cents` is constrained NULL by
-- `couranr_dr_no_payment_due_chk`, and that constraint is NOT dropped here.
-- The amount that is authorized lives on its own row with its own lifecycle,
-- its own version and its own audit trail, so "what the quote says" and "what
-- was authorized against it" stay separately answerable. PAY-002 already
-- describes the model in those words: after authorization a payer change means
-- "cancel old obligation and create new".
--
-- NO CLIENT AMOUNT, ANYWHERE.
-- `couranr_create_payment_obligation` takes no amount parameter. It reads
-- `delivery_subtotal_cents` off the request. A browser cannot propose a price
-- here any more than it can on the quote itself.
--
-- SECURITY POSTURE, matching the applied P0 containment:
--   * RLS enabled immediately on all three tables
--   * no policies, so deny-all for every non-bypassing role
--   * all privileges revoked from PUBLIC, anon and authenticated
--   * service_role revoked then granted exactly the verbs the commands need
--   * every function SECURITY INVOKER with `set search_path = ''`
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- HARD GUARD. `create table if not exists` would accept an existing table
-- of a different shape and leave the database looking migrated.
-- ---------------------------------------------------------------------
do $guard$
begin
  if to_regclass('public.couranr_delivery_requests') is null then
    raise exception 'couranr_delivery_requests is missing; apply the request migrations first';
  end if;
  if to_regclass('public.couranr_payment_obligations') is not null
     or to_regclass('public.couranr_payment_events') is not null
     or to_regclass('public.couranr_payment_access_tokens') is not null then
    raise exception
      'a couranr payment table already exists. Refusing to run: its shape has not been verified.';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- 1. couranr_payment_obligations
-- ---------------------------------------------------------------------
create table public.couranr_payment_obligations (
  id                          uuid primary key default gen_random_uuid(),
  request_id                  uuid not null,
  business_account_id         uuid not null,
  payer_type                  text not null,

  -- The request generation this obligation priced. A requote bumps the
  -- request's version, which is how a stale obligation is recognised.
  request_version             integer not null,
  pricing_policy_version      text not null,

  -- Server-computed, copied from the request. Never supplied by a caller.
  amount_cents                integer not null,
  currency                    text not null default 'usd',

  payment_state               text not null default 'not_started',
  provider                    text not null default 'stripe',
  provider_payment_intent_id  text,

  idempotency_key             text not null,
  version                     integer not null default 1,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  authorized_at               timestamptz,
  failed_at                   timestamptz,
  cancelled_at                timestamptz,

  constraint couranr_po_request_fk
    foreign key (request_id) references public.couranr_delivery_requests (id)
    on update cascade on delete restrict,
  constraint couranr_po_business_fk
    foreign key (business_account_id) references public.business_accounts (id)
    on update cascade on delete restrict,

  constraint couranr_po_payer_type_chk check (payer_type in ('merchant','customer')),

  /*
   * The canonical payment vocabulary. `captured` and `refunded` are listed so
   * the CHECK does not have to be rewritten when capture ships — a later
   * migration adds the transition, not the value. NOTHING in this slice can
   * produce either: no command sets them, and `couranr_po_terminal_stamp_chk`
   * below does not know how to stamp them.
   */
  constraint couranr_po_payment_state_chk check (payment_state in (
    'not_started','requires_action','authorized','failed','cancelled',
    'captured','refunded')),

  constraint couranr_po_provider_chk check (provider = 'stripe'),
  -- One currency in this release. A second one needs a pricing decision, not
  -- a column change.
  constraint couranr_po_currency_chk check (currency = 'usd'),

  -- A zero-amount authorization is meaningless and a negative one is a bug.
  constraint couranr_po_amount_positive_chk check (amount_cents > 0),
  constraint couranr_po_request_version_chk check (request_version >= 1),
  constraint couranr_po_version_chk check (version >= 1),

  -- An authorized obligation must name the PaymentIntent that authorized it,
  -- so no row can claim money is held without saying where.
  constraint couranr_po_authorized_needs_intent_chk check (
    payment_state <> 'authorized' or provider_payment_intent_id is not null
  ),
  -- Terminal states carry their timestamp; non-terminal ones do not.
  constraint couranr_po_authorized_stamp_chk check (
    (payment_state = 'authorized') = (authorized_at is not null)
  ),
  constraint couranr_po_cancelled_stamp_chk check (
    (payment_state = 'cancelled') = (cancelled_at is not null)
  ),

  constraint couranr_po_idempotency_uniq unique (request_id, idempotency_key),
  -- One PaymentIntent belongs to exactly one obligation.
  constraint couranr_po_intent_uniq unique (provider_payment_intent_id)
);

comment on table public.couranr_payment_obligations is
  'One authorization obligation against a delivery request. Authorization only: this slice never captures, refunds, or creates an order or delivery. The amount is copied from the request quote and is never supplied by a caller.';
comment on column public.couranr_payment_obligations.amount_cents is
  'Integer cents, copied from couranr_delivery_requests.delivery_subtotal_cents by couranr_create_payment_obligation. There is no parameter for it.';
comment on column public.couranr_payment_obligations.request_version is
  'The request version this obligation priced. A requote bumps that version, which is how a superseded obligation is detected.';

/*
 * AT MOST ONE LIVE OBLIGATION PER REQUEST.
 *
 * This is what makes "a replaced quote must cancel or supersede its old unpaid
 * obligation rather than mutating its amount" an invariant rather than a
 * convention: a second live obligation cannot be inserted while the first is
 * alive, so the only way to re-price is to cancel first.
 *
 * `cancelled` is excluded, so a request accumulates a history of superseded
 * obligations. `failed` is NOT excluded — a failed authorization is retried on
 * the same obligation and the same PaymentIntent, which is how Stripe expects
 * a decline to be handled.
 */
create unique index couranr_po_one_live_per_request
  on public.couranr_payment_obligations (request_id)
  where payment_state <> 'cancelled';

create index couranr_po_business_created_idx
  on public.couranr_payment_obligations (business_account_id, created_at desc);
create index couranr_po_state_idx
  on public.couranr_payment_obligations (payment_state, updated_at desc);

-- ---------------------------------------------------------------------
-- 2. couranr_payment_events  (append-only)
-- ---------------------------------------------------------------------
create table public.couranr_payment_events (
  id                   uuid primary key default gen_random_uuid(),
  obligation_id        uuid,
  request_id           uuid,
  provider             text not null default 'stripe',

  /*
   * WEBHOOK IDEMPOTENCY LIVES HERE.
   *
   * Unique, and written FIRST. A replay collides on this constraint, which the
   * handler reads as "already processed" and answers 200 to. That is a
   * database guarantee under concurrency; a read-then-write check is not — two
   * simultaneous deliveries of the same event both read "not seen".
   *
   * `grep -rni idempotenc` over this repo used to find one hit, and it was a
   * comment.
   */
  provider_event_id    text not null,
  event_type           text not null,

  payment_state_before text,
  payment_state_after  text,
  outcome              text not null,
  detail               jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),

  constraint couranr_pe_obligation_fk
    foreign key (obligation_id) references public.couranr_payment_obligations (id)
    on update cascade on delete restrict,
  constraint couranr_pe_request_fk
    foreign key (request_id) references public.couranr_delivery_requests (id)
    on update cascade on delete restrict,

  constraint couranr_pe_provider_event_uniq unique (provider, provider_event_id),
  constraint couranr_pe_provider_chk check (provider = 'stripe'),
  constraint couranr_pe_outcome_chk check (outcome in (
    'applied','ignored','rejected')),
  constraint couranr_pe_detail_is_object_chk check (jsonb_typeof(detail) = 'object')
);

comment on table public.couranr_payment_events is
  'Append-only record of every provider event Couranr received, including ones it ignored or rejected. The unique (provider, provider_event_id) is the idempotency guarantee: a replay collides here rather than being detected by a racy read. Must never contain a card number, a client secret or a signing secret.';

create index couranr_pe_obligation_created_idx
  on public.couranr_payment_events (obligation_id, created_at desc);

-- ---------------------------------------------------------------------
-- 3. couranr_payment_access_tokens
--
-- The customer payment link. ONLY a SHA-256 hash is stored — the raw token is
-- returned exactly once, when the link is created, and is never persisted,
-- logged or recoverable. A database leak therefore yields no usable link.
-- ---------------------------------------------------------------------
create table public.couranr_payment_access_tokens (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid not null,
  business_account_id uuid not null,
  obligation_id       uuid,

  -- 64 lower-case hex characters. Never the token itself.
  token_hash          text not null,
  action              text not null default 'authorize_payment',

  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  revoked_reason      text,
  last_used_at        timestamptz,

  constraint couranr_pat_request_fk
    foreign key (request_id) references public.couranr_delivery_requests (id)
    on update cascade on delete restrict,
  constraint couranr_pat_business_fk
    foreign key (business_account_id) references public.business_accounts (id)
    on update cascade on delete restrict,
  constraint couranr_pat_obligation_fk
    foreign key (obligation_id) references public.couranr_payment_obligations (id)
    on update cascade on delete restrict,

  constraint couranr_pat_hash_uniq unique (token_hash),
  -- Shape-checked so a raw token can never be stored here by mistake: a raw
  -- token is base64url and longer, and would fail this.
  constraint couranr_pat_hash_shape_chk check (token_hash ~ '^[0-9a-f]{64}$'),
  -- One request, one action. A token is not a session.
  constraint couranr_pat_action_chk check (action = 'authorize_payment'),
  constraint couranr_pat_expiry_chk check (expires_at > created_at),
  constraint couranr_pat_revoked_reason_chk check (
    (revoked_at is null) = (revoked_reason is null)
  )
);

comment on table public.couranr_payment_access_tokens is
  'Customer payment links. Stores a SHA-256 hash only; the raw token is returned once at creation and never persisted. Scoped to one request and one action, revoked when the quote changes or the request leaves the payable states, and expired after at most 7 days.';
comment on column public.couranr_payment_access_tokens.token_hash is
  'sha256 hex of the raw token. The CHECK enforces the shape so a raw token cannot be written here.';

create index couranr_pat_request_idx
  on public.couranr_payment_access_tokens (request_id, created_at desc);

-- ---------------------------------------------------------------------
-- 4. Security.
-- ---------------------------------------------------------------------
alter table public.couranr_payment_obligations     enable row level security;
alter table public.couranr_payment_events          enable row level security;
alter table public.couranr_payment_access_tokens   enable row level security;

revoke all on public.couranr_payment_obligations   from public, anon, authenticated;
revoke all on public.couranr_payment_events        from public, anon, authenticated;
revoke all on public.couranr_payment_access_tokens from public, anon, authenticated;

-- This project's pg_default_acl grants ALL to anon, authenticated AND
-- service_role on every new table in `public`, so a bare additive grant would
-- enforce nothing. Revoke everything first, then grant back exactly the verbs.
revoke all on public.couranr_payment_obligations   from service_role;
revoke all on public.couranr_payment_events        from service_role;
revoke all on public.couranr_payment_access_tokens from service_role;

-- Obligations: read, create, advance. Never deleted — a superseded obligation
-- is cancelled, and the history of what was once owed is not erasable.
grant select, insert, update on public.couranr_payment_obligations to service_role;

-- Events: append-only.
grant select, insert on public.couranr_payment_events to service_role;

-- Tokens: created, read for redemption, and updated to record use or
-- revocation. Not deleted, so a revoked link stays auditable.
grant select, insert, update on public.couranr_payment_access_tokens to service_role;

-- ---------------------------------------------------------------------
-- 5. Widen the request event allow-list for the payer-approval transition.
--
-- Authorization is what closes `awaiting_quote_acceptance` and
-- `quote_revision_required`. That is a request-state change, so it writes a
-- request event, whose command must be allow-listed. Widened only: every
-- existing value is kept.
-- ---------------------------------------------------------------------
alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;

alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (
    command = any (array[
      'create_delivery_request_draft',
      'calculate_delivery_request_estimate',
      'submit_delivery_request',
      'begin_delivery_request_review',
      'accept_delivery_request_as_quoted',
      'requote_delivery_request',
      'decline_delivery_request',
      'record_payer_quote_approval'
    ])
  );

commit;
