-- Roll back the Consumer Same Day V1 Trust, Custody & Fraud substrate.
--
-- REFUSES ON EVIDENCE rather than destroying it, following the pattern
-- 20260905* established for the credit settlement rollback: once a real
-- shipment has been governed by this policy, dropping the columns would delete
-- the custody record a claim may depend on — the declared value a sender
-- represented, the seal a driver applied, the identity state a recipient
-- completed. That is not a rollback, it is evidence destruction.
--
-- So: if any governed row exists, this raises and requires roll-forward. If
-- none does — the only case where rollback is actually safe — it removes the
-- objects cleanly.
--
-- Re-runnable either way: every drop is `if exists`.

begin;

do $$
declare
  v_governed integer;
  v_seals integer;
  v_identity integer;
begin
  select count(*) into v_governed
  from public.couranr_delivery_requests
  where protection_policy_version is not null;

  select count(*) into v_seals from public.couranr_delivery_security_seals;
  select count(*) into v_identity from public.couranr_recipient_identity_verifications;

  if v_governed > 0 or v_seals > 0 or v_identity > 0 then
    raise exception using
      errcode = 'CR409',
      message = 'consumer_trust_custody_rollback_refused',
      detail = format(
        'governed requests: %s, seals: %s, identity verifications: %s',
        v_governed, v_seals, v_identity
      ),
      hint = 'Custody evidence exists for real shipments. Roll forward instead; '
             'dropping these objects would delete the record a claim depends on.';
  end if;
end $$;

-- Identity and seal tables first: both reference deliveries/proofs.
drop index if exists public.couranr_riv_one_live_per_delivery_uniq;
drop table if exists public.couranr_recipient_identity_verifications restrict;

drop index if exists public.couranr_dss_identifier_idx;
drop index if exists public.couranr_dss_one_seal_per_delivery_uniq;
drop table if exists public.couranr_delivery_security_seals restrict;

-- Restore the proof vocabulary to its pre-migration membership. BOTH
-- constraints, because both police this column and the forward migration
-- extends both.
alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_delivery_proofs_proof_type_check;
alter table public.couranr_delivery_proofs
  add constraint couranr_delivery_proofs_proof_type_check check (
    proof_type in (
      'shipment_photo','condition_photo','securement_photo','discrepancy_evidence',
      'delivery_photo','signature','recipient_pin','return_condition_photo'
    )
  );

alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_dp_type_chk;
alter table public.couranr_delivery_proofs
  add constraint couranr_dp_type_chk check (
    proof_type in (
      'shipment_photo','condition_photo','securement_photo','discrepancy_evidence',
      'delivery_photo','signature','recipient_pin','return_condition_photo'
    )
  );

drop trigger if exists couranr_dr_freeze_consent_evidence on public.couranr_delivery_requests;
drop function if exists private.couranr_freeze_consumer_consent_evidence() restrict;

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_recipient_attestation_chk,
  drop constraint if exists couranr_dr_consumer_email_first_chk,
  drop constraint if exists couranr_dr_consumer_acceptance_chk,
  drop constraint if exists couranr_dr_terms_evidence_chk,
  drop constraint if exists couranr_dr_protection_completeness_chk,
  drop constraint if exists couranr_dr_protection_derived_chk,
  drop constraint if exists couranr_dr_protection_level_chk,
  drop constraint if exists couranr_dr_declared_value_range_chk;

alter table public.couranr_delivery_requests
  drop column if exists recipient_adult_attested_at,
  drop column if exists sender_adult_attested_at,
  drop column if exists sender_electronic_consent_at,
  drop column if exists sender_terms_accepted_at,
  drop column if exists sender_terms_version,
  drop column if exists protection_policy_version,
  drop column if exists protection_level,
  drop column if exists declared_value_cents;

drop function if exists private.couranr_derive_protection_level(integer) restrict;

commit;
