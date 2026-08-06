-- P8-001 — server-controlled conversations.
--
-- Authority: Couranr_Claude_Code_Master_Package.md §Communication model and
-- §Conversation permissions, which are byte-identical to
-- couranr_claude_code_package/05_AI_COMMUNICATION_SPEC.md lines 15-53 (verified
-- with diff). Acceptance criterion, verbatim from
-- couranr_claude_code_package/08_WORK_BREAKDOWN.csv: "Participant/privacy tests
-- pass".
--
-- The binding sentence this schema exists to enforce:
--
--   "Internal notes and AI drafts must be excluded from initial queries,
--    realtime, exports, and notifications."
--
-- Four enforcement points, not one. This migration owns the first: it makes the
-- message body UNREADABLE except through a single SECURITY DEFINER function
-- that applies the visibility rule. Realtime, exports and notifications are
-- enforced in the TypeScript layer and are covered by their own tests, because
-- no SQL construct can stop a future route from formatting a body into an email.
--
--
-- WHY THERE IS NO SELECT GRANT ON THE MESSAGE TABLE
--
-- `service_role` has rolbypassrls = true in this project (verified), so RLS
-- constrains none of the server commands and a policy on this table would be
-- decorative. The GRANT is the only real boundary. So:
--
--   * nobody — including service_role — holds table-level SELECT on
--     couranr_conversation_messages;
--   * service_role holds INSERT, plus column-level SELECT on exactly
--     (id, conversation_id, idempotency_key) so an idempotent replay can find
--     its own prior row without being able to read a body;
--   * every read of a body goes through couranr_conversation_thread(), a
--     SECURITY DEFINER function that resolves the viewer's participant row
--     itself and filters by visibility before returning anything.
--
-- The consequence that matters: a future
-- `supabaseAdmin.from("couranr_conversation_messages").select("*")` does not
-- return internal notes. It raises 42501, which lib/couranr/errors.ts already
-- maps to `not_permitted`. The mistake becomes impossible rather than merely
-- discouraged — which is the standard this acceptance criterion needs, because
-- a filter in application code is one forgotten `.eq()` from a leak and this
-- repository has already shipped that exact class of bug.
--
-- No views are used. An earlier design reached for per-viewer views; they are
-- definer-rights objects in an exposed schema, they inherit this project's
-- pg_default_acl (which grants broadly on every new object in `public`), and
-- Supabase's own linter flags them as `security_definer_view`. A single
-- function with no SELECT grant anywhere is strictly narrower.
--
--
-- SCOPE. This migration deliberately does NOT build:
--   * the customer write path — P8-004 owns the Delivery Help token surface,
--     and the shipped couranr_delivery_access_tokens migration says in its own
--     header that its token authorizes reads only. The participant table has
--     the column a customer participant will need; no customer row is created
--     here and no command accepts one.
--   * after-hours rollover — HRS-002 is `unresolved` with the acceptance
--     criterion "A named IANA timezone is recorded before any cutoff logic
--     ships." `next_operating_period_at` is created and never written. The two
--     timezone-free deadline fields ARE written, because 10-minute and
--     15-minute elapsed arithmetic needs no zone.
--   * incidents and claims — GAT-002 is `intentionally_deferred`. Note the
--     distinction: `delivery_problem` is a legitimate message TOPIC named by
--     the spec and is in the vocabulary below. The CUS-004 claims workflow is
--     not built.
--   * AI auto-replies. The `ai_draft` authorship exists so drafts can be
--     stored and excluded; nothing generates one.

begin;

-- ---------------------------------------------------------------- conversations

