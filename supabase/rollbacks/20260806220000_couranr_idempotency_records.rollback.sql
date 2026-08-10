-- ---------------------------------------------------------------------
-- ROLLBACK for 20260806220000_couranr_idempotency_records
--
-- NOT SAFE BY DEFAULT, and the drop is commented out on purpose.
--
-- private.idempotency_records is the record that a money command ALREADY RAN.
-- Dropping it does not just remove a feature: it destroys the evidence that
-- lets a replayed request be recognised as a replay. A caller retrying after a
-- timeout, whose first attempt succeeded, would be told to proceed — and the
-- effect would happen a second time. For the operations this table guards
-- (PaymentIntent creation, capture, refund) that is a duplicate charge.
--
-- So the functions come out and the table stays. That is the intended way to
-- disable this: nothing can claim or complete a key, every caller falls back to
-- the per-table idempotency_key unique indexes that already existed and were
-- deliberately left in place, and the history is still there when you put the
-- commands back.
--
-- If you genuinely want the table gone, satisfy yourself FIRST that no
-- in-flight request holds an `in_progress` row:
--
--   select state, count(*) from private.idempotency_records group by state;
--
-- then uncomment the drop below. Do not uncomment it as routine cleanup.
-- ---------------------------------------------------------------------

drop function if exists private.couranr_complete_idempotent(uuid, jsonb);
drop function if exists private.couranr_begin_idempotent(text, text, uuid, text, text, timestamptz);

-- Deliberately NOT dropped — see the header.
-- drop table if exists private.idempotency_records;
-- drop type  if exists private.couranr_idempotency_outcome;
