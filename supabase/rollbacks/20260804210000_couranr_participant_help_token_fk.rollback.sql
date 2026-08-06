-- Rollback for the participant help-token foreign key.
--
-- Applying this restores the CRITICAL defect it fixes: the customer
-- participant's token column points back at couranr_delivery_access_tokens,
-- and every Delivery Help redemption fails with a foreign-key violation
-- because couranr_redeem_help_token writes a help-token id.
--
-- It will also FAIL if any participant row carries a help-token id, since
-- those values are not present in the tracking table. That failure is correct:
-- it means Delivery Help has been used, and reverting would orphan real
-- customer participants.

begin;

alter table public.couranr_conversation_participants
  drop constraint if exists couranr_cvp_help_token_fkey;

alter table public.couranr_conversation_participants
  add constraint couranr_conversation_participants_access_token_id_fkey
  foreign key (access_token_id)
  references public.couranr_delivery_access_tokens(id);

commit;
