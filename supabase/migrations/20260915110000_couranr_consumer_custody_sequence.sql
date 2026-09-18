-- Consumer Same Day V1 custody resequencing: what a SECURE pickup must contain,
-- and the order it must happen in.
--
-- Above $30.00 the sender's pickup credential stops meaning "a driver arrived"
-- and starts meaning "the documented and sealed shipment is the shipment I am
-- tendering". That sentence is only true if the credential is confirmed AFTER
-- the documentation, so ORDER is the substance of this migration, not a detail
-- of it. A prepack photo taken after the package was sealed proves nothing about
-- what is inside; a seal applied after the credential was consumed proves
-- nothing about what the sender handed over.
--
-- WHY A TRIGGER AND NOT AN EDIT TO couranr_complete_pickup_v2. That function
-- lives in 20260905190000 and is ~120 lines. Re-stating it here would make this
-- file the owner of a body it did not write, and would silently revert any
-- future edit to the original — the same hazard that kept the consent-evidence
-- rule out of couranr_derive_requester_scope. A trigger on the transition is
-- additive, cannot revert anything, and fires wherever the transition is made
-- rather than only where one function makes it.
--
-- UNGOVERNED DELIVERIES ARE UNTOUCHED. Every business delivery, and every
-- consumer delivery created before this policy, derives a null level and the
-- trigger returns immediately.

begin;

/* ─────────────── 1. the level, for a DELIVERY ─────────────────────────────
   The protection level is stored on the request; the driver flow works in
   deliveries. One function does the join so the trigger, the seal command and
   any later reader cannot each invent their own version of "is this secure". */
create or replace function private.couranr_delivery_protection_level(p_delivery_id uuid)
returns text
language sql
stable
security invoker
set search_path=''
as $fn$
  select r.protection_level
    from public.couranr_deliveries d
    join public.couranr_delivery_requests r on r.id = d.request_id
   where d.id = p_delivery_id
     -- Governed ONLY. A row with a level but no policy version is not something
     -- this policy wrote, and must not be held to rules it never saw.
     and r.protection_policy_version is not null;
$fn$;

revoke all on function private.couranr_delivery_protection_level(uuid)
  from public, anon, authenticated;

comment on function private.couranr_delivery_protection_level is
  'The governed protection level for a delivery, or null when the delivery is '
  'ungoverned (every business delivery, and every consumer delivery predating '
  'couranr-consumer-protection-v1).';

/* ─────────────── 2. the seal, recorded by the driver ──────────────────────── */

create or replace function public.couranr_record_delivery_seal(
  p_delivery_id uuid,
  p_actor_user_id uuid,
  p_seal_identifier text,
  p_sealed_package_proof_id uuid
)
returns public.couranr_delivery_security_seals
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_asg public.couranr_delivery_assignments;
  v_level text;
  v_proof public.couranr_delivery_proofs;
  v_seal public.couranr_delivery_security_seals;
begin
  -- The SAME authority check every other driver command uses: raises if this
  -- actor does not hold the live assignment for this delivery.
  v_asg := public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  v_level := private.couranr_delivery_protection_level(p_delivery_id);
  if v_level is null or v_level not in ('secure_pickup','protected_handoff') then
    -- Refused rather than ignored. A seal on a standard delivery would imply a
    -- custody ceremony the sender was never told about and never paid for.
    raise exception 'seal_not_required_for_delivery' using errcode='CR422';
  end if;

  if p_seal_identifier is null or btrim(p_seal_identifier)='' then
    raise exception 'seal_identifier_required' using errcode='CR422';
  end if;

  -- The seal must be VISIBLE in a photograph, and that photograph must belong to
  -- this delivery and this assignment. A seal recorded against someone else's
  -- proof, or against no proof, is a serial number typed into a box.
  select * into v_proof from public.couranr_delivery_proofs
   where id = p_sealed_package_proof_id;
  if not found
     or v_proof.delivery_id <> p_delivery_id
     or v_proof.assignment_id <> v_asg.id
     or v_proof.proof_stage <> 'pickup'
     or v_proof.proof_type <> 'sealed_package_photo' then
    raise exception 'sealed_package_photo_required' using errcode='CR422';
  end if;

  insert into public.couranr_delivery_security_seals
    (delivery_id, seal_identifier, applied_by_driver_id, sealed_package_proof_id)
  values
    (p_delivery_id, btrim(p_seal_identifier), v_asg.driver_id, p_sealed_package_proof_id)
  returning * into v_seal;

  return v_seal;
