-- ---------------------------------------------------------------------------
-- ACP-029 / P2-003: the general idempotency substrate.
--
-- AUTHORITY. Verified rather than recalled: NONE of the 43 records in the root
-- 02_DECISION_REGISTRY.json mentions idempotency, replay or dedup, so this
-- capability has no rank-1 decision and therefore cannot be blocked by one - it
-- is "not built", not "undecided". The authority is rank 2, the Master Package,
-- which names the table at :555 (`private.idempotency_records`) and states the
-- contract at :572-574: "Every mutable aggregate has version. Commands include
-- expectedVersion and idempotencyKey. Guarantee one effect for request
-- creation, quote acceptance, PaymentIntent creation, capture, assignment,
-- state transition, message, proof finalization, refund, and return."
--
-- WHY `private` AND NOT `public`. Measured on the connected project:
--   private   default ACL  service_role=arwd/postgres
--   public    default ACL  anon=arwdDxtm | authenticated=arwdDxtm | service_role=arwdDxtm
-- A table created in `public` is world-writable the instant it exists and only
-- an explicit REVOKE closes it. In `private` it is service_role-only by
-- construction. This table records that money commands already ran; a browser
-- role that could write it could forge a replay.
--
-- WHAT THIS DOES NOT DO, DELIBERATELY.
--
-- It does not migrate the five existing per-table `idempotency_key` unique
-- indexes (couranr_conversation_messages, couranr_delivery_assignments,
-- couranr_delivery_requests, couranr_merchant_workspaces,
-- couranr_payment_obligations). They carry FIVE INCOMPATIBLE SCOPES on live
-- rows - (conversation_id, author, key), (key) where not null,
-- (business_account_id, key), (created_by, key), (request_id, key) - and
-- changing a unique index on production data is not additive. They keep
-- working; this sits alongside them.
--
-- It does not ship a purge job. `expires_at` is CALLER-SUPPLIED and NOT NULL
-- precisely so the substrate needs no retention default: how long a completed
-- key stays replayable is an owner decision that no authority states, and
-- inventing 24h or 7d here would be inventing a policy. The column is the seam
-- for that decision, not a guess at it.
--
-- THE MISMATCH RULE IS THE SAFETY PROPERTY. The same key presented with a
-- DIFFERENT request hash is refused, not replayed and not executed. That is
-- Stripe's own semantics, and it is what stops a client that reuses a key for a
-- different amount from silently receiving the first amount's result.
-- ---------------------------------------------------------------------------

create table if not exists private.idempotency_records (
  id             uuid primary key default gen_random_uuid(),

  -- WHAT was guarded. One of the Master Package's ten operations.
  purpose        text        not null,

  -- WHO presented the key. Scoping by actor stops one tenant's key colliding
  -- with another's; `system` covers webhook and job callers with no user.
  actor_type     text        not null,
  actor_id       uuid,

  idempotency_key text       not null,

  -- A hash of the request the key was first used for. Never the request body:
  -- these rows outlive the request and must not become a second copy of
  -- customer data.
  request_hash   text        not null,

  state          text        not null default 'in_progress',

  -- Where the first effect landed, so a replay can point at it rather than
  -- redo it. Free-form because the ten operations return different shapes.
  result_ref     jsonb,

  -- NOT NULL and no default. See the header: the retention window is an owner
  -- decision, and this column is the seam for it.
  expires_at     timestamptz not null,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint couranr_idem_purpose_chk check (btrim(purpose) <> ''),
  constraint couranr_idem_key_chk     check (btrim(idempotency_key) <> ''),
  constraint couranr_idem_hash_chk    check (btrim(request_hash) <> ''),
  constraint couranr_idem_state_chk   check (state in ('in_progress','completed','expired')),
  constraint couranr_idem_actor_chk   check (actor_type in ('user','system')),

  -- A user actor must say WHICH user; a system actor must not pretend to be one.
  constraint couranr_idem_actor_id_chk check (
    (actor_type = 'user'   and actor_id is not null) or
    (actor_type = 'system' and actor_id is null)),

  -- Completed means the effect landed, so it must point somewhere.
  constraint couranr_idem_completed_chk check (
    state <> 'completed' or result_ref is not null)
);

-- THE MUTEX. `insert ... on conflict do nothing` against this index is what
-- makes two concurrent callers resolve to one winner without an advisory lock.
-- coalesce on actor_id because NULL is not equal to NULL in a unique index, so
-- without it every `system` row would be distinct and dedupe nothing.
create unique index if not exists couranr_idem_scope_uniq
  on private.idempotency_records
     (purpose, actor_type, coalesce(actor_id, '00000000-0000-0000-0000-000000000000'::uuid),
      idempotency_key);

create index if not exists couranr_idem_expiry_idx
  on private.idempotency_records (expires_at)
  where state <> 'expired';

comment on table private.idempotency_records is
  'ACP-029 general idempotency substrate (Master Package section 14). One row per (purpose, actor, key). Sits ALONGSIDE the five existing per-table idempotency_key indexes rather than replacing them - those carry five incompatible scopes on live rows.';

comment on column private.idempotency_records.expires_at is
  'Caller-supplied and NOT NULL. How long a completed key stays replayable is an unresolved owner decision; this column is the seam for it, not a default.';

