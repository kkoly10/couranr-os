-- Rollback for 20260802040000_couranr_dispatch_proof_authorization_corrections.
--
-- ⚠ THIS DESTROYS DATA. The forward migration added three columns to
-- couranr_proof_uploads — upload_nonce, finalized_at, assignment_version — AND
-- BACKFILLED them. couranr_proof_uploads holds real production rows, so
-- dropping the columns discards the backfilled values permanently. There is no
-- way to reconstruct upload_nonce, which is generated entropy.
--
-- It also widened couranr_pu_path_shape_chk and couranr_dlve_command_chk. Both
-- are restored to the immediately-prior definition, and both restores CAN
-- LEGITIMATELY FAIL against rows that use the newer shape or vocabulary — which
-- is the correct outcome, not something to work around.
--
-- Check before running:
--   select count(*) from public.couranr_proof_uploads where upload_nonce is not null;
--   select object_path from public.couranr_proof_uploads limit 20;

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- Restored verbatim from 20260802020000_couranr_dispatch_driver_execution_vocabulary.
alter table public.couranr_delivery_events
  drop constraint if exists couranr_dlve_command_chk;
alter table public.couranr_delivery_events
  add constraint couranr_dlve_command_chk
  check (command in (
    'create_delivery_from_capture',
    'assign_delivery',
    'unassign_delivery_before_pickup',
    'start_route_to_pickup',
    'arrive_at_pickup',
    'report_pickup_discrepancy',
    'resolve_pickup_discrepancy_safe_to_continue',
    'complete_pickup',
    'start_route_to_dropoff',
    'arrive_at_dropoff',
    'complete_photo_or_pin_delivery',
    'complete_signature_delivery',
    'complete_leave_at_door_delivery'));

-- Introduced by the forward migration.
alter table public.couranr_proof_uploads
  drop constraint if exists couranr_pu_nonce_shape_chk;
drop index if exists public.couranr_pu_nonce_uniq;

-- Restored from the inline definition in
-- 20260802030000_couranr_dispatch_driver_execution_tables (CREATE TABLE body).
alter table public.couranr_proof_uploads
  drop constraint if exists couranr_pu_path_shape_chk;
alter table public.couranr_proof_uploads
  add constraint couranr_pu_path_shape_chk
    check (object_path ~ '^couranr/proof/[0-9a-f-]{36}/[a-z_]+/[0-9a-f]{32}\.[a-z]{3,4}$');

-- Data loss, stated plainly above.
alter table public.couranr_proof_uploads
  drop column if exists assignment_version,
  drop column if exists finalized_at,
  drop column if exists upload_nonce;

commit;
