-- H + I: photograph the seal at handoff, and make a bad seal a real Operations
-- event instead of a field that disappears into an ordinary delivery.
--
-- FORWARD-ONLY. 20260915090000 and 20260915120000 are applied in production, so
-- neither is edited: columns are added, vocabularies extended, and
-- couranr_record_seal_condition is replaced by name.
--
-- ─────────────────────────────── H ──────────────────────────────────────────
-- The driver's word was the only record of what the seal looked like. A claim
-- six months later turns on exactly that observation, and "the driver said
-- intact" is not evidence of the same kind as a photograph of the seal.
--
-- ─────────────────────────────── I ──────────────────────────────────────────
-- Damaged and missing were recorded and then vanished into a normal delivery.
-- The incident is opened BY THE DATABASE, inside the same statement that records
-- the condition, so it cannot depend on a driver remembering to file one while
-- standing at a door — and it cannot be skipped by a driver who would rather not
-- explain it.
--
-- WHAT DOES NOT CHANGE: a damaged or missing seal still permits the handoff.
-- Blocking it would hand the one person holding the parcel a reason to report
-- 'intact', which is the opposite of what this is for. The incident is the
-- consequence; refusing the delivery is not.
--
-- AND NO MONEY MOVES. Opening an incident records a fact. Resolution is an
-- Operations decision with its own command, and nothing here pays anyone.

begin;

/* ── H: the photograph ─────────────────────────────────────────────────────── */

-- BOTH constraints that police proof_type. Extending one is extending none —
-- that defect cost this batch a whole stage, and couranr_dp_type_chk is the one
-- that gets forgotten because it was added later than the table.
alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_delivery_proofs_proof_type_check;
alter table public.couranr_delivery_proofs
  add constraint couranr_delivery_proofs_proof_type_check check (
    proof_type in (
      'shipment_photo','condition_photo','securement_photo','discrepancy_evidence',
      'delivery_photo','signature','recipient_pin','return_condition_photo',
      'item_prepack_photo','sealed_package_photo','dropoff_seal_photo'
    )
  );

alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_dp_type_chk;
alter table public.couranr_delivery_proofs
  add constraint couranr_dp_type_chk check (
    proof_type in (
      'shipment_photo','condition_photo','securement_photo','discrepancy_evidence',
      'delivery_photo','signature','recipient_pin','return_condition_photo',
      'item_prepack_photo','sealed_package_photo','dropoff_seal_photo'
    )
  );

alter table public.couranr_delivery_security_seals
  add column if not exists dropoff_seal_proof_id uuid
    references public.couranr_delivery_proofs(id) on update cascade on delete restrict;

comment on column public.couranr_delivery_security_seals.dropoff_seal_proof_id is
  'The photograph the drop-off condition was observed from. Bound so the '
  'observation and its evidence cannot drift apart.';

-- The observation and its photograph are all-or-nothing, the same both-or-
-- neither shape the terms evidence follows: a condition with no photo is a
-- claim, and a photo with no condition is an unread picture.
alter table public.couranr_delivery_security_seals
  drop constraint if exists couranr_dss_dropoff_evidence_chk;
alter table public.couranr_delivery_security_seals
  add constraint couranr_dss_dropoff_evidence_chk check (
    dropoff_seal_proof_id is null
    or (dropoff_condition is not null and dropoff_recorded_at is not null)
  );

/* ── I: the incident vocabulary ────────────────────────────────────────────── */

-- A new type rather than reusing 'damage'. A broken seal is not damaged
-- merchandise, and an investigator filtering for damage claims should not have
-- to read every row to find out which is which.
alter table public.couranr_delivery_incidents
  drop constraint if exists couranr_di_type_chk;
alter table public.couranr_delivery_incidents
  add constraint couranr_di_type_chk check (incident_type in (
    'recipient_unavailable','address_access','weather_safety','damage',
    'wrong_item','missing_item','unsafe_handling','delivery_failure','other',
    'seal_integrity'
  ));

/* ── the command, replaced by name ─────────────────────────────────────────── */

/* THE OLD SIGNATURE IS DROPPED, not left beside the new one. Adding a
   parameter creates a SECOND overload, and PostgreSQL resolves an exact 3-argument
   call to the OLD function — which has no photograph requirement. Leaving both
   would mean the rule this migration adds could be bypassed by calling the
   function the way every existing caller already does, which is the least
   visible kind of hole. `restrict` so a dependency surfaces rather than
   cascading. */
