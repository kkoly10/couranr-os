/*
 * Driver execution: the records pickup and drop-off produce.
 *
 * Five tables, and the split between them is the design:
 *
 *   couranr_handoff_codes         mutable   attempts and lockout must be
 *                                           counted, so this one is UPDATEd
 *   couranr_proof_uploads         mutable   an authorization is issued, then
 *                                           consumed exactly once
 *   couranr_delivery_proofs       APPEND    written only at finalization
 *   couranr_handoff_records       APPEND    the structured facts of a handoff
 *   couranr_pickup_discrepancies  mutable   opened by a driver, closed by
 *                                           Operations
 *
 * Nothing here grants DELETE to anyone. A proof, a handoff record and an
 * attempt history are evidence about a real delivery of real goods; a bug or a
 * compromised command must not be able to erase them. The e2e harness pays for
 * this in residue and says so rather than widening the grant.
 *
 * `pg_default_acl` in this project grants arwdDxtm to anon, authenticated AND
 * service_role on every new table in `public`, so a bare GRANT is a silent
 * no-op — the `revoke all` below is what actually creates the boundary. RLS is
 * enabled with zero policies, matching the 13 existing canonical tables:
 * service_role has rolbypassrls, so the GRANTs and the per-query scoping
 * inside the command functions are the real gate.
 */

/* ============================================================ handoff codes */

/*
 * Two credentials, never one.
 *
 *   merchant_pickup     the merchant hands it to the driver at the door
 *   recipient_dropoff   the recipient reads it back to the driver
 *
 * They are separate rows with separate generations, separate attempt counters
 * and separate lockout state, because they are held by different people and
 * compromising one must not weaken the other.
 *
 * WHAT IS STORED IS A KEYED DIGEST, NEVER THE CODE. A six-digit code has 10^6
 * possibilities: an unkeyed SHA-256 of it — the scheme the payment-link tokens
 * use, where 256 bits of entropy carry the safety — is exhaustible offline in
 * microseconds from a single leaked row. The digest here is an HMAC computed
 * in Node under a server-only secret with domain separation per code kind, so
 * a database leak alone yields nothing. `couranr_hc_digest_shape_chk` enforces
 * 64 lower-case hex characters, which makes storing a raw PIN by mistake
 * structurally impossible.
 *
 * pgcrypto IS installed here and `extensions.hmac` works — but every command
 * function runs `set search_path = ''`, so an unqualified call raises 42883 at
 * runtime while the SQL reads correctly and the tests stay green. Computing
 * the digest in Node avoids that class entirely and keeps the secret out of
 * the database, where a leak would otherwise expose both halves at once.
 */
create table if not exists public.couranr_handoff_codes (
  id                uuid primary key default gen_random_uuid(),

  delivery_id       uuid not null
                      references public.couranr_deliveries (id)
                      on update cascade on delete restrict,

  code_kind         text not null,
  generation        integer not null,

  /* HMAC-SHA256, lower hex. Never a raw code — see the shape CHECK. */
  code_digest       text not null,

  code_state        text not null default 'active',

  issued_by         uuid not null
                      references auth.users (id)
                      on update cascade on delete restrict,
  issued_at         timestamptz not null default now(),
  expires_at        timestamptz not null,

  failed_attempts   integer not null default 0,
  last_attempt_at   timestamptz,

  consumed_at       timestamptz,
  locked_at         timestamptz,
  superseded_at     timestamptz,

  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint couranr_hc_kind_chk
    check (code_kind in ('merchant_pickup', 'recipient_dropoff')),

  constraint couranr_hc_state_chk
    check (code_state in ('active', 'consumed', 'superseded', 'locked', 'expired')),

  /* 64 lower-case hex. A six-digit string cannot satisfy this. */
  constraint couranr_hc_digest_shape_chk
    check (code_digest ~ '^[0-9a-f]{64}$'),

  constraint couranr_hc_generation_chk check (generation >= 1),
  constraint couranr_hc_version_chk    check (version >= 1),

  /*
   * Five is the lockout threshold and the counter may reach it but never pass
   * it, so an off-by-one that kept accepting attempts after the lock fails
   * here rather than silently allowing a sixth guess.
   */
  constraint couranr_hc_attempts_chk check (failed_attempts between 0 and 5),

  /*
   * One-directional stamps, every one of them. The biconditional form
   * — (state = 'consumed') = (consumed_at is not null) — makes a legal
   * transition impossible and this repo has shipped that defect twice.
   */
  constraint couranr_hc_consumed_stamp_chk
    check (code_state <> 'consumed' or consumed_at is not null),
  constraint couranr_hc_locked_stamp_chk
    check (code_state <> 'locked' or locked_at is not null),
  constraint couranr_hc_superseded_stamp_chk
    check (code_state <> 'superseded' or superseded_at is not null),

  constraint couranr_hc_window_chk check (expires_at > issued_at)
);

