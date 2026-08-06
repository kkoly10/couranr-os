-- P8-001 corrections. Two defects found by adversarial review of
-- 20260804150000_couranr_conversations.sql, both reproduced against a live
-- cluster before being fixed here.
--
--
-- 1. CRITICAL — `kind` was mutable, which defeated the central claim.
--
-- That migration states that "No unrestricted customer-driver chat" "becomes a
-- SCHEMA property rather than a convention". It does not. Both matrix gates are
-- BEFORE INSERT OR UPDATE triggers on the PARTICIPANT and MESSAGE tables, so
-- they only ever see a participant or a message being written. Nothing guarded
-- `couranr_conversations.kind`, and `service_role` holds UPDATE on that table.
--
-- The reproduction, run on a local cluster:
--
--   * a delivery_help thread with a customer participant and a message reading
--     "side gate code is 4821";
--   * inserting a driver participant is correctly refused — "a driver
--     participant may not join a delivery_help conversation";
--   * ONE `update couranr_conversations set kind = 'delivery_chat'` succeeds;
--   * the driver and merchant participants now insert cleanly, because the
--     trigger re-reads the NEW kind and never revalidates the existing rows;
--   * `couranr_conversation_thread` then returns the customer's gate code to
--     both the driver and the merchant.
--
-- The resulting row set is one the schema's own predicate calls illegal —
-- `couranr_cv_participant_kind_allowed('delivery_chat','customer')` is false
-- for a row that exists — and nothing in the database could detect it.
--
-- Latent rather than live: no command in this slice updates `kind`
-- (`stampDeadlines` writes a fixed key set). It is fixed anyway, because the
-- guarantee was stated as structural and 62 of 76 API routes in this repo run
-- on the service-role key.
--
-- Immutability is the fix, not revalidation. A statement-level trigger that
-- re-checked every participant and message on each kind change would permit the
-- operation and police it; refusing the operation is narrower, and a
-- conversation that needs to be a different kind is a different conversation.
--
--
-- 2. HIGH — the tenure window applied to every participant kind.
--
-- `m.created_at >= p.joined_at` was documented as a driver rule: "A driver only
-- sees what was said while they were assigned." The predicate carried no
-- participant_kind qualifier, so it windowed merchants, Operations and
-- customers too.
--
-- The consequence is not a leak but a blindness, and it lands on the one screen
-- whose entire purpose is to see everything: Operations escalated into an
-- existing thread read ZERO messages, while the merchant in the same thread
-- read two. UI_SCREEN_REGISTRY.md:604 gives OPS-005's purpose as "Unify
-- merchant, driver, and customer-help conversations with delivery context and
-- priority" — an Operations inbox that renders escalated threads empty does not
-- do that.
--
-- It also broke the customer: `couranr_help_thread` carried the same clause, so
-- a rotated Delivery Help token would have hidden the customer's OWN earlier
-- messages from them, since a new token means a new participant row with a
-- later joined_at.
--
-- The window is now scoped to drivers, which is what it was always described as.

begin;

-- ------------------------------------------------------------ 1. immutability

create or replace function public.couranr_cv_kind_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'a conversation kind may not change (% -> %)', old.kind, new.kind
      using errcode = 'CR403';
  end if;
  return new;
end;
$$;

drop trigger if exists couranr_cv_kind_immutable_trg on public.couranr_conversations;

create trigger couranr_cv_kind_immutable_trg
  before update of kind on public.couranr_conversations
  for each row execute function public.couranr_cv_kind_immutable();

comment on function public.couranr_cv_kind_immutable() is
  'Refuses any change to couranr_conversations.kind. Both matrix gates are '
  'write-time triggers on the participant and message tables, so a kind flip '
  'would strand existing rows in a conversation whose own predicate calls them '
  'illegal — putting a customer and a driver in one thread. P8-001 correction.';

-- ------------------------------------------------------- 2. driver-only tenure

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

     -- Excluded for EVERY viewer including Operations. A draft is unsent; the
     -- surface that composes one fetches it by id, never through a thread.
     and m.authorship <> 'ai_draft'

     -- TENURE, DRIVERS ONLY. A driver sees what was said while they were
     -- assigned, because a reassignment must not hand over the history of
     -- someone else's delivery. A merchant owns the thread, Operations must see
     -- all of it to do its job, and a customer must see their own words even
     -- after their token rotates — so none of the three is windowed.
     and (p.participant_kind <> 'driver' or m.created_at >= p.joined_at)

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

commit;