drop function if exists public.couranr_record_seal_condition(uuid,uuid,text) restrict;

create or replace function public.couranr_record_seal_condition(
  p_delivery_id uuid,
  p_actor_user_id uuid,
  p_condition text,
  p_dropoff_seal_proof_id uuid
)
returns public.couranr_delivery_security_seals
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_level text;
  v_seal public.couranr_delivery_security_seals;
  v_proof public.couranr_delivery_proofs;
  v_incident uuid;
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
   where delivery_id = p_delivery_id
   for update;
  if not found then
    raise exception 'security_seal_required' using errcode='CR409';
  end if;

  if v_seal.dropoff_condition is not null then
    raise exception 'seal_condition_already_recorded' using errcode='CR409';
  end if;

  /* H — the photograph is REQUIRED, and must belong to this delivery and this
     assignment. A condition recorded against someone else's photo, or none at
     all, is the driver's word wearing a photograph's clothes. */
  if p_dropoff_seal_proof_id is null then
    raise exception 'dropoff_seal_photo_required' using errcode='CR422';
  end if;
  select * into v_proof from public.couranr_delivery_proofs
   where id = p_dropoff_seal_proof_id;
  if not found
     or v_proof.delivery_id <> p_delivery_id
     or v_proof.assignment_id <> v_asg.id
     or v_proof.proof_stage <> 'dropoff'
     or v_proof.proof_type <> 'dropoff_seal_photo' then
    raise exception 'dropoff_seal_photo_required' using errcode='CR422';
  end if;

  update public.couranr_delivery_security_seals set
    dropoff_condition = p_condition,
    dropoff_recorded_at = now(),
    dropoff_recorded_by_driver_id = v_asg.driver_id,
    dropoff_seal_proof_id = p_dropoff_seal_proof_id,
    updated_at = now()
  where id = v_seal.id
  returning * into v_seal;

  /* I — the incident opens HERE, in the same statement, so it cannot depend on
     a driver remembering to file one at a doorstep and cannot be skipped by one
     who would rather not explain it. `opened_by` is the driver who made the
     observation: the system filed it, they reported it, and both are true. */
  if p_condition in ('damaged','missing') then
    insert into public.couranr_delivery_incidents
      (request_id, delivery_id, incident_type, incident_state, severity,
       summary, opened_by)
    /* 'urgent', not an invented level. couranr_di_severity_chk is a closed
              two-value vocabulary and a tampered seal is the case it exists for —
              extending it here would be inventing a scale for one incident type. */
           select d.request_id, d.id, 'seal_integrity', 'reported', 'urgent',
           format('Security seal %s recorded as %s at drop-off.',
                  v_seal.seal_identifier, p_condition),
           p_actor_user_id
      from public.couranr_deliveries d
     where d.id = p_delivery_id
    returning id into v_incident;

    /* This table has no actor_type column — the actor is a user id and the
       command says what happened. Matched to the real shape rather than the
       shape couranr_delivery_request_events happens to have. */
    insert into public.couranr_delivery_incident_events
      (incident_id, actor_user_id, command, from_state, to_state, metadata)
    values (
      -- 'open_incident' is the verb couranr_die_command_chk already declares.
      -- Inventing 'open_delivery_incident' would have meant extending a closed
      -- vocabulary to say something it already says.
      v_incident, p_actor_user_id, 'open_incident',
      null, 'reported',
      jsonb_build_object(
        'source','seal_condition_at_dropoff',
        'sealId', v_seal.id,
        'sealIdentifier', v_seal.seal_identifier,
        'dropoffCondition', p_condition,
        'dropoffSealProofId', p_dropoff_seal_proof_id,
        'protectionLevel', v_level
      )
    );
  end if;

  return v_seal;
end
$fn$;

comment on function public.couranr_record_seal_condition is
  'The driver''s one observation of the seal at handoff, bound to a photograph '
  'of it. Damaged or missing opens a seal_integrity incident automatically in '
  'the same statement — it still permits the handoff, because blocking it would '
  'give the one person holding the parcel a reason to report ''intact''.';

revoke all on function public.couranr_record_seal_condition(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.couranr_record_seal_condition(uuid,uuid,text,uuid)
  to service_role;

commit;