/* At most one usable code per delivery per kind. Regeneration supersedes. */
create unique index if not exists couranr_hc_one_active_per_kind
  on public.couranr_handoff_codes (delivery_id, code_kind)
  where code_state = 'active';

/* Generations are dense and ordered, so "which code was this" is answerable. */
create unique index if not exists couranr_hc_generation_uniq
  on public.couranr_handoff_codes (delivery_id, code_kind, generation);

create index if not exists couranr_hc_delivery_idx
  on public.couranr_handoff_codes (delivery_id);

/* ========================================================= proof uploads == */

/*
 * A two-phase upload, because the browser cannot be trusted with any part of
 * the eventual record.
 *
 * Phase 1 (initiation) writes the EXACT object path, MIME type and byte count
 * the server expects, and mints a short-lived signed upload URL for that path
 * alone. The path is server-generated and random; the browser never chooses
 * where its bytes land.
 *
 * Phase 2 (finalization) re-reads the object from storage and refuses unless
 * every one of these holds: the object exists, at exactly the expected path,
 * with size > 0, with size equal to the expected byte count, with an allowed
 * MIME type, at most 10 MiB, against an unexpired and unused authorization,
 * and while the assignment is still the caller's.
 *
 * The size checks are not defensive padding. In the browser harness a
 * disk-backed file selected through a file input is silently stripped in
 * transit and storage still answers 200 — an EMPTY object with a successful
 * upload. Without `size > 0` and `size = expected` that failure mode produces
 * a proof record that looks complete and proves nothing.
 */
create table if not exists public.couranr_proof_uploads (
  id                uuid primary key default gen_random_uuid(),

  delivery_id       uuid not null
                      references public.couranr_deliveries (id)
                      on update cascade on delete restrict,
  assignment_id     uuid not null
                      references public.couranr_delivery_assignments (id)
                      on update cascade on delete restrict,

  proof_stage       text not null,
  proof_type        text not null,

  storage_bucket    text not null,
  /* Globally unique: two authorizations can never target the same object. */
  object_path       text not null,
  expected_mime     text not null,
  expected_bytes    integer not null,

  upload_state      text not null default 'issued',

  issued_to_driver  uuid not null
                      references public.couranr_drivers (id)
                      on update cascade on delete restrict,
  issued_at         timestamptz not null default now(),
  expires_at        timestamptz not null,
  consumed_at       timestamptz,

  version           integer not null default 1,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint couranr_pu_state_chk
    check (upload_state in ('issued', 'consumed', 'expired')),

  constraint couranr_pu_consumed_stamp_chk
    check (upload_state <> 'consumed' or consumed_at is not null),

  constraint couranr_pu_bytes_chk
    check (expected_bytes > 0 and expected_bytes <= 10485760),

  constraint couranr_pu_mime_chk
    check (expected_mime in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),

  constraint couranr_pu_window_chk check (expires_at > issued_at),
  constraint couranr_pu_version_chk check (version >= 1),

  /*
   * No customer name, phone, address or PIN may appear in an object path, and
   * the path must sit under the canonical proof prefix. Enforced here as well
   * as in the generator: a path is the one part of a private object that leaks
   * through a URL, a log line and a bucket listing at once.
   */
  constraint couranr_pu_path_shape_chk
    check (object_path ~ '^couranr/proof/[0-9a-f-]{36}/[a-z_]+/[0-9a-f]{32}\.[a-z]{3,4}$')
);