create table if not exists public.couranr_conversations (
  id uuid primary key default gen_random_uuid(),

  -- THREE kinds, not four. The spec lists four conversation types, the fourth
  -- being the Couranr Operations Inbox — but UI_SCREEN_REGISTRY.md:604 states
  -- OPS-005's purpose as "Unify merchant, driver, and customer-help
  -- conversations with delivery context and priority." A thing whose stated
  -- purpose is to unify the other three is a projection over them, not a
  -- fourth row type. Modelling it as a kind would mean a conversation could be
  -- an Operations Inbox conversation INSTEAD OF a merchant support one, which
  -- is not what the Inbox is.
  kind text not null,

  -- Tenancy. Never null: even a Delivery Help thread is about a delivery that
  -- belongs to a business, and every read is scoped by this column.
  business_account_id uuid not null references public.business_accounts(id),

  -- Scope. A merchant support thread may hang off neither; a delivery chat and
  -- a Delivery Help thread must hang off a delivery.
  request_id  uuid references public.couranr_delivery_requests(id),
  delivery_id uuid references public.couranr_deliveries(id),

  -- Required states, unioned across the four screens that render a thread:
  -- PUB-007 (open / waiting on customer / waiting on Couranr / resolved),
  -- MER-012 (closed), OPS-005 (escalated).
  status text not null default 'open',

  -- OPS-005 requires "waiting on party" and PUB-007 distinguishes waiting on
  -- customer from waiting on Couranr. Stored rather than derived because the
  -- party being waited on is a decision Operations makes, not a function of the
  -- last message's author.
  waiting_on text,

  -- PUB-007 requires "urgent safety escalation"; OPS-005 requires "urgent".
  urgency text not null default 'routine',

  -- Deadlines. The spec sentence, verbatim: "Conversation deadlines store
  -- received_at, response_due_at, first_couranr_response_at, next operating
  -- period, and due state. At 10 minutes mark due soon; at 15 overdue.
  -- Automated acknowledgement does not count as Operations response."
  --
  -- All five fields exist. `next_operating_period_at` is the one blocked by
  -- HRS-002 and is never written until a timezone is recorded.
  received_at               timestamptz,
  response_due_at           timestamptz,
  first_couranr_response_at timestamptz,
  next_operating_period_at  timestamptz,
  due_state                 text not null default 'on_time',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Optimistic concurrency, matching couranr_deliveries and the payment
  -- obligations. A status transition carries the version it expects.
  version integer not null default 1,

  constraint couranr_cv_kind_chk
    check (kind in ('merchant_support', 'delivery_chat', 'delivery_help')),

  constraint couranr_cv_status_chk
    check (status in ('open', 'waiting', 'resolved', 'closed', 'escalated')),

  constraint couranr_cv_waiting_on_chk
    check (waiting_on is null or waiting_on in ('couranr', 'merchant', 'driver', 'customer')),

  constraint couranr_cv_urgency_chk
    check (urgency in ('routine', 'urgent', 'safety')),

  -- The spec names exactly two marks. `on_time` is the baseline before either
  -- is reached; it is not a third mark, it is their absence.
  constraint couranr_cv_due_state_chk
    check (due_state in ('on_time', 'due_soon', 'overdue')),

  -- "It is created after delivery confirmation" binds the delivery chat, and
  -- Delivery Help is "limited by one signed token and one delivery". Both
  -- therefore require a delivery. A merchant support thread may have neither
  -- scope, or may reference a request.
  constraint couranr_cv_scope_chk
    check (
      (kind = 'merchant_support')
      or (kind in ('delivery_chat', 'delivery_help') and delivery_id is not null)
    ),

  -- One Delivery Help thread per delivery, and one delivery chat per delivery.
  -- "limited by one signed token and ONE DELIVERY" is a cardinality statement.
  constraint couranr_cv_version_chk check (version >= 1)
);

create unique index if not exists couranr_cv_one_thread_per_delivery_kind
  on public.couranr_conversations (delivery_id, kind)
  where delivery_id is not null;

create index if not exists couranr_cv_business_idx
  on public.couranr_conversations (business_account_id, status);

create index if not exists couranr_cv_due_idx
  on public.couranr_conversations (due_state, response_due_at)
  where due_state <> 'on_time';

-- ----------------------------------------------------------------- participants

