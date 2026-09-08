-- Remove the consumer Places per-session throttle. Guest-session evidence
-- (tokens, bound requests) is not modified or deleted; only the additive
-- counter columns and the claim function introduced by the paired forward
-- migration are removed.

begin;

drop function if exists public.couranr_claim_consumer_place_search(uuid);

alter table public.couranr_consumer_guest_sessions
  drop constraint if exists couranr_cgs_places_count_chk,
  drop column if exists places_request_count,
  drop column if exists places_window_started_at;

commit;
