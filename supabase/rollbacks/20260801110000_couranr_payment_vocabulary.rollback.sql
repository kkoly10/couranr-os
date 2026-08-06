-- Rollback for 20260801110000_couranr_payment_vocabulary.
--
-- The forward migration widened the payment_state vocabulary by two values:
-- 'partially_refunded' and 'payment_method_saved'.
--
-- ⚠ THIS ROLLBACK FAILS IF EITHER NEW VALUE IS IN USE, and it must.
--
-- Restoring the narrower CHECK on a table that holds a row in one of the two
-- new states is not possible without destroying that row's state, and a
-- payment obligation's state is not something a rollback gets to overwrite.
-- The ALTER raises, nothing changes, and the operator decides what to do about
-- the rows — which is the only safe outcome.
--
-- Check before running:
--   select payment_state, count(*) from public.couranr_payment_obligations
--    where payment_state in ('partially_refunded','payment_method_saved')
--    group by 1;

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- Restored verbatim from 20260801083000_couranr_service_plan_and_deliveries.
alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_payment_state_chk;
alter table public.couranr_payment_obligations
  add constraint couranr_po_payment_state_chk check (payment_state in (
    'not_started','requires_action','authorized',
    'capture_pending','captured',
    'failed','cancelled','refunded'));

commit;
