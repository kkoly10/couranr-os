-- Reverts the ordering rules to the presence-only form and drops the seal
-- uniqueness index.
--
-- Safe: no data is destroyed. Every seal, proof and credential row survives;
-- this only relaxes what the transition checks and stops rejecting duplicate
-- serials. Rolling back therefore REOPENS finding G, which is a deliberate
-- statement rather than a footnote — run it only to unblock an incident.
--
-- Restores 20260915110000's function body verbatim, so the forward and back
-- states are both real rather than a half-way one nobody has run.

begin;

drop index if exists public.couranr_dss_identifier_unique_active;

create or replace function private.couranr_enforce_consumer_custody_sequence()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_level text;
  v_prepack timestamptz;
  v_sealed timestamptz;
  v_consumed timestamptz;
  v_seal_ok boolean;
begin
  if old.fulfillment_state <> 'at_pickup' or new.fulfillment_state <> 'picked_up' then
    return new;
  end if;

  v_level := private.couranr_delivery_protection_level(new.id);
  if v_level is null or v_level not in ('secure_pickup','protected_handoff') then
    return new;
  end if;

  select max(finalized_at) into v_prepack
    from public.couranr_delivery_proofs
   where delivery_id = new.id and proof_stage = 'pickup'
     and proof_type = 'item_prepack_photo';
  if v_prepack is null then
    raise exception 'item_prepack_photo_required' using errcode='CR409';
  end if;

  select max(finalized_at) into v_sealed
    from public.couranr_delivery_proofs
   where delivery_id = new.id and proof_stage = 'pickup'
     and proof_type = 'sealed_package_photo';
  if v_sealed is null then
    raise exception 'sealed_package_photo_required' using errcode='CR409';
  end if;

  select exists (
    select 1 from public.couranr_delivery_security_seals
     where delivery_id = new.id and sealed_package_proof_id is not null
  ) into v_seal_ok;
  if not v_seal_ok then
    raise exception 'security_seal_required' using errcode='CR409';
  end if;

  select max(consumed_at) into v_consumed
    from public.couranr_handoff_codes
   where delivery_id = new.id and code_kind = 'merchant_pickup'
     and code_state = 'consumed';
  if v_consumed is null then
    raise exception 'pickup_code_not_accepted' using errcode='CR409';
  end if;
  if v_consumed < v_prepack or v_consumed < v_sealed then
    raise exception 'pickup_credential_before_documentation' using errcode='CR409';
  end if;

  return new;
end
$fn$;

revoke all on function private.couranr_enforce_consumer_custody_sequence()
  from public, anon, authenticated;

commit;