-- ---------------------------------------------------------------------------
-- The outcome a caller acts on.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'couranr_idempotency_outcome'
                   and typnamespace = 'private'::regnamespace) then
    create type private.couranr_idempotency_outcome as (
      decision   text,     -- proceed | replay | in_progress | mismatch
      record_id  uuid,
      result_ref jsonb
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- couranr_begin_idempotent
--
-- Returns what the caller should DO, never a target state:
--   proceed      this caller won the key; run the effect, then complete it
--   replay       the effect already landed; return result_ref, run nothing
--   in_progress  another caller holds the key right now; do not run
--   mismatch     the key was used for a DIFFERENT request; refuse
-- ---------------------------------------------------------------------------
create or replace function private.couranr_begin_idempotent(
  p_purpose      text,
  p_actor_type   text,
  p_actor_id     uuid,
  p_key          text,
  p_request_hash text,
  p_expires_at   timestamptz
)
returns private.couranr_idempotency_outcome
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row private.idempotency_records;
begin
  if p_expires_at is null then
    raise exception 'idempotency_expiry_required' using errcode = 'CR400';
  end if;

  -- The mutex. Whoever inserts wins; everyone else falls through to the read.
  insert into private.idempotency_records
    (purpose, actor_type, actor_id, idempotency_key, request_hash, state, expires_at)
  values
    (p_purpose, p_actor_type, p_actor_id, p_key, p_request_hash, 'in_progress', p_expires_at)
  on conflict do nothing
  returning * into v_row;

  if found then
    return row('proceed', v_row.id, null)::private.couranr_idempotency_outcome;
  end if;

  select * into v_row
    from private.idempotency_records
   where purpose = p_purpose
     and actor_type = p_actor_type
     and coalesce(actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_actor_id, '00000000-0000-0000-0000-000000000000'::uuid)
     and idempotency_key = p_key
     for update;
  if not found then
    -- Lost the insert race AND cannot see the winner: the only way this happens
    -- is a concurrent delete, which no role can perform. Fail loudly rather
    -- than silently proceeding and running the effect twice.
    raise exception 'idempotency_record_vanished' using errcode = 'CR422';
  end if;

  -- An expired key is reusable, and reuse means a FRESH attempt: reset the hash
  -- to what is being asked now, or the next mismatch check would compare
  -- against a request nobody is making any more.
  if v_row.state = 'expired' or v_row.expires_at <= now() then
    update private.idempotency_records
       set state = 'in_progress', request_hash = p_request_hash, result_ref = null,
           expires_at = p_expires_at, updated_at = now()
     where id = v_row.id
    returning * into v_row;
    return row('proceed', v_row.id, null)::private.couranr_idempotency_outcome;
  end if;

  -- THE SAFETY PROPERTY. Same key, different request: refuse both ways. Running
  -- it would break the key's promise; replaying it would hand back an answer to
  -- a question nobody asked.
  if v_row.request_hash is distinct from p_request_hash then
    return row('mismatch', v_row.id, null)::private.couranr_idempotency_outcome;
  end if;

  if v_row.state = 'completed' then
    return row('replay', v_row.id, v_row.result_ref)::private.couranr_idempotency_outcome;
  end if;

  return row('in_progress', v_row.id, null)::private.couranr_idempotency_outcome;
end
$fn$;

comment on function private.couranr_begin_idempotent(text, text, uuid, text, text, timestamptz) is
  'Claims an idempotency key. Returns proceed | replay | in_progress | mismatch. The caller acts on the decision; it never names a target state. Same key with a different request hash is refused, which is what stops a reused key returning the first request''s result.';

-- ---------------------------------------------------------------------------
-- couranr_complete_idempotent
--
-- Records where the effect landed. Idempotent itself: completing an already
-- completed record returns the ORIGINAL result_ref rather than overwriting it,
-- because the first effect is the one that happened.
-- ---------------------------------------------------------------------------
create or replace function private.couranr_complete_idempotent(
  p_record_id  uuid,
  p_result_ref jsonb
)
returns private.couranr_idempotency_outcome
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row private.idempotency_records;
begin
  if p_result_ref is null then
    raise exception 'idempotency_result_required' using errcode = 'CR400';
  end if;

  select * into v_row from private.idempotency_records where id = p_record_id for update;
  if not found then
    raise exception 'idempotency_record_not_found' using errcode = 'CR404';
  end if;

  if v_row.state = 'completed' then
    return row('replay', v_row.id, v_row.result_ref)::private.couranr_idempotency_outcome;
  end if;

  update private.idempotency_records
     set state = 'completed', result_ref = p_result_ref, updated_at = now()
   where id = p_record_id
  returning * into v_row;

  return row('replay', v_row.id, v_row.result_ref)::private.couranr_idempotency_outcome;
end
$fn$;

comment on function private.couranr_complete_idempotent(uuid, jsonb) is
  'Records where an idempotent effect landed. Completing an already completed record returns the ORIGINAL result_ref rather than overwriting it - the first effect is the one that happened.';

-- ---------------------------------------------------------------------------
-- Grants. `private` inherits a default ACL of service_role only, so unlike
-- `public` there is no world-writable window to close. The REVOKEs are stated
-- anyway so the intent survives someone widening that default later.
-- ---------------------------------------------------------------------------
revoke all on table private.idempotency_records from public, anon, authenticated;
grant select, insert, update on table private.idempotency_records to service_role;

revoke all on function private.couranr_begin_idempotent(text, text, uuid, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function private.couranr_begin_idempotent(text, text, uuid, text, text, timestamptz)
  to service_role;

revoke all on function private.couranr_complete_idempotent(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function private.couranr_complete_idempotent(uuid, jsonb) to service_role;
