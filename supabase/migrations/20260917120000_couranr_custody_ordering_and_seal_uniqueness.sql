-- G + N: prove the custody SEQUENCE, and stop a serialized seal being reused.
--
-- FORWARD-ONLY. 20260915110000 and 20260915090000 are already applied in
-- production, so neither is edited: this migration replaces the trigger
-- FUNCTION by name and adds a new index. Production picks up a correction only
-- through a new forward migration, never through an edit to an applied one.
--
-- ─────────────────────────────── G ──────────────────────────────────────────
-- What the applied trigger proves today is PRESENCE plus one ordering rule:
-- both photos exist, a seal exists, and the credential was consumed after the
-- photos. Three parts of the sequence the UI actually walks are unproven, and a
-- direct API caller reaching the RPCs in a different order satisfies all of it:
--
--   * the sealed-package photo could be taken FIRST and the "pre-pack" photo
--     uploaded afterwards. Both exist, so it passed — and a pre-pack photo taken
--     after the package was sealed proves nothing about what is inside it, which
--     is the single thing that photo exists to prove.
--   * the seal record could predate the photograph it cites.
--   * the credential was compared against the photos but never against the SEAL,
--     so it could be consumed before the seal was recorded.
--
-- WHICH sealed photo counts: the one the SEAL is bound to, not the latest of
-- however many exist. `max(finalized_at)` let a later upload repair an
-- out-of-order sequence after the fact. The bound proof is the authoritative
-- one because it is the photograph the serial number is actually visible in.
--
-- WHICH pre-pack photo counts: the EARLIEST. A driver may legitimately take
-- several, and requiring the first to precede the sealing is the honest reading
-- of "the item was documented before it went into the package".
--
-- ─────────────────────────────── N ──────────────────────────────────────────
-- A tamper-evident seal is single-use by physical construction: it cannot be
-- removed and reapplied, which is the entire point. Two custody records citing
-- one serial therefore means one of them is false, and the database should not
-- hold both quietly. Unique on the NORMALIZED identifier, because 'CR-SEAL-0042'
-- and 'cr-seal-0042' are the same physical label and a case-sensitive index
-- would wave the second one through.
--
-- A replacement seal carries its own serial, so nothing legitimate needs to
-- reuse one. The table is empty in production, so this applies cleanly with no
-- historical rows to reconcile.

begin;

create unique index if not exists couranr_dss_identifier_unique_active
  on public.couranr_delivery_security_seals (upper(btrim(seal_identifier)));

comment on index public.couranr_dss_identifier_unique_active is
  'A serialized tamper-evident seal is single-use. Two custody records claiming '
  'one serial means one is false. Normalized so case cannot smuggle a duplicate.';

create or replace function private.couranr_enforce_consumer_custody_sequence()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_level text;
  v_prepack_first timestamptz;
  v_sealed timestamptz;
  v_seal_applied timestamptz;
  v_consumed timestamptz;
begin
  if old.fulfillment_state <> 'at_pickup' or new.fulfillment_state <> 'picked_up' then
    return new;
  end if;

  v_level := private.couranr_delivery_protection_level(new.id);
  if v_level is null or v_level not in ('secure_pickup','protected_handoff') then
    return new;
  end if;

  -- 1. The ITEM, documented. EARLIEST, so several legitimate shots are fine but
  --    the first one still has to precede the sealing.
  select min(finalized_at) into v_prepack_first
    from public.couranr_delivery_proofs
   where delivery_id = new.id
     and proof_stage = 'pickup'
     and proof_type = 'item_prepack_photo';
  if v_prepack_first is null then
    raise exception 'item_prepack_photo_required' using errcode='CR409';
  end if;

  -- 3. The SEAL, and the photograph it is bound to. Read together because the
  --    bound proof is what makes the serial evidence rather than a typed string.
  select s.applied_at, p.finalized_at
    into v_seal_applied, v_sealed
    from public.couranr_delivery_security_seals s
    join public.couranr_delivery_proofs p on p.id = s.sealed_package_proof_id
   where s.delivery_id = new.id
   limit 1;

  if v_sealed is null then
    /* THREE DIFFERENT FAULTS REACH HERE and they need three different answers.
       Telling a driver "photograph the sealed package" when the photo already
       exists and it is the BINDING that is missing sends them to redo work that
       will not fix anything — and a driver who is told to do the wrong thing
       twice starts working around the app.

       couranr_record_delivery_seal always binds a proof, so an unbound seal
       means somebody reached the table directly. It is named plainly rather
       than folded into the photo message. */
    if exists (
      select 1 from public.couranr_delivery_security_seals
       where delivery_id = new.id and sealed_package_proof_id is null
    ) then
      raise exception 'security_seal_not_bound_to_photo' using errcode='CR409';
    end if;
    if not exists (
      select 1 from public.couranr_delivery_proofs
       where delivery_id = new.id and proof_stage = 'pickup'
         and proof_type = 'sealed_package_photo'
    ) then
      raise exception 'sealed_package_photo_required' using errcode='CR409';
    end if;
    raise exception 'security_seal_required' using errcode='CR409';
  end if;

  -- 2. THE ORDER THAT WAS UNPROVEN. A pre-pack photo taken after the package
  --    was sealed shows a sealed package, which is what the OTHER photo is for.
  if v_sealed <= v_prepack_first then
    raise exception 'prepack_photo_must_precede_sealing' using errcode='CR409';
  end if;

  -- 4. The seal is recorded once its photograph exists, never before it.
  if v_seal_applied < v_sealed then
    raise exception 'seal_recorded_before_sealed_photo' using errcode='CR409';
  end if;

  -- 5/6. The credential is LAST. It means "the documented and sealed shipment is
  --      what I am tendering", which is only true once there is one — so it is
  --      compared against the SEAL as well as the photographs. Comparing it to
  --      the photos alone let it be consumed before the seal was recorded.
  select max(consumed_at) into v_consumed
    from public.couranr_handoff_codes
   where delivery_id = new.id
     and code_kind = 'merchant_pickup'
     and code_state = 'consumed';
  if v_consumed is null then
    raise exception 'pickup_code_not_accepted' using errcode='CR409';
  end if;
  if v_consumed < v_prepack_first or v_consumed < v_sealed or v_consumed < v_seal_applied then
    raise exception 'pickup_credential_before_documentation' using errcode='CR409';
  end if;

  return new;
end
$fn$;

comment on function private.couranr_enforce_consumer_custody_sequence is
  'Secure Pickup custody SEQUENCE, not merely its parts: item photographed, '
  'then the package sealed and photographed, then the seal recorded against '
  'that photograph, then the sender credential consumed last. A direct API '
  'caller cannot satisfy it by uploading the same evidence out of order.';

revoke all on function private.couranr_enforce_consumer_custody_sequence()
  from public, anon, authenticated;

commit;