create unique index if not exists couranr_pu_object_path_uniq
  on public.couranr_proof_uploads (storage_bucket, object_path);

create index if not exists couranr_pu_delivery_idx
  on public.couranr_proof_uploads (delivery_id);

/* ======================================================== delivery proofs = */

/*
 * APPEND-ONLY. A row appears here only once finalization has verified the
 * object, so the existence of a row IS the claim that the evidence is real.
 * There is no UPDATE grant and no DELETE grant: a proof with a wrong path
 * cannot be corrected, which is why finalization verifies before inserting
 * rather than inserting and repairing.
 *
 * `storage_object_path` is nullable because not every proof is a file. A
 * recipient-PIN handoff produces no object; a signature and a photo do.
 * Browser-reported coordinates are recorded as EVIDENCE, not as cryptographic
 * proof — a phone can be told to lie about where it is, and this column is
 * named and treated as what it is.
 */
create table if not exists public.couranr_delivery_proofs (
  id                  uuid primary key default gen_random_uuid(),

  delivery_id         uuid not null
                        references public.couranr_deliveries (id)
                        on update cascade on delete restrict,
  assignment_id       uuid not null
                        references public.couranr_delivery_assignments (id)
                        on update cascade on delete restrict,
  discrepancy_id      uuid,

  proof_stage         text not null,
  proof_type          text not null,

  storage_bucket      text,
  storage_object_path text,
  byte_size           integer,
  mime_type           text,

  captured_latitude   numeric(9, 6),
  captured_longitude  numeric(9, 6),
  captured_accuracy_m numeric(8, 2),

  actor_driver_id     uuid not null
                        references public.couranr_drivers (id)
                        on update cascade on delete restrict,

  metadata            jsonb not null default '{}'::jsonb,

  finalized_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),

  constraint couranr_dp_stage_chk
    check (proof_stage in ('pickup', 'dropoff', 'pickup_discrepancy')),

  constraint couranr_dp_type_chk
    check (proof_type in (
      'shipment_photo',
      'condition_photo',
      'securement_photo',
      'discrepancy_evidence',
      'delivery_photo',
      'signature',
      'recipient_pin')),

  constraint couranr_dp_metadata_obj_chk
    check (jsonb_typeof(metadata) = 'object'),

  /*
   * A file-backed proof carries all four file columns or none of them. Half a
   * reference — a path with no size, a size with no path — is the shape a
   * partially-applied write leaves behind, and it must not be storable.
   */
  constraint couranr_dp_object_complete_chk
    check (
      (storage_object_path is null and storage_bucket is null
        and byte_size is null and mime_type is null)
      or
      (storage_object_path is not null and storage_bucket is not null
        and byte_size is not null and byte_size > 0 and mime_type is not null)),

  /* Recorded coordinates come as a set or not at all. */
  constraint couranr_dp_location_pair_chk
    check ((captured_latitude is null) = (captured_longitude is null)),

  constraint couranr_dp_latitude_chk
    check (captured_latitude is null or captured_latitude between -90 and 90),
  constraint couranr_dp_longitude_chk
    check (captured_longitude is null or captured_longitude between -180 and 180),
  constraint couranr_dp_accuracy_chk
    check (captured_accuracy_m is null or captured_accuracy_m >= 0)
);

create index if not exists couranr_dp_delivery_idx
  on public.couranr_delivery_proofs (delivery_id, proof_stage);