create table if not exists public.couranr_conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.couranr_conversations(id) on delete cascade,

  participant_kind text not null,

  -- The authenticated identity, for merchant / driver / operations. Null for a
  -- customer, who holds a token and has no account.
  user_id uuid references auth.users(id),

  -- The merchant role at the time of joining. Stored so the send gate can read
  -- it without a second lookup, and so a later membership change does not
  -- silently rewrite history.
  --
  -- TRM-002 IS UNRESOLVED: "Each of the five roles has an explicit permission
  -- set before MER-015 ships." The spec says merchant support "includes
  -- authorized merchant roles", so which roles may participate is exactly the
  -- open question. This column stores the role; the ALLOW-LIST lives in
  -- TypeScript and starts narrow, mirroring the already-approved DRP-001 shape
  -- (lib/couranr/requests/permissions.ts: owner/manager/dispatcher may write,
  -- every active member may read). Widening later is additive; narrowing later
  -- is breaking, so narrow is the reversible direction.
  member_role text,

  -- P8-004 owns the Delivery Help token surface. The column exists so the
  -- customer participant has somewhere to point; nothing in this migration
  -- writes it, and no command in this slice accepts a customer participant.
  access_token_id uuid references public.couranr_delivery_access_tokens(id),

  -- Tenure. A driver who is unassigned stops being a participant, and must not
  -- retain a window into the thread. `left_at` closes the window without
  -- deleting the audit trail of who was present when.
  joined_at timestamptz not null default now(),
  left_at   timestamptz,

  -- The unread state. Required by ALL FOUR messaging screens — MER-012,
  -- DRV-008 and OPS-005 name "Unread" explicitly, and PUB-007 needs "waiting
  -- on" to be meaningful. Per participant, not per conversation.
  last_read_at timestamptz,

  constraint couranr_cvp_kind_chk
    check (participant_kind in ('merchant', 'driver', 'operations', 'customer')),

  constraint couranr_cvp_role_chk
    check (member_role is null
           or member_role in ('owner', 'manager', 'dispatcher', 'viewer', 'billing')),

  -- An account-holding participant has a user; a customer has a token instead.
  -- This is what makes "the customer is not a user" a schema property.
  constraint couranr_cvp_identity_chk
    check (
      (participant_kind in ('merchant', 'driver', 'operations')
        and user_id is not null and access_token_id is null)
      or
      (participant_kind = 'customer'
        and user_id is null)
    ),

  constraint couranr_cvp_tenure_chk
    check (left_at is null or left_at >= joined_at)
);

-- One live participant row per identity per conversation. A driver reassigned
-- away and back gets a second row with its own tenure window rather than a
-- silently reopened one.
create unique index if not exists couranr_cvp_live_user_uniq
  on public.couranr_conversation_participants (conversation_id, user_id)
  where left_at is null and user_id is not null;

create index if not exists couranr_cvp_lookup_idx
  on public.couranr_conversation_participants (user_id, conversation_id)
  where left_at is null;

-- --------------------------------------------------------------------- messages

create table if not exists public.couranr_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.couranr_conversations(id) on delete cascade,

  -- The author's PARTICIPANT row, not their user id. Authorship is a property
  -- of participation: it carries the tenure window and the participant kind,
  -- so a message cannot be attributed to someone who was never in the thread.
  author_participant_id uuid references public.couranr_conversation_participants(id),

  -- The four-value closed set, verbatim from the spec. No fifth value.
  visibility text not null default 'participants',

  -- `human` is a person typing. `automated` is a system acknowledgement —
  -- which the spec explicitly says "does not count as Operations response", so
  -- it must be distinguishable. `ai_draft` is a suggestion that has not been
  -- sent and must never reach a participant.
  authorship text not null default 'human',

  -- The seven customer topics, verbatim. Null for a message that is not a
  -- customer report.
  topic text,

  body text not null,

  -- Idempotency, following the house pattern exactly: a scoped UNIQUE on a
  -- caller-supplied key. Three tables already do this —
  -- couranr_delivery_requests (business_account_id, idempotency_key),
  -- couranr_merchant_workspaces (created_by, idempotency_key) and
  -- couranr_payment_obligations (request_id, idempotency_key). This closes the
  -- message half of P2-003, whose recorded remaining work is "Add the durable
  -- idempotency and audit substrate named by the work item."
  idempotency_key text not null,

  created_at timestamptz not null default now(),

  constraint couranr_cvm_visibility_chk
    check (visibility in ('participants', 'couranr_internal',
                          'driver_and_couranr', 'merchant_and_couranr')),

  constraint couranr_cvm_authorship_chk
    check (authorship in ('human', 'automated', 'ai_draft')),

  constraint couranr_cvm_topic_chk
    check (topic is null or topic in (
      'availability', 'access', 'address_concern', 'handoff_concern',
      'unrecognized_delivery', 'delivery_problem', 'other')),

  constraint couranr_cvm_body_chk
    check (length(body) between 1 and 4000),

  constraint couranr_cvm_idempotency_uniq
    unique (conversation_id, idempotency_key)
);

