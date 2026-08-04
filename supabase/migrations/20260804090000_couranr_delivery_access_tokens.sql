-- =====================================================================
-- Couranr customer tracking access — additive migration.
--
-- One new table and three named commands. This slice grants a RECIPIENT the
-- right to see a sanitized view of one delivery. It authorizes nothing else:
-- there is no command here that changes a delivery, a payment, an assignment
-- or a proof, and no column that could record one.
--
-- WHY THE TOKEN IS SCOPED TO THE REQUEST, NOT THE DELIVERY.
-- `couranr_deliveries` rows are created only after payment capture, one per
-- request (`couranr_dlv_request_uniq`). PUB-006 must render "Preparing" and
-- "confirmed" — both of which are request states that exist BEFORE any
-- delivery row does. A delivery-scoped token could not be issued at the moment
-- the customer is first told to expect a delivery. Redemption resolves the
-- delivery through the request when one exists and reports its absence
-- honestly when it does not.
--
-- WHY THE TTL IS LONGER THAN THE PAYMENT LINK'S SEVEN DAYS.
-- `02_DECISION_REGISTRY.json` settles the lifetime of the SIGNED MEDIA URL
-- (PHO-001: 600 seconds for a customer) and is SILENT on the lifetime of the
-- tracking link itself. That gap is filled here, deliberately and narrowly:
--
--   * a payment link's 7-day ceiling is a PAYMENT constraint — it bounds how
--     long an authorization may sit unclaimed. Nothing about that reasoning
--     transfers to a read-only status page.
--   * the sensitive artifact is the proof media, and this token does not grant
--     it. It grants the right to ASK for a 600-second signed URL, which is
--     re-authorized on every request. A longer-lived token therefore widens
--     nothing that PHO-001 narrowed.
--   * a recipient needs the link after the delivery, not only during it —
--     CUS-006 is the proof viewer and CUS-007 is return and refund status,
--     both of which are read after the fact.
--
-- 30 days, clamped in SQL so a caller cannot ask for more. This is a judgment
-- call recorded as one; if the registry later decides a tracking-link TTL,
-- that decision wins and this clamp changes to match it.
--
-- SECURITY POSTURE, matching every other Couranr table:
--   * RLS enabled immediately
--   * no policies, so deny-all for every non-bypassing role
--   * all privileges revoked from PUBLIC, anon and authenticated
--   * service_role revoked THEN granted exactly the verbs the commands need,
--     because this project's pg_default_acl grants ALL on every new object in
--     `public` to anon, authenticated and service_role — a bare additive grant
--     would enforce nothing
--   * every function SECURITY INVOKER with `set search_path = ''`
--   * every table aliased and every column qualified inside the function that
--     `returns table`, because its OUT parameters share names with columns it
--     reads. That exact collision made `couranr_redeem_payment_access_token`
--     raise 42702 on 100% of calls (see 20260731234500).
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- HARD GUARD. `create table if not exists` would accept an existing table of
-- a different shape and leave the database looking migrated.
-- ---------------------------------------------------------------------
do $guard$
begin
  if to_regclass('public.couranr_delivery_requests') is null
     or to_regclass('public.couranr_deliveries') is null then
    raise exception 'couranr request/delivery tables are missing; apply the earlier migrations first';
  end if;
  if to_regclass('public.couranr_delivery_access_tokens') is not null then
    raise exception
      'public.couranr_delivery_access_tokens already exists. Refusing to run: its shape has not been verified.';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------
-- 1. couranr_delivery_access_tokens
--
-- The customer tracking link. ONLY a SHA-256 hash is stored — the raw token is
-- returned exactly once, when the link is created, and is never persisted,
-- logged or recoverable. A database leak yields no usable link.
-- ---------------------------------------------------------------------
create table public.couranr_delivery_access_tokens (
  id                  uuid primary key default gen_random_uuid(),
  request_id          uuid not null,
  business_account_id uuid not null,

  -- 64 lower-case hex characters. Never the token itself.
  token_hash          text not null,

  -- Who the link is for. One value today; the column exists so a second
  -- audience can be added without a second table, exactly as `action` does on
  -- couranr_payment_access_tokens.
  audience            text not null default 'recipient',

  created_at          timestamptz not null default now(),
  expires_at          timestamptz not null,
  revoked_at          timestamptz,
  revoked_reason      text,
  last_used_at        timestamptz,

  constraint couranr_dat_request_fk
    foreign key (request_id) references public.couranr_delivery_requests (id)
    on update cascade on delete restrict,
  constraint couranr_dat_business_fk
    foreign key (business_account_id) references public.business_accounts (id)
    on update cascade on delete restrict,

  constraint couranr_dat_hash_uniq unique (token_hash),
  -- Shape-checked so a raw token can never be stored here by mistake: a raw
  -- token is base64url and longer, and would fail this.
  constraint couranr_dat_hash_shape_chk check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint couranr_dat_audience_chk check (audience = 'recipient'),
  constraint couranr_dat_expiry_chk check (expires_at > created_at),
  constraint couranr_dat_revoked_reason_chk check (
    (revoked_at is null) = (revoked_reason is null)
  )
);

