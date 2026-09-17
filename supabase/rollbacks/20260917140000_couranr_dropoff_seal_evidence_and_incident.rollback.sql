-- Reverts the drop-off seal photograph and the automatic incident.
--
-- REFUSES ON EVIDENCE. Dropping dropoff_seal_proof_id would sever recorded
-- observations from the photographs they were made from, and narrowing the
-- incident vocabulary would orphan any seal_integrity row already opened. Both
-- are evidence a claim may depend on, so this refuses while either exists —
-- the same pattern 20260915090000 established.
--
-- If nothing has been recorded, the objects come out cleanly.

begin;

do $$
declare
  v_photos integer;
  v_incidents integer;
begin
  select count(*) into v_photos
    from public.couranr_delivery_security_seals
   where dropoff_seal_proof_id is not null;

  select count(*) into v_incidents
    from public.couranr_delivery_incidents
   where incident_type = 'seal_integrity';

  if v_photos > 0 or v_incidents > 0 then
    raise exception using
      errcode = 'CR409',
      message = 'dropoff_seal_evidence_rollback_refused',
      detail = format('bound drop-off seal photos: %s, seal_integrity incidents: %s',
                      v_photos, v_incidents),
      hint = 'Custody evidence exists. Roll forward instead; dropping these '
             'would sever an observation from the photograph it was made from.';
  end if;
end $$;

-- The command, back to its pre-photograph signature.
drop function if exists public.couranr_record_seal_condition(uuid,uuid,text,uuid) restrict;

create or replace function public.couranr_record_seal_condition(
  p_delivery_id uuid,
  p_actor_user_id uuid,
  p_condition text
)
returns public.couranr_delivery_security_seals
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_level text;
  v_seal public.couranr_delivery_security_seals;
begin
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);
  v_level := private.couranr_delivery_protection_level(p_delivery_id);
  if v_level is null or v_level not in ('secure_pickup','protected_handoff') then
    raise exception 'seal_not_required_for_delivery' using errcode='CR422';
  end if;
  if p_condition is null or p_condition not in ('intact','damaged','missing') then
    raise exception 'seal_condition_invalid' using errcode='CR422';
  end if;
  select * into v_seal from public.couranr_delivery_security_seals
   where delivery_id = p_delivery_id for update;
  if not found then
    raise exception 'security_seal_required' using errcode='CR409';
  end if;
  if v_seal.dropoff_condition is not null then
    raise exception 'seal_condition_already_recorded' using errcode='CR409';
  end if;
  update public.couranr_delivery_security_seals set
    dropoff_condition = p_condition,
    dropoff_recorded_at = now(),
    dropoff_recorded_by_driver_id = v_asg.driver_id,
    updated_at = now()
  where id = v_seal.id
  returning * into v_seal;
  return v_seal;
end
$fn$;

revoke all on function public.couranr_record_seal_condition(uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.couranr_record_seal_condition(uuid,uuid,text)
  to service_role;

alter table public.couranr_delivery_security_seals
  drop constraint if exists couranr_dss_dropoff_evidence_chk;
alter table public.couranr_delivery_security_seals
  drop column if exists dropoff_seal_proof_id;

alter table public.couranr_delivery_incidents
  drop constraint if exists couranr_di_type_chk;
alter table public.couranr_delivery_incidents
  add constraint couranr_di_type_chk check (incident_type in (
    'recipient_unavailable','address_access','weather_safety','damage',
    'wrong_item','missing_item','unsafe_handling','delivery_failure','other'
  ));

alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_delivery_proofs_proof_type_check;
alter table public.couranr_delivery_proofs
  add constraint couranr_delivery_proofs_proof_type_check check (
    proof_type in (
      'shipment_photo','condition_photo','securement_photo','discrepancy_evidence',
      'delivery_photo','signature','recipient_pin','return_condition_photo',
      'item_prepack_photo','sealed_package_photo'
    )
  );

alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_dp_type_chk;
alter table public.couranr_delivery_proofs
  add constraint couranr_dp_type_chk check (
    proof_type in (
      'shipment_photo','condition_photo','securement_photo','discrepancy_evidence',
      'delivery_photo','signature','recipient_pin','return_condition_photo',
      'item_prepack_photo','sealed_package_photo'
    )
  );

commit;
