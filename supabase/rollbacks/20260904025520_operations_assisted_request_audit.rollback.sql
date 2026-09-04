drop trigger if exists couranr_dre_operations_actor_normalize_trg
  on public.couranr_delivery_request_events;

drop function if exists private.couranr_normalize_operations_request_event_actor();
