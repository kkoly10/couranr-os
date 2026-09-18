-- D (correction): a FAILED identity check must be retryable.
--
-- FORWARD-ONLY. 20260915130000 is applied in production, so it is not edited:
-- this replaces couranr_record_recipient_identity_verification by name.
--
-- FOUND BY READING STRIPE'S DOCUMENTATION, NOT MY OWN SCHEMA. Stripe Identity
-- has no `failed` status at all. Its VerificationSession statuses are exactly
-- `requires_input`, `processing`, `verified` and `canceled`; a check that does
-- not pass leaves the session in `requires_input` with `last_error` populated,
-- and Stripe's own guidance is to REUSE THAT SESSION for another attempt rather
-- than create a new one.
--
-- `failed` is therefore OUR word for an outcome the provider treats as
-- resumable. Treating it as terminal — which the applied version did — means a
-- recipient whose first photo was blurry, or whose document glared, could never
-- reach `verified`, and their protected handoff was blocked permanently by a
-- rule intended to stop fraud. A blurry photograph is not fraud.
--
-- `unavailable` was terminal for the same reason and wrong for a different one:
-- it records that Couranr never asked, which stops being true the moment the
-- provider is activated, possibly while a delivery is in flight.
--
-- WHAT STAYS TERMINAL: `verified`. A verification cannot be un-verified and
-- nothing may rewrite it to a different answer. `canceled` stays outside the
-- live row entirely, by couranr_riv_one_live_per_delivery_uniq.
--
-- The anti-gaming concern behind the original rule is real; its boundary was in
-- the wrong place. What must not be re-run is a SUCCESS, not a failure.
--
-- Source: https://docs.stripe.com/identity/how-sessions-work

begin;

create or replace function public.couranr_record_recipient_identity_verification(
  p_delivery_id uuid,
  p_state text,
  p_provider_reference text,
  p_identity_verified boolean,
  p_adult_verified boolean,
  p_authorized_recipient_match boolean,
  p_policy_version text
)
returns public.couranr_recipient_identity_verifications
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_level text;
  v_row public.couranr_recipient_identity_verifications;
  v_ref text := nullif(btrim(coalesce(p_provider_reference,'')),'');
  v_verified_at timestamptz;
begin
  v_level := private.couranr_delivery_protection_level(p_delivery_id);
  if v_level is distinct from 'protected_handoff' then
    raise exception 'identity_verification_not_required' using errcode='CR422';
  end if;
  if p_state is null
     or p_state not in ('pending','processing','verified','failed','unavailable','canceled') then
    raise exception 'identity_state_invalid' using errcode='CR422';
  end if;
  if p_policy_version is null or btrim(p_policy_version) = '' then
    raise exception 'identity_policy_version_required' using errcode='CR422';
  end if;
  if p_identity_verified is null or p_adult_verified is null
     or p_authorized_recipient_match is null then
    raise exception 'identity_flags_required' using errcode='CR422';
  end if;

  if p_state = 'verified' and (
       v_ref is null or p_identity_verified is not true
       or p_adult_verified is not true or p_authorized_recipient_match is not true
     ) then
    raise exception 'verified_identity_evidence_incomplete' using errcode='CR422';
  end if;
  if p_state in ('pending','processing') and (
       v_ref is null or p_identity_verified or p_adult_verified or p_authorized_recipient_match
     ) then
    raise exception 'identity_in_progress_evidence_invalid' using errcode='CR422';
  end if;
  if p_state = 'failed' and (
       v_ref is null
       or (p_identity_verified and p_adult_verified and p_authorized_recipient_match)
       or (not p_identity_verified and (p_adult_verified or p_authorized_recipient_match))
     ) then
    raise exception 'failed_identity_evidence_invalid' using errcode='CR422';
  end if;
  if p_state = 'unavailable' and (
       v_ref is not null or p_identity_verified or p_adult_verified or p_authorized_recipient_match
     ) then
    raise exception 'unavailable_identity_evidence_invalid' using errcode='CR422';
  end if;
  if p_state = 'canceled' and (
       p_identity_verified or p_adult_verified or p_authorized_recipient_match
     ) then
    raise exception 'canceled_identity_evidence_invalid' using errcode='CR422';
  end if;

  v_verified_at := case when p_state='verified' then now() end;

  select * into v_row
    from public.couranr_recipient_identity_verifications
   where delivery_id=p_delivery_id and verification_state<>'canceled'
   for update;

  if found then
    /* A terminal replay is idempotent only when it says exactly the same thing.
       Purged provider references are the sole exception: a later webhook may
       not rehydrate a reference Couranr deliberately removed. */
    if v_row.verification_state = 'verified' then
      if v_row.verification_state is distinct from p_state
         or v_row.identity_verified is distinct from p_identity_verified
         or v_row.adult_verified is distinct from p_adult_verified
         or v_row.authorized_recipient_match is distinct from p_authorized_recipient_match
         or v_row.policy_version is distinct from btrim(p_policy_version)
         or (v_row.provider_reference_purged_at is null
           and v_row.provider_reference is distinct from v_ref) then
        raise exception 'identity_verification_already_resolved' using errcode='CR409';
      end if;
      return v_row;
    end if;

    if v_row.policy_version is distinct from btrim(p_policy_version)
       or (v_row.provider_reference is not null and v_row.provider_reference is distinct from v_ref)
       or not (
         (v_row.verification_state='pending' and p_state in ('pending','processing','verified','failed','canceled'))
         or (v_row.verification_state='processing' and p_state in ('processing','verified','failed','canceled'))
         /* RETRY. Stripe has no `failed` status: a check that does not pass leaves
            the session in `requires_input` with last_error set, and the documented
            guidance is to reuse THAT SAME session for another attempt. `failed` is
            our word for an outcome the provider treats as resumable, and a
            recipient whose first photo was blurry must be able to reach verified. */
         or (v_row.verification_state='failed'
             and p_state in ('processing','verified','failed','canceled'))
         /* ACTIVATION. `unavailable` records that Couranr never asked, which stops
            being true the moment the provider is switched on — possibly while a
            delivery is already in flight. */
         or (v_row.verification_state='unavailable'
             and p_state in ('pending','processing','verified','failed','canceled'))
       ) then
      raise exception 'identity_verification_transition_invalid' using errcode='CR409';
    end if;

    update public.couranr_recipient_identity_verifications set
      provider_reference=coalesce(provider_reference,v_ref),
      identity_verified=p_identity_verified,
      adult_verified=p_adult_verified,
      authorized_recipient_match=p_authorized_recipient_match,
      verification_state=p_state,
      verified_at=v_verified_at,
      updated_at=now()
    where id=v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into public.couranr_recipient_identity_verifications(
    delivery_id,provider,provider_reference,identity_verified,adult_verified,
    authorized_recipient_match,verification_state,verified_at,policy_version
  ) values (
    p_delivery_id,'stripe_identity',v_ref,p_identity_verified,p_adult_verified,
    p_authorized_recipient_match,p_state,v_verified_at,btrim(p_policy_version)
  ) returning * into v_row;
  return v_row;
end
$fn$;

revoke all on function public.couranr_record_recipient_identity_verification(
  uuid,text,text,boolean,boolean,boolean,text)
  from public,anon,authenticated;
grant execute on function public.couranr_record_recipient_identity_verification(
  uuid,text,text,boolean,boolean,boolean,text)
  to service_role;

commit;
