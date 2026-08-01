-- =====================================================================
-- Canonical payment vocabulary — preservation only.
--
-- Adds `payment_method_saved` and `partially_refunded` to the payment state
-- CHECK so the constraint carries the full canonical vocabulary.
--
-- THIS IMPLEMENTS NOTHING. No command writes either value, no route reaches
-- one, and no transition produces one. They exist here for exactly the reason
-- `captured` and `refunded` were added before them: shipping the feature later
-- becomes a new transition rather than a CHECK rewrite on a table that by then
-- holds live money.
--
-- `tests/couranr-payment-vocabulary.test.ts` asserts both are accepted by the
-- constraint AND have zero transition writers, so "declared" cannot quietly
-- drift into "reachable".
--
-- Widened only. Every existing value is kept, so no row can become invalid,
-- and the working capture flow is untouched.
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_payment_state_chk;

alter table public.couranr_payment_obligations
  add constraint couranr_po_payment_state_chk check (payment_state in (
    -- reachable today
    'not_started','requires_action','authorized',
    'capture_pending','captured',
    'failed','cancelled',
    -- declared, unreachable: no command writes any of these
    'refunded','partially_refunded','payment_method_saved'));

commit;