comment on table public.couranr_delivery_access_tokens is
  'Customer tracking links. Stores a SHA-256 hash only; the raw token is returned once at creation and never persisted. Scoped to one request and one audience, and read-only: redeeming one grants a sanitized status projection and the right to request a short-lived signed proof URL, never the ability to change anything.';
comment on column public.couranr_delivery_access_tokens.token_hash is
  'sha256 hex of the raw token. The CHECK enforces the shape so a raw token cannot be written here.';
comment on column public.couranr_delivery_access_tokens.audience is
  'Who the link was issued to. Only ''recipient'' today. A link is not a session and never carries a role.';

create index couranr_dat_request_idx
  on public.couranr_delivery_access_tokens (request_id, created_at desc);

-- ---------------------------------------------------------------------
-- 2. Security.
-- ---------------------------------------------------------------------
alter table public.couranr_delivery_access_tokens enable row level security;

revoke all on public.couranr_delivery_access_tokens from public, anon, authenticated;
-- pg_default_acl grants ALL to service_role on every new table in `public`,
-- so this revoke is what makes the grant below mean something.
revoke all on public.couranr_delivery_access_tokens from service_role;

-- Created, read for redemption, updated to record use or revocation. Never
-- deleted, so a revoked link stays auditable.
grant select, insert, update on public.couranr_delivery_access_tokens to service_role;

-- ---------------------------------------------------------------------
-- 3. Commands.
-- ---------------------------------------------------------------------

/**
 * Issue one tracking link for one request, retiring any previous live link.
 *
 * The raw token never reaches this function — the caller generates 256 bits of
 * entropy, hands over the SHA-256 hash, and keeps the raw value only long
 * enough to put it in a URL.
 *
 * Issuable only from `confirmed`. A draft, a declined request or one still
 * awaiting a quote has nothing to track, and a link issued early would be a
 * link that outlives the decision not to deliver.
 */
create function public.couranr_issue_delivery_access_token(
  p_request_id uuid,
  p_token_hash text,
  p_ttl_days   integer
)
returns public.couranr_delivery_access_tokens
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_tok public.couranr_delivery_access_tokens;
  v_ttl integer;
begin
  -- Thirty days is the ceiling, not a suggestion.
  v_ttl := least(greatest(coalesce(p_ttl_days, 30), 1), 30);

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode = 'CR422';
  end if;

  select r.* into v_req
    from public.couranr_delivery_requests r
   where r.id = p_request_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  if v_req.request_state <> 'confirmed' then
    raise exception 'request_not_trackable' using errcode = 'CR409';
  end if;

  -- One live link per request: issuing a new one retires the old.
  update public.couranr_delivery_access_tokens t
     set revoked_at = now(), revoked_reason = 'replaced_by_new_link'
   where t.request_id = p_request_id and t.revoked_at is null;

  insert into public.couranr_delivery_access_tokens (
    request_id, business_account_id, token_hash, audience, expires_at
  ) values (
    v_req.id, v_req.business_account_id, p_token_hash,
    'recipient', now() + make_interval(days => v_ttl)
  )
  returning * into v_tok;

  return v_tok;
end
$fn$;

comment on function public.couranr_issue_delivery_access_token is
  'Issues one tracking link for one confirmed request, retiring any previous link. Stores only the SHA-256 hash — the raw token never reaches this function. TTL is capped at 30 days. SECURITY INVOKER, service_role only.';