create index if not exists couranr_dp_assignment_idx
  on public.couranr_delivery_proofs (assignment_id);

/* ======================================================= handoff records == */

/*
 * APPEND-ONLY. The structured facts of a handoff, one row per delivery per
 * stage — what the driver counted, who they dealt with, which vehicle was
 * actually there, and where they were standing.
 *
 * Separate from the proof media because they answer different questions and
 * have different lifetimes: the media may be purged one day, the record of
 * what was collected may not.
 *
 * The large-or-unusual columns are nullable because whether they are REQUIRED
 * is derived server-side from the stored request and service plan, never from
 * a browser boolean. `large_or_unusual` records which rule was applied.
 */
create table if not exists public.couranr_handoff_records (
  id                        uuid primary key default gen_random_uuid(),

  delivery_id               uuid not null
                              references public.couranr_deliveries (id)
                              on update cascade on delete restrict,
  assignment_id             uuid not null
                              references public.couranr_delivery_assignments (id)
                              on update cascade on delete restrict,

  handoff_stage             text not null,

  /* Pickup: what the driver actually counted, which may differ from declared. */
  observed_package_count    integer,
  /* First name or staff identifier. Never a document, never a face photo. */
  counterparty_first_name   text,
  confirmed_vehicle_id      uuid
                              references public.couranr_dispatch_vehicles (id)
                              on update cascade on delete restrict,

  latitude                  numeric(9, 6),
  longitude                 numeric(9, 6),
  accuracy_m                numeric(8, 2),

  large_or_unusual          boolean not null default false,
  dimensions                jsonb,
  loading_participants      text,
  loading_equipment         text,
  existing_damage_statement text,
  driver_acknowledged       boolean,

  /* Drop-off only. */
  proof_method_used         text,
  safe_location_confirmed   boolean,
  weather_suitable_confirmed boolean,

  actor_driver_id           uuid not null
                              references public.couranr_drivers (id)
                              on update cascade on delete restrict,

  recorded_at               timestamptz not null default now(),
  created_at                timestamptz not null default now(),

  constraint couranr_hr_stage_chk check (handoff_stage in ('pickup', 'dropoff')),

  constraint couranr_hr_proof_method_chk
    check (proof_method_used is null
           or proof_method_used in ('photo_or_pin', 'signature', 'leave_at_door')),

  constraint couranr_hr_count_chk
    check (observed_package_count is null or observed_package_count >= 0),

  /* Location is required at both handoffs, so it is NOT NULL by constraint. */
  constraint couranr_hr_location_present_chk
    check (latitude is not null and longitude is not null),
  constraint couranr_hr_latitude_chk  check (latitude between -90 and 90),
  constraint couranr_hr_longitude_chk check (longitude between -180 and 180),
  constraint couranr_hr_accuracy_chk  check (accuracy_m is null or accuracy_m >= 0),

  constraint couranr_hr_dimensions_obj_chk
    check (dimensions is null or jsonb_typeof(dimensions) = 'object')
);

/* One handoff record per delivery per stage. A second is a duplicate command. */
create unique index if not exists couranr_hr_one_per_stage
  on public.couranr_handoff_records (delivery_id, handoff_stage);

/* ==================================================== pickup discrepancies = */

/*
 * The driver's stop button.
 *
 * A discrepancy blocks `complete_pickup` while it is open, and the driver
 * cannot close it: they may not approve a requote, choose a different vehicle,
 * or declare a shipment safe after a material mismatch. Only Operations may
 * close one, and only through the narrow `safe_to_continue` command, which is
 * legitimate exclusively when no price, payment, vehicle or safety decision is
 * required. Everything else waits for the exceptions slice rather than being
 * quietly waved through here.
 */
