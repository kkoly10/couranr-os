-- =====================================================================
-- Fix: the payment timestamp CHECKs assumed `authorized` was terminal.
--
-- They were written as biconditionals:
--
--     (payment_state = 'authorized') = (authorized_at is not null)
--     (payment_state = 'captured')   = (captured_at   is not null)
--
-- which was right while authorization was the end of the line. It stopped
-- being right the moment capture existed: moving authorized -> capture_pending
-- leaves `authorized_at` set — correctly, because it records WHEN THE HOLD WAS
-- PLACED, which does not stop being true — and the biconditional then reads
-- `false = true` and raises 23514. `couranr_begin_payment_capture` could never
-- complete. Caught by the first end-to-end probe.
--
-- The real invariant is one-directional: a state at or after authorization
-- MUST carry its timestamp; earlier and terminal states may carry it or not,
-- because history is not erased when a row moves on. Same for capture, which
-- also leaves `refunded` room to exist later without another migration.
--
-- ADDITIVE. Two CHECKs replaced; no data touched.
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_authorized_stamp_chk;
alter table public.couranr_payment_obligations
  add constraint couranr_po_authorized_stamp_chk check (
    payment_state not in ('authorized','capture_pending','captured','refunded')
    or authorized_at is not null
  );

alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_captured_stamp_chk;
alter table public.couranr_payment_obligations
  add constraint couranr_po_captured_stamp_chk check (
    payment_state not in ('captured','refunded')
    or (captured_at is not null and captured_amount_cents is not null)
  );

commit;
