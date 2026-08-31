-- Rollback for 20260806170000_couranr_workspace_activation.
--
-- RESTRICT on every table, the same fail-safe as the other rollbacks.
--
-- READ THIS BEFORE RUNNING IT. `couranr_activation_acknowledgements` records
-- WHICH VERSION of the delivery terms, prohibited-item policy, responsibility
-- statement and return policy a merchant accepted, and when. That is a legal
-- record of consent. Dropping it destroys the only evidence that a merchant
-- agreed to anything, and it cannot be reconstructed. If rows exist, this
-- refuses and the decision becomes a person's — export first.
--
-- `couranr_activation_events` is the audit of who granted or blocked each
-- workspace. Same rule.
--
-- Nothing here touches couranr_delivery_requests: the forward migration only
-- REFERENCED a request as the test delivery, and removing that reference
-- leaves the request itself untouched.

begin;

drop function if exists public.couranr_decide_activation(uuid, uuid, boolean, text);
drop function if exists public.couranr_request_activation(uuid, uuid, jsonb);
drop function if exists public.couranr_record_test_delivery(uuid, uuid, uuid);
drop function if exists public.couranr_verify_activation_contact(uuid, uuid);
drop function if exists public.couranr_accept_activation_ack(uuid, uuid, text, text);
drop function if exists public.couranr_lock_activation(uuid);

drop table if exists public.couranr_activation_events restrict;
drop table if exists public.couranr_activation_acknowledgements restrict;
drop table if exists public.couranr_workspace_activations restrict;

commit;