create table if not exists public.couranr_pickup_discrepancies (
  id                    uuid primary key default gen_random_uuid(),

  delivery_id           uuid not null
                          references public.couranr_deliveries (id)
                          on update cascade on delete restrict,
  assignment_id         uuid not null
                          references public.couranr_delivery_assignments (id)
                          on update cascade on delete restrict,

  reason                text not null,
  notes                 text,

  discrepancy_state     text not null default 'open',

  reported_by_driver_id uuid not null
                          references public.couranr_drivers (id)
                          on update cascade on delete restrict,
  reported_at           timestamptz not null default now(),

  resolved_at           timestamptz,
  resolved_by           uuid
                          references auth.users (id)
                          on update cascade on delete restrict,
  resolution_note       text,

  version               integer not null default 1,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint couranr_pd_reason_chk
    check (reason in (
      'package_count_mismatch',
      'weight_or_size_mismatch',
      'visible_damage',
      'unsafe_packaging',
      'wrong_item',
      'vehicle_mismatch',
      'prohibited_item_concern',
      'loading_not_available',
      'other')),

  constraint couranr_pd_state_chk
    check (discrepancy_state in ('open', 'safe_to_continue')),

  /* One-directional, as everywhere else in this schema. */
  constraint couranr_pd_resolved_stamp_chk
    check (discrepancy_state = 'open'
           or (resolved_at is not null and resolved_by is not null)),

  constraint couranr_pd_version_chk check (version >= 1)
);

/* At most one open discrepancy per delivery — the blocker is singular. */
create unique index if not exists couranr_pd_one_open_per_delivery
  on public.couranr_pickup_discrepancies (delivery_id)
  where discrepancy_state = 'open';

create index if not exists couranr_pd_delivery_idx
  on public.couranr_pickup_discrepancies (delivery_id);

/* Proof evidence attached to a discrepancy resolves after both tables exist. */
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.couranr_delivery_proofs'::regclass
       and conname  = 'couranr_dp_discrepancy_fk'
  ) then
    alter table public.couranr_delivery_proofs
      add constraint couranr_dp_discrepancy_fk
      foreign key (discrepancy_id)
      references public.couranr_pickup_discrepancies (id)
      on update cascade on delete restrict;
  end if;
end
$$;

/* ================================================== RLS, revoke and grant = */

alter table public.couranr_handoff_codes         enable row level security;
alter table public.couranr_proof_uploads         enable row level security;
alter table public.couranr_delivery_proofs       enable row level security;
alter table public.couranr_handoff_records       enable row level security;
alter table public.couranr_pickup_discrepancies  enable row level security;

/*
 * The revoke is the load-bearing half. `pg_default_acl` has already granted
 * arwdDxtm to all three roles on each of these tables, so without it the
 * grants below would widen nothing and anon would hold full DML on the proof
 * and handoff-code tables.
 */
revoke all on public.couranr_handoff_codes         from public, anon, authenticated;
revoke all on public.couranr_proof_uploads         from public, anon, authenticated;
revoke all on public.couranr_delivery_proofs       from public, anon, authenticated;
revoke all on public.couranr_handoff_records       from public, anon, authenticated;
revoke all on public.couranr_pickup_discrepancies  from public, anon, authenticated;

revoke all on public.couranr_handoff_codes         from service_role;
revoke all on public.couranr_proof_uploads         from service_role;
revoke all on public.couranr_delivery_proofs       from service_role;
revoke all on public.couranr_handoff_records       from service_role;
revoke all on public.couranr_pickup_discrepancies  from service_role;

/* Mutable: attempts are counted, authorizations are consumed, blockers close. */
grant select, insert, update on public.couranr_handoff_codes        to service_role;
grant select, insert, update on public.couranr_proof_uploads        to service_role;
grant select, insert, update on public.couranr_pickup_discrepancies to service_role;

/* Append-only: evidence. No UPDATE, no DELETE, for anyone. */
grant select, insert on public.couranr_delivery_proofs to service_role;
grant select, insert on public.couranr_handoff_records to service_role;