end
$fn$;

comment on function public.couranr_record_delivery_seal is
  'Records the tamper-evident seal a driver applied, bound to the sealed-package '
  'photograph it is visible in. Secure levels only; one seal per delivery, '
  'enforced by couranr_dss_one_seal_per_delivery_uniq.';

revoke all on function public.couranr_record_delivery_seal(uuid,uuid,text,uuid)
  from public,anon,authenticated;
grant execute on function public.couranr_record_delivery_seal(uuid,uuid,text,uuid)
  to service_role;

/* ─────────────── 3. the SEQUENCE, enforced at the transition ──────────────── */

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
  -- Only the pickup transition, and only for a delivery this policy governs.
  if old.fulfillment_state <> 'at_pickup' or new.fulfillment_state <> 'picked_up' then
    return new;
  end if;

  v_level := private.couranr_delivery_protection_level(new.id);
  if v_level is null or v_level not in ('secure_pickup','protected_handoff') then
    return new;
  end if;

  -- The item, before it went into the package.
  select max(finalized_at) into v_prepack
    from public.couranr_delivery_proofs
   where delivery_id = new.id
     and proof_stage = 'pickup'
     and proof_type = 'item_prepack_photo';
  if v_prepack is null then
    raise exception 'item_prepack_photo_required' using errcode='CR409';
  end if;

  -- The package, sealed.
  select max(finalized_at) into v_sealed
    from public.couranr_delivery_proofs
   where delivery_id = new.id
     and proof_stage = 'pickup'
     and proof_type = 'sealed_package_photo';
  if v_sealed is null then
    raise exception 'sealed_package_photo_required' using errcode='CR409';
  end if;

  -- The seal itself, bound to that photograph.
  select exists (
    select 1 from public.couranr_delivery_security_seals
     where delivery_id = new.id and sealed_package_proof_id is not null
  ) into v_seal_ok;
  if not v_seal_ok then
    raise exception 'security_seal_required' using errcode='CR409';
  end if;

  /* THE ORDER. couranr_complete_pickup_v2 already requires the credential to
     have been consumed; this requires it to have been consumed LAST. Without
     it, a driver could take the sender's code on arrival and photograph an
     unrelated item afterwards, and every individual requirement above would
     still be satisfied. The credential is what makes the sender's confirmation
     mean "this documented, sealed shipment" — and a confirmation given before
     the documentation existed cannot mean that. */
  select max(consumed_at) into v_consumed
    from public.couranr_handoff_codes
   where delivery_id = new.id
     and code_kind = 'merchant_pickup'
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

comment on function private.couranr_enforce_consumer_custody_sequence is
  'Above $30.00 the pickup credential means "the documented and sealed shipment '
  'is what I am tendering", which is only true when it is confirmed AFTER the '
  'documentation. Enforces both the contents and the ORDER at at_pickup -> '
  'picked_up. Ungoverned deliveries return immediately.';

revoke all on function private.couranr_enforce_consumer_custody_sequence()
  from public, anon, authenticated;

drop trigger if exists couranr_deliveries_consumer_custody_sequence on public.couranr_deliveries;
create trigger couranr_deliveries_consumer_custody_sequence
  before update on public.couranr_deliveries
  for each row execute function private.couranr_enforce_consumer_custody_sequence();

commit;