/**
 * Redeem a tracking link.
 *
 * Returns WHAT the link points at, never the delivery itself: the caller reads
 * the row it names through its own scoped query and builds the sanitized
 * projection there. Keeping the projection out of SQL means one allow-list, in
 * one place, with one test — rather than a second copy here that could quietly
 * start returning a gate code.
 *
 * A refused link carries NO identifiers. `not_found`, `revoked` and `expired`
 * return nulls for every id, so probing links tells an attacker nothing about
 * whether a delivery exists — which is PHO-001's acceptance criterion that an
 * unauthorized caller receives the same response as for a missing delivery.
 *
 * Redemption does NOT gate on request state. A recipient holding a live link
 * for a request that was later cancelled is entitled to be told that, and the
 * state travels in the projection rather than becoming a dead link.
 *
 * EVERY table below is aliased and every column qualified. The OUT parameters
 * `request_id`, `delivery_id`, `business_account_id` and `request_state` are
 * PL/pgSQL variables inside this body AND columns of the tables it reads; an
 * unqualified reference raises 42702 at runtime, which is precisely how the
 * payment redemption function shipped dead (see 20260731234500).
 */
create function public.couranr_redeem_delivery_access_token(p_token_hash text)
returns table (
  valid               boolean,
  reason              text,
  request_id          uuid,
  delivery_id         uuid,
  business_account_id uuid,
  request_state       text
)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_tok public.couranr_delivery_access_tokens;
  v_req public.couranr_delivery_requests;
  v_dlv_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return query select false, 'not_found'::text,
                        null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  select t.* into v_tok
    from public.couranr_delivery_access_tokens t
   where t.token_hash = p_token_hash;

  if not found then
    return query select false, 'not_found'::text,
                        null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_tok.revoked_at is not null then
    return query select false, 'revoked'::text,
                        null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  if v_tok.expires_at <= now() then
    return query select false, 'expired'::text,
                        null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  select r.* into v_req
    from public.couranr_delivery_requests r
   where r.id = v_tok.request_id;

  if not found then
    return query select false, 'not_found'::text,
                        null::uuid, null::uuid, null::uuid, null::text;
    return;
  end if;

  -- Aliased and qualified. `d.request_id` is the column; the bare name here
  -- would be the OUT parameter.
  select d.id into v_dlv_id
    from public.couranr_deliveries d
   where d.request_id = v_req.id;

  update public.couranr_delivery_access_tokens t
     set last_used_at = now()
   where t.id = v_tok.id;

  return query select true, null::text,
                      v_req.id, v_dlv_id, v_req.business_account_id, v_req.request_state;
end
$fn$;

comment on function public.couranr_redeem_delivery_access_token is
  'Resolves a tracking link by its SHA-256 hash and returns the request, delivery and business it names. Refuses a revoked or expired link with no identifiers at all, so a refusal is indistinguishable from a link that never existed. Returns no delivery detail — the caller builds the sanitized projection. SECURITY INVOKER, service_role only.';

/**
 * Revoke every live tracking link for a request.
 *
 * A reason is REQUIRED, and `couranr_dat_revoked_reason_chk` refuses a
 * revocation without one, so the table can always answer why a link stopped
 * working.
 */
create function public.couranr_revoke_delivery_access_tokens(
  p_request_id uuid,
  p_reason     text
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'revoke_reason_required' using errcode = 'CR422';
  end if;

  update public.couranr_delivery_access_tokens t
     set revoked_at = now(), revoked_reason = p_reason
   where t.request_id = p_request_id and t.revoked_at is null;

  get diagnostics v_n = row_count;
  return v_n;
end
$fn$;

comment on function public.couranr_revoke_delivery_access_tokens is
  'Revokes every live tracking link for a request and records why. SECURITY INVOKER, service_role only.';

-- ---------------------------------------------------------------------
-- 4. Execution privileges.
--
-- PostgreSQL grants EXECUTE to PUBLIC on every new function, and this
-- project's pg_default_acl additionally grants it to anon, authenticated and
-- service_role. Both must go, or these are callable from a browser holding
-- only the publishable key.
-- ---------------------------------------------------------------------
revoke all on function public.couranr_issue_delivery_access_token(uuid, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_redeem_delivery_access_token(text)
  from public, anon, authenticated, service_role;
revoke all on function public.couranr_revoke_delivery_access_tokens(uuid, text)
  from public, anon, authenticated, service_role;

grant execute on function public.couranr_issue_delivery_access_token(uuid, text, integer)
  to service_role;
grant execute on function public.couranr_redeem_delivery_access_token(text)
  to service_role;
grant execute on function public.couranr_revoke_delivery_access_tokens(uuid, text)
  to service_role;

commit;
