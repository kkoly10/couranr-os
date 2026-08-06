-- CRITICAL: the customer participant's token pointed at the WRONG TABLE, so
-- Delivery Help could never work at all.
--
-- `couranr_conversation_participants.access_token_id` was declared in
-- 20260804150000 as:
--
--     access_token_id uuid references public.couranr_delivery_access_tokens(id)
--
-- — the TRACKING token table. P8-004 then created a separate
-- `couranr_help_access_tokens` table, precisely because the tracking token is
-- read-only by its own table comment and must not become a write credential.
-- But the participant column was never retargeted, so
-- `couranr_redeem_help_token` inserts a HELP token id into a column whose
-- foreign key demands a TRACKING token id.
--
-- Every redemption therefore failed:
--
--     ERROR: insert or update on table "couranr_conversation_participants"
--            violates foreign key constraint
--            "couranr_conversation_participants_access_token_id_fkey"
--     DETAIL: Key (access_token_id)=(…) is not present in table
--             "couranr_delivery_access_tokens".
--
-- This is worse than the "nothing issues a token" finding it was found
-- alongside, and independent of it: even a correctly issued token could not be
-- redeemed. P8-004 was unreachable twice over.
--
-- IT WAS NEVER CAUGHT because every test of this slice was static — SQL text
-- assertions and TypeScript source scans — plus a browser run whose API layer
-- was stubbed. Nothing executed `couranr_redeem_help_token` against a real
-- delivery until now. A migration that applies cleanly and a function that
-- compiles prove nothing about a foreign key that only fires on INSERT.
--
--
-- THE FIX retargets the column. Safe on live data: the FK is only ever written
-- by `couranr_redeem_help_token`, which has never succeeded, so no row carries
-- a value — verified before this migration was written, and re-asserted by the
-- guard below rather than assumed.

begin;

-- Fail loudly rather than silently dropping a constraint that is holding real
-- rows. If any participant carries a tracking-token id, the premise above is
-- wrong and this migration must not proceed.
do $$
declare n integer;
begin
  select count(*) into n
    from public.couranr_conversation_participants
   where access_token_id is not null;

  if n > 0 then
    raise exception
      'refusing to retarget access_token_id: % participant row(s) already carry a value; '
      'the assumption that redemption never succeeded is false and these rows need review', n
      using errcode = 'CR409';
  end if;
end $$;

alter table public.couranr_conversation_participants
  drop constraint if exists couranr_conversation_participants_access_token_id_fkey;

alter table public.couranr_conversation_participants
  add constraint couranr_cvp_help_token_fkey
  foreign key (access_token_id)
  references public.couranr_help_access_tokens(id);

comment on column public.couranr_conversation_participants.access_token_id is
  'The DELIVERY HELP token a customer participant holds — couranr_help_access_'
  'tokens, not couranr_delivery_access_tokens. The two are different '
  'credentials with different lifetimes: a tracking link is read-only and may '
  'be forwarded, a help token authorizes exactly one write. This column '
  'originally referenced the tracking table, which made every redemption fail '
  'with a foreign-key violation.';

commit;
