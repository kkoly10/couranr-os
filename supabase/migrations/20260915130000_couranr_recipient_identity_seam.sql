-- Consumer Same Day V1: the recipient identity SEAM.
--
-- Stripe Identity is NOT activated in V1. This migration exists so that when it
-- is, nothing about the shape of the record changes — and so that until then,
-- the fact that Couranr did not verify the recipient is WRITTEN DOWN rather
-- than left as an absence somebody later reads as "it must have been fine".
--
-- 'unavailable' is already in couranr_riv_state_chk's vocabulary. That was not
-- an accident of stage 2: a protected handoff that proceeded on the recipient
-- code alone is a different fact from one that passed an identity check, and a
-- claim six months later has to be able to tell them apart.
--
-- THE PROVIDER REFERENCE IS NOT A CREDENTIAL. It is Stripe's own handle for a
-- verification session and resolves to nothing for anyone holding this row
-- alone. It is nullable precisely because the mocked path has none.

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
  v_verified_at timestamptz;
begin
  v_level := private.couranr_delivery_protection_level(p_delivery_id);
  if v_level is distinct from 'protected_handoff' then
    -- Refused rather than stored. An identity record on a delivery that never
    -- required one implies a check the sender was not told about and did not
    -- consent to, and it would sit in the evidence bundle as if it mattered.
    raise exception 'identity_verification_not_required' using errcode='CR422';
  end if;

  if p_state is null
     or p_state not in ('pending','processing','verified','failed','unavailable','canceled') then
    raise exception 'identity_state_invalid' using errcode='CR422';
  end if;

  if p_policy_version is null or btrim(p_policy_version) = '' then
    raise exception 'identity_policy_version_required' using errcode='CR422';
  end if;

  -- couranr_riv_verified_pair_chk: a verified row says WHEN, and an unverified
  -- one must not claim a moment. The server stamps it; no caller supplies it.
  v_verified_at := case when p_state = 'verified' then now() end;

  /* One LIVE verification per delivery (couranr_riv_one_live_per_delivery_uniq,
     partial on state <> 'canceled'). A retry updates the live row rather than
     stacking a second one, so the history of a delivery is one identity story
     and not a pile of attempts a reader has to rank. */
  select * into v_row
    from public.couranr_recipient_identity_verifications
   where delivery_id = p_delivery_id and verification_state <> 'canceled'
   for update;

  if found then
    /* A RESOLVED verification is final. Without this, a failed check could be
       re-run until it passed, which is not verification — it is retrying until
       the answer is convenient. Re-recording the SAME state is allowed so a
       webhook or a retry is idempotent. */
    if v_row.verification_state in ('verified','failed','unavailable')
       and v_row.verification_state is distinct from p_state then
      raise exception 'identity_verification_already_resolved' using errcode='CR409';
    end if;

    update public.couranr_recipient_identity_verifications set
      provider_reference = coalesce(p_provider_reference, provider_reference),
      identity_verified = p_identity_verified,
      adult_verified = p_adult_verified,
      authorized_recipient_match = p_authorized_recipient_match,
      verification_state = p_state,
      verified_at = v_verified_at,
      policy_version = p_policy_version,
      updated_at = now()
    where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  insert into public.couranr_recipient_identity_verifications
    (delivery_id, provider, provider_reference, identity_verified, adult_verified,
     authorized_recipient_match, verification_state, verified_at, policy_version)
  values
    (p_delivery_id, 'stripe_identity', p_provider_reference, p_identity_verified,
     p_adult_verified, p_authorized_recipient_match, p_state, v_verified_at, p_policy_version)
  returning * into v_row;

  return v_row;
end
$fn$;

comment on function public.couranr_record_recipient_identity_verification is
  'Records the outcome of a recipient identity attempt for a protected handoff. '
  'One live row per delivery; a resolved outcome cannot be re-run to a different '
  'one. Stripe Identity is not activated in V1, so the seam records '
  '''unavailable'' — which is a different recorded fact from ''verified'', not '
  'the same thing with a gap in it.';

revoke all on function public.couranr_record_recipient_identity_verification(
  uuid,text,text,boolean,boolean,boolean,text)
  from public,anon,authenticated;
grant execute on function public.couranr_record_recipient_identity_verification(
  uuid,text,text,boolean,boolean,boolean,text)
  to service_role;

commit;
