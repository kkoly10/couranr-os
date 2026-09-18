-- Narrows the adult requirement back to protected handoff only.
--
-- Safe for data: no row is destroyed and every recorded attestation survives.
-- What it destroys is a RULE — after this, the recipient of a standard or
-- secure-pickup consumer delivery is no longer required to be 18, which is an
-- owner decision being reversed rather than a technical rollback. Run it only
-- to unblock an incident, and say so.
--
-- Both functions revert together for the same reason they advanced together: a
-- half-reverted pair either demands evidence nobody can supply, or accepts an
-- attestation the handoff never checks.

begin;

create or replace function public.couranr_attest_recipient_adult(
  p_token_hash text,
  p_attestation_version text,
  p_accept boolean
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_token public.couranr_delivery_access_tokens;
  v_request public.couranr_delivery_requests;
  v_delivery public.couranr_deliveries;
  v_version text := nullif(btrim(coalesce(p_attestation_version,'')),'');
begin
  if p_accept is not true then
    raise exception 'recipient_adult_attestation_required' using errcode='CR422';
  end if;
  if v_version is null then
    raise exception 'recipient_attestation_version_required' using errcode='CR422';
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'tracking_token_not_available' using errcode='CR404';
  end if;

  select t.* into v_token from public.couranr_delivery_access_tokens t
   where t.token_hash=p_token_hash for update;
  if not found or v_token.revoked_at is not null or v_token.expires_at<=now()
     or v_token.audience<>'recipient' then
    raise exception 'tracking_token_not_available' using errcode='CR404';
  end if;

  select r.* into v_request from public.couranr_delivery_requests r
   where r.id=v_token.request_id for update;
  if not found or v_request.requester_kind<>'consumer'
     or v_request.business_account_id is not null
     or v_request.protection_policy_version is null
     or v_request.protection_level<>'protected_handoff'
     or v_request.request_state<>'confirmed' then
    raise exception 'recipient_attestation_not_allowed' using errcode='CR409';
  end if;

  select d.* into v_delivery from public.couranr_deliveries d
   where d.request_id=v_request.id;
  if found and v_delivery.fulfillment_state in (
    'delivered','could_not_deliver','cancelled','return_required','returning','returned'
  ) then
    raise exception 'recipient_attestation_too_late' using errcode='CR409';
  end if;

  if v_request.recipient_adult_attested_at is not null then
    if v_request.recipient_attestation_version is distinct from v_version then
      raise exception 'recipient_attestation_already_recorded' using errcode='CR409';
    end if;
    return v_request;
  end if;

  update public.couranr_delivery_requests set
    recipient_attestation_version=v_version,
    recipient_adult_attested_at=now(),
    version=version+1,
    updated_at=now()
  where id=v_request.id
  returning * into v_request;

  update public.couranr_delivery_access_tokens
     set last_used_at=now() where id=v_token.id;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_request.id,null,'customer','record_recipient_adult_attestation',
    v_request.request_state,v_request.request_state,
    jsonb_build_object('attestationVersion',v_version,'audience','recipient')
  );
  return v_request;
end
$fn$;

create or replace function private.couranr_enforce_consumer_dropoff_custody()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_level text;
  v_condition text;
  v_request public.couranr_delivery_requests;
  v_identity public.couranr_recipient_identity_verifications;
begin
  if old.fulfillment_state<>'at_dropoff' or new.fulfillment_state<>'delivered' then
    return new;
  end if;

  v_level := private.couranr_delivery_protection_level(new.id);
  if v_level is null or v_level not in ('secure_pickup','protected_handoff') then
    return new;
  end if;
  if v_level='protected_handoff' and new.proof_method='leave_at_door' then
    raise exception 'protected_handoff_forbids_leave_at_door' using errcode='CR409';
  end if;

  select dropoff_condition into v_condition
    from public.couranr_delivery_security_seals where delivery_id=new.id;
  if v_condition is null then
    raise exception 'seal_condition_required_at_dropoff' using errcode='CR409';
  end if;

  if v_level='protected_handoff' then
    select r.* into v_request
      from public.couranr_delivery_requests r where r.id=new.request_id;
    if v_request.requester_kind='consumer'
       and v_request.recipient_adult_attested_at is null then
      raise exception 'recipient_adult_attestation_required' using errcode='CR409';
    end if;

    select r.* into v_identity
      from public.couranr_recipient_identity_verifications r
     where r.delivery_id=new.id and r.verification_state<>'canceled'
     limit 1;
    if not found then
      raise exception 'recipient_identity_verification_required' using errcode='CR409';
    end if;
    if v_identity.verification_state<>'verified'
       or not v_identity.identity_verified
       or not v_identity.adult_verified
       or not v_identity.authorized_recipient_match
       or v_identity.provider_reference is null then
      raise exception 'recipient_identity_not_verified' using errcode='CR409';
    end if;
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_enforce_consumer_dropoff_custody()
  from public, anon, authenticated;
revoke all on function public.couranr_attest_recipient_adult(text,text,boolean)
  from public,anon,authenticated;
grant execute on function public.couranr_attest_recipient_adult(text,text,boolean)
  to service_role;

commit;
