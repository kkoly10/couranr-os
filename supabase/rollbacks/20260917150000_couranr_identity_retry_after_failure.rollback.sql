-- Reverts the identity retry allowance.
--
-- Safe for data: no row is destroyed. What it restores is the BUG — after this,
-- a recipient whose first verification attempt failed can never reach
-- `verified`, and their protected handoff is blocked permanently. Stripe's own
-- model reuses the same session for a retry, so this state is reachable in
-- ordinary use and not only through abuse. Run it only to unblock an incident,
-- and say that is what it does.

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
    if v_row.verification_state in ('verified','failed','unavailable') then
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
