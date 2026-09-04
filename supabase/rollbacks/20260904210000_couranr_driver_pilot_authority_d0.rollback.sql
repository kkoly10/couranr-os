-- Roll back Driver Pilot Readiness D0 authority corrections.
--
-- This is intentionally narrow: it restores the pre-D0 message-addressing
-- boundary and removes availability_preference. It does not alter deliveries,
-- assignments, messages, or audit rows.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

drop trigger if exists couranr_driver_availability_intent_trg
  on public.couranr_drivers;
drop function if exists private.couranr_driver_availability_intent_guard() restrict;

alter table public.couranr_drivers
  drop constraint if exists couranr_drv_availability_preference_chk;
alter table public.couranr_drivers
  drop column if exists availability_preference;

drop trigger if exists couranr_cvm_author_addressing_trg
  on public.couranr_conversation_messages;
drop function if exists public.couranr_cvm_enforce_author_addressing() restrict;
drop function if exists public.couranr_cv_actor_visibility_allowed(text,text) restrict;

commit;
