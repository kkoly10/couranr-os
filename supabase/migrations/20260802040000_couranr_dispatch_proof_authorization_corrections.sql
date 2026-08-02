/*
 * Corrective: three deltas the owner decisions introduce.
 *
 * All five driver-execution tables are empty (verified: 0 rows in each), so
 * these are shape changes to unused structures, not data migrations.
 *
 * 1. THE CANONICAL PROOF PREFIX IS VERSIONED.
 *    `canonical-proof/v1/<delivery-id>/<proof-id>/<random>` rather than the
 *    unversioned `couranr/proof/...` first written. The version segment is the
 *    point: the day a layout has to change, objects written under v1 stay
 *    readable and addressable without a rename, and a rename is exactly what
 *    an append-only evidence store cannot do.
 *
 *    The CHECK enforces the shape in the database as well as in the generator
 *    because a path is the one part of a private object that leaks through a
 *    signed URL, a log line and a bucket listing at once. What it structurally
 *    forbids is a path carrying a merchant or recipient name, a phone number,
 *    an address, a PIN, a token, an email or a meaningful original filename:
 *    the only free segment is 32 hex characters of server-generated entropy.
 *
 * 2. THE UPLOAD AUTHORIZATION RECORDS WHAT IT MUST PROVE LATER.
 *    Adds `upload_nonce`, `finalized_at` and `assignment_version`.
 *
 *    `assignment_version` is the one that earns its place. Finalization has to
 *    establish that "the assigned driver is still authorized for that proof
 *    stage" — and an assignment can be replaced between issuing an upload and
 *    finalizing it. Without the generation captured at issue time, a photo
 *    taken by a driver who has since been replaced would finalize against the
 *    new driver's assignment and read as their evidence.
 *
 *    `finalized_at` is kept distinct from `consumed_at`: consumed means the
 *    authorization was spent, finalized means a proof row was written from it.
 *    They are the same instant on the happy path and different when
 *    verification refuses, which is precisely the case worth being able to
 *    query.
 *
 * 3. THE DIRECT-HANDOFF COMMAND IS RENAMED.
 *    `complete_photo_or_pin_delivery` -> `complete_direct_handoff_delivery`.
 *    A photograph is NOT an alternative to the recipient PIN, and a command
 *    named "photo_or_pin" would keep suggesting in the audit trail that it
 *    was. The stored `proof_method` vocabulary on the delivery keeps its
 *    existing `photo_or_pin` value — that column is an immutable snapshot of
 *    what the merchant chose and rewriting it would be a data migration of
 *    live rows — but every driver-facing name and every audit command says
 *    direct handoff.
 *
 * Nothing is dropped except constraints and command names that no row uses.
 * Re-runnable.
 */

/* ------------------------------------------------- 1. versioned prefix --- */

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_proof_uploads'::regclass
       and conname  = 'couranr_pu_path_shape_chk'
  ) then
    alter table public.couranr_proof_uploads drop constraint couranr_pu_path_shape_chk;
  end if;
end
$$;

alter table public.couranr_proof_uploads
  add constraint couranr_pu_path_shape_chk
  check (object_path ~ '^canonical-proof/v1/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{32}\.[a-z]{3,4}$');

/* ------------------------------------ 2. what finalization has to prove -- */

alter table public.couranr_proof_uploads
  add column if not exists upload_nonce      text,
  add column if not exists finalized_at      timestamptz,
  add column if not exists assignment_version integer;

update public.couranr_proof_uploads
   set upload_nonce = coalesce(upload_nonce, encode(extensions.gen_random_bytes(16), 'hex')),
       assignment_version = coalesce(assignment_version, 1)
 where upload_nonce is null or assignment_version is null;

alter table public.couranr_proof_uploads
  alter column upload_nonce set not null,
  alter column assignment_version set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_proof_uploads'::regclass
       and conname  = 'couranr_pu_nonce_shape_chk'
  ) then
    alter table public.couranr_proof_uploads
      add constraint couranr_pu_nonce_shape_chk check (upload_nonce ~ '^[0-9a-f]{32}$');
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_proof_uploads'::regclass
       and conname  = 'couranr_pu_assignment_version_chk'
  ) then
    alter table public.couranr_proof_uploads
      add constraint couranr_pu_assignment_version_chk check (assignment_version >= 1);
  end if;

  /*
   * One-directional, like every other stamp in this schema. An authorization
   * that finalized must be consumed; a consumed one need not have finalized,
   * because verification is allowed to refuse after spending it.
   */
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_proof_uploads'::regclass
       and conname  = 'couranr_pu_finalized_stamp_chk'
  ) then
    alter table public.couranr_proof_uploads
      add constraint couranr_pu_finalized_stamp_chk
      check (finalized_at is null or consumed_at is not null);
  end if;
end
$$;

create unique index if not exists couranr_pu_nonce_uniq
  on public.couranr_proof_uploads (upload_nonce);

/* --------------------------------------------- 3. direct-handoff rename -- */

do $$
begin
  if exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_delivery_events'::regclass
       and conname  = 'couranr_dlve_command_chk'
  ) then
    alter table public.couranr_delivery_events drop constraint couranr_dlve_command_chk;
  end if;
end
$$;

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
    'complete_direct_handoff_delivery',
    'complete_signature_delivery',
    'complete_leave_at_door_delivery'));