create index if not exists couranr_cvm_thread_idx
  on public.couranr_conversation_messages (conversation_id, created_at desc);

-- "No unrestricted customer-driver chat" (Master Package :475,
-- UI_SCREEN_REGISTRY.md:40, and DRV-008's mandatory correction) becomes a
-- SCHEMA property rather than a convention, enforced two ways.
--
-- First: which participant kinds may exist in which conversation kind. A
-- customer and a driver are never in the same thread because no conversation
-- kind admits both.
create or replace function public.couranr_cv_participant_kind_allowed(
  p_conversation_kind text,
  p_participant_kind  text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_conversation_kind
    -- Spec: "Merchant-support includes authorized merchant roles and Couranr."
    when 'merchant_support' then p_participant_kind in ('merchant', 'operations')
    -- Spec: "Delivery chat includes merchant, assigned driver, and Couranr
    -- Operations." No customer.
    when 'delivery_chat'    then p_participant_kind in ('merchant', 'driver', 'operations')
    -- Spec: "Customer Delivery Help is limited by one signed token and one
    -- delivery." The customer talks to Couranr. No driver, and no merchant —
    -- CUS-008 exists because the customer types a gate code, and the merchant
    -- has no business reading it.
    when 'delivery_help'    then p_participant_kind in ('customer', 'operations')
    else false
  end;
$$;

alter table public.couranr_conversation_participants
  drop constraint if exists couranr_cvp_kind_matches_conversation_chk;

-- A CHECK cannot reach another table, so this is a trigger. It is the same
-- guarantee, enforced at write time.
create or replace function public.couranr_cvp_enforce_kind()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
begin
  select c.kind into v_kind
    from public.couranr_conversations c
   where c.id = new.conversation_id;

  if v_kind is null then
    raise exception 'conversation % does not exist', new.conversation_id
      using errcode = 'CR404';
  end if;

  if not public.couranr_cv_participant_kind_allowed(v_kind, new.participant_kind) then
    raise exception 'a % participant may not join a % conversation',
      new.participant_kind, v_kind
      using errcode = 'CR403';
  end if;

  return new;
end;
$$;

drop trigger if exists couranr_cvp_enforce_kind_trg
  on public.couranr_conversation_participants;

create trigger couranr_cvp_enforce_kind_trg
  before insert or update of participant_kind, conversation_id
  on public.couranr_conversation_participants
  for each row execute function public.couranr_cvp_enforce_kind();

-- Second: which visibility values may appear in which conversation kind. A
-- `driver_and_couranr` message in a thread with no driver would be invisible to
-- everyone, and a `merchant_and_couranr` message in a Delivery Help thread
-- would be addressed to someone who is not in it.
create or replace function public.couranr_cv_visibility_allowed(
  p_conversation_kind text,
  p_visibility        text
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_conversation_kind
    when 'merchant_support' then p_visibility in ('participants', 'couranr_internal',
                                                  'merchant_and_couranr')
    when 'delivery_chat'    then p_visibility in ('participants', 'couranr_internal',
                                                  'driver_and_couranr', 'merchant_and_couranr')
    when 'delivery_help'    then p_visibility in ('participants', 'couranr_internal')
    else false
  end;
$$;

create or replace function public.couranr_cvm_enforce_visibility()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text;
begin
  select c.kind into v_kind
    from public.couranr_conversations c
   where c.id = new.conversation_id;

  if v_kind is null then
    raise exception 'conversation % does not exist', new.conversation_id
      using errcode = 'CR404';
  end if;

  if not public.couranr_cv_visibility_allowed(v_kind, new.visibility) then
    raise exception 'visibility % is not addressable in a % conversation',
      new.visibility, v_kind
      using errcode = 'CR400';
  end if;

  return new;
end;
$$;

drop trigger if exists couranr_cvm_enforce_visibility_trg
  on public.couranr_conversation_messages;

create trigger couranr_cvm_enforce_visibility_trg
  before insert or update of visibility, conversation_id
  on public.couranr_conversation_messages
  for each row execute function public.couranr_cvm_enforce_visibility();

-- ------------------------------------------------------------------ audit trail

-- Walks a jsonb document and reports whether any of the named keys appears at
-- ANY depth.
--
-- The jsonb `?` operator tests top-level keys only, so the obvious
-- `not (metadata ? 'body')` is defeated by `{"detail": {"body": "..."}}`. That
-- is not hypothetical: nesting context under a sub-object is the natural way to
-- write an audit payload, so the naive check would fail open exactly when
-- someone is being tidy.
--
-- IMMUTABLE because a CHECK constraint may only call immutable functions —
-- jsonb key inspection depends on nothing outside its argument.
create or replace function public.couranr_jsonb_has_no_key(
  p_doc  jsonb,
  p_keys text[]
) returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1
      from jsonb_path_query(p_doc, '$.**') as node
     cross join lateral (
       select k from jsonb_object_keys(
         case when jsonb_typeof(node) = 'object' then node else '{}'::jsonb end
       ) as k
     ) keys
     where lower(keys.k) = any (select lower(x) from unnest(p_keys) x)
  );
$$;

comment on function public.couranr_jsonb_has_no_key(jsonb, text[]) is
  'True when none of the named keys appears at any depth. Used by the '
  'conversation audit CHECK to keep a message body from being copied into an '
  'events row, where the visibility rule would not reach it. jsonb ? tests '
  'top-level keys only, which is why this walks the document.';

create table if not exists public.couranr_conversation_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.couranr_conversations(id) on delete cascade,

  -- Null for an event that is about the conversation rather than a message.
  message_id uuid references public.couranr_conversation_messages(id) on delete cascade,

  event_type text not null,

  -- The actor model mirrors the existing event tables
  -- (couranr_delivery_events, couranr_delivery_request_events), so the same
  -- vocabulary describes who did a thing across the whole system.
  actor_kind text not null,
  actor_user_id uuid references auth.users(id),

  -- Free-form context. The CHECK below is the load-bearing part.
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint couranr_cve_actor_kind_chk
    check (actor_kind in ('merchant', 'driver', 'operations', 'customer', 'system')),

  -- An audit row must never become a second, unprotected copy of a message
  -- body. The visibility rule is enforced on couranr_conversation_messages; a
  -- body copied into an events row would sit outside it entirely.
  --
  -- jsonb `?` tests TOP-LEVEL keys only, so a nested {"a":{"body":...}} would
  -- slip past a naive `not (metadata ? 'body')`. This walks the whole document.
  constraint couranr_cve_no_body_chk
    check (public.couranr_jsonb_has_no_key(metadata,
             array['body', 'message', 'text', 'content', 'note']))
);

create index if not exists couranr_cve_thread_idx
  on public.couranr_conversation_events (conversation_id, created_at desc);

-- ------------------------------------------------------- the privilege boundary
--
-- This project's pg_default_acl grants arwdDxtm on every new table in `public`
-- to anon, authenticated AND service_role. A narrow GRANT is therefore a no-op
-- unless it is preceded by a REVOKE — verified in this project's catalog, and
-- the reason a "narrow grant" elsewhere in this repo was silently inert.
--
-- RLS is enabled on all four tables for defence in depth, but it is NOT the
-- boundary: service_role has rolbypassrls = true, so every server command
-- passes straight through any policy. The GRANTs below are what actually holds.

alter table public.couranr_conversations              enable row level security;
alter table public.couranr_conversation_participants  enable row level security;
alter table public.couranr_conversation_messages      enable row level security;
alter table public.couranr_conversation_events        enable row level security;

revoke all on public.couranr_conversations             from public, anon, authenticated, service_role;
revoke all on public.couranr_conversation_participants from public, anon, authenticated, service_role;
revoke all on public.couranr_conversation_messages     from public, anon, authenticated, service_role;
revoke all on public.couranr_conversation_events       from public, anon, authenticated, service_role;

-- The conversation and participant rows carry no free text, so service_role
-- may work with them directly. Tenant scoping for these is enforced per query
-- in the command layer, exactly as it is for every other couranr_ table.
grant select, insert, update on public.couranr_conversations             to service_role;
grant select, insert, update on public.couranr_conversation_participants to service_role;
grant select, insert          on public.couranr_conversation_events      to service_role;

-- THE MESSAGE TABLE IS DIFFERENT, and this is the centre of the whole design.
--
-- No SELECT on the table. Not for anon, not for authenticated, and not for
-- service_role. `select *` on this table raises 42501 for every role in the
-- system, which lib/couranr/errors.ts already maps to `not_permitted`.
--
-- Column-level SELECT is granted on exactly three columns so that an
-- idempotent replay can locate its own prior row by key and return that row's
-- id. None of the three can carry content: not the body, not the visibility,
-- not the authorship, not the topic.
grant insert on public.couranr_conversation_messages to service_role;
grant select (id, conversation_id, idempotency_key)
  on public.couranr_conversation_messages to service_role;

-- ------------------------------------------------------------ the only reader
--
-- Every read of a message body in the entire system goes through this function.
--
-- SECURITY DEFINER, so it can read a table nobody holds SELECT on. It takes the
-- VIEWER'S PARTICIPANT ROW rather than a caller-supplied "who am I", resolves
-- that row itself, and refuses if it does not belong to the conversation. A
-- route that forgets to scope gets zero rows, not everything.
--
-- Returns `setof public.couranr_conversation_messages` — a composite — rather
-- than `returns table (...)`. `returns table` declares OUT parameters, and an
-- OUT parameter whose name collides with a column of a table in the body
-- raises 42702 at call time. That is not theoretical here: it shipped a payment
-- function dead in this repository once already.
create or replace function public.couranr_conversation_thread(
  p_conversation_id uuid,
  p_viewer_user_id  uuid
) returns setof public.couranr_conversation_messages
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
    from public.couranr_conversation_messages m
    join public.couranr_conversation_participants p
      on p.conversation_id = m.conversation_id
   where m.conversation_id = p_conversation_id
     and p.user_id         = p_viewer_user_id
     and p.left_at is null

     -- AI DRAFTS ARE EXCLUDED FOR EVERY VIEWER WITHOUT EXCEPTION, including
     -- Operations. A draft is a suggestion that has not been sent; the surface
     -- that composes one reads it by id through a separate command, never
     -- through the thread. This is the unconditional half of ":1019".
     and m.authorship <> 'ai_draft'

     -- Tenure. A driver only sees what was said while they were assigned. A
     -- reassignment closes the window; it does not hand over the history.
     and m.created_at >= p.joined_at

     -- Visibility, keyed to the viewer's participant kind. This is the whole
     -- rule, in one place, with no route able to opt out of it.
     and (
          m.visibility = 'participants'
       or (m.visibility = 'couranr_internal'     and p.participant_kind = 'operations')
       or (m.visibility = 'driver_and_couranr'   and p.participant_kind in ('driver', 'operations'))
       or (m.visibility = 'merchant_and_couranr' and p.participant_kind in ('merchant', 'operations'))
     )
   order by m.created_at asc;
$$;

revoke all on function public.couranr_conversation_thread(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_conversation_thread(uuid, uuid) to service_role;

comment on function public.couranr_conversation_thread(uuid, uuid) is
  'The ONLY path to a message body. Nobody holds SELECT on '
  'couranr_conversation_messages, so a direct select("*") raises 42501 rather '
  'than returning internal notes. Excludes ai_draft for every viewer including '
  'Operations, windows a driver to their assignment tenure, and applies the '
  'four-value visibility rule. P8-001, Master Package Communication model.';

-- pg_default_acl grants EXECUTE on every new function in `public` to anon and
-- authenticated, so these revokes are load-bearing rather than decorative.
revoke all on function public.couranr_jsonb_has_no_key(jsonb, text[])
  from public, anon, authenticated;
revoke all on function public.couranr_cv_participant_kind_allowed(text, text)
  from public, anon, authenticated;
revoke all on function public.couranr_cv_visibility_allowed(text, text)
  from public, anon, authenticated;

commit;
