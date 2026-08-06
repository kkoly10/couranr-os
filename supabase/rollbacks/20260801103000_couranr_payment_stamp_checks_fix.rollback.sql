-- Rollback for 20260801103000_couranr_payment_stamp_checks_fix.
--
-- The forward migration WIDENED two CHECK constraints on
-- couranr_payment_obligations so that `authorized_at` and `captured_at` are
-- required across more payment states than before.
--
-- ⚠ THIS ROLLBACK CAN LEGITIMATELY FAIL, and that is the correct behaviour.
--
-- The prior `couranr_po_captured_stamp_chk` was an EQUIVALENCE —
-- `(payment_state = 'captured') = (captured_at is not null)` — so it rejects a
-- refunded obligation that still carries a captured_at, which the widened
-- version deliberately permits. If any such row exists, the ALTER below raises
-- and nothing is changed. Do not "fix" that by deleting rows: a failure here
-- means real payment history is incompatible with the older, narrower rule,
-- which is exactly what the forward migration was written to allow.
--
-- The prior `couranr_po_authorized_stamp_chk` did not exist at all — it was
-- introduced by the forward migration — so reverting means dropping it.

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- Introduced by the forward migration; no prior version to restore.
alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_authorized_stamp_chk;

-- Restored verbatim from 20260801083000_couranr_service_plan_and_deliveries.
alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_captured_stamp_chk;
alter table public.couranr_payment_obligations
  add constraint couranr_po_captured_stamp_chk check (
    (payment_state = 'captured') = (captured_at is not null)
  );

commit;
