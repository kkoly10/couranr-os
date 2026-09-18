-- E (completion): record the policy the clickwrap now says the sender accepted.
--
-- THE GAP THIS CLOSES. The sender's acknowledgement reads "I agree to Couranr's
-- Same Day Shipment Terms and Prohibited and Restricted Items Policy", and the
-- row records the terms version only. Half of a stated agreement was being
-- asserted to the customer and not kept — which is the same defect finding E
-- named, one document further along: the evidence must correspond to what was
-- actually presented.
--
-- SERVER-STATED, NOT A NEW PARAMETER. The version is stamped by the command
-- exactly as protection_policy_version is, rather than accepted from the
-- browser. That is the rule the whole consumer trust surface already follows —
-- a sender cannot claim to have accepted a version they were not shown — and it
-- has a second benefit worth naming: adding a parameter would have created a
-- SECOND function of this name, and PostgreSQL resolves an exact five-argument
-- call to the OLD one. That overload trap has already cost this batch once, on
-- couranr_record_seal_condition. Not creating it is better than dropping it.
--
-- NO NEW CHECK CONSTRAINT, deliberately. A rule like "terms version implies
-- prohibited-items version" would be true of every row this command writes from
-- now on and FALSE of any governed row already written, and a constraint that
-- invalidates existing data is not a correction. Going forward the command is
-- the only writer, and the freeze trigger below makes the value append-only —
-- which is the property that actually matters for evidence.
--
-- FORWARD-ONLY. 20260915090000 and 20260915100000 are applied in production and
-- are not edited; both objects are replaced by name.

begin;

alter table public.couranr_delivery_requests
  add column if not exists sender_prohibited_items_version text;

comment on column public.couranr_delivery_requests.sender_prohibited_items_version is
  'The Prohibited and Restricted Items Policy version the sender was shown and '
  'accepted. Server-stated, never accepted from a request body. Null on rows '
  'written before this policy was cited in the clickwrap.';

/* The freeze, extended. Reproduced in full rather than patched, because it is a
   function body: every existing arm is byte-identical to 20260915090000 and one
   arm is added. */
create or replace function private.couranr_freeze_consumer_consent_evidence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  /* A DRAFT is still being composed — see 20260915090000 for why freezing from
     the first write both refused honest edits and masked
     couranr_dr_declared_value_range_chk. */
  if old.request_state = 'draft' then
    return new;
  end if;

  if old.sender_terms_version is not null
     and new.sender_terms_version is distinct from old.sender_terms_version then
    raise exception 'consumer_consent_evidence_is_append_only' using errcode = 'CR409',
      detail = 'sender_terms_version';
  end if;
  if old.sender_prohibited_items_version is not null
     and new.sender_prohibited_items_version is distinct from old.sender_prohibited_items_version then
    raise exception 'consumer_consent_evidence_is_append_only' using errcode = 'CR409',
      detail = 'sender_prohibited_items_version';
  end if;
  if old.sender_terms_accepted_at is not null
     and new.sender_terms_accepted_at is distinct from old.sender_terms_accepted_at then
    raise exception 'consumer_consent_evidence_is_append_only' using errcode = 'CR409',
      detail = 'sender_terms_accepted_at';
  end if;
  if old.sender_electronic_consent_at is not null
     and new.sender_electronic_consent_at is distinct from old.sender_electronic_consent_at then
    raise exception 'consumer_consent_evidence_is_append_only' using errcode = 'CR409',
      detail = 'sender_electronic_consent_at';
  end if;
  if old.sender_adult_attested_at is not null
     and new.sender_adult_attested_at is distinct from old.sender_adult_attested_at then
    raise exception 'consumer_consent_evidence_is_append_only' using errcode = 'CR409',
      detail = 'sender_adult_attested_at';
  end if;
  if old.recipient_adult_attested_at is not null
     and new.recipient_adult_attested_at is distinct from old.recipient_adult_attested_at then
    raise exception 'consumer_consent_evidence_is_append_only' using errcode = 'CR409',
      detail = 'recipient_adult_attested_at';
  end if;
  if old.declared_value_cents is not null
     and new.declared_value_cents is distinct from old.declared_value_cents then
    raise exception 'consumer_consent_evidence_is_append_only' using errcode = 'CR409',
      detail = 'declared_value_cents';
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_freeze_consumer_consent_evidence()
  from public, anon, authenticated;

/* The command, with the SAME five-argument signature — see the header note on
   why this is not a new parameter. Reproduced in full from 20260915100000 with
   one added assignment and one added metadata key. */
create or replace function public.couranr_record_consumer_trust(
  p_guest_session_id uuid,
  p_declared_value_cents integer,
  p_terms_version text,
  p_accept_shipment_certification boolean,
  p_accept_electronic_transactions boolean
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_consumer_guest_sessions;
  v_req public.couranr_delivery_requests;
  v_level text;
  v_now timestamptz := now();
begin
  select * into v_session
    from public.couranr_consumer_guest_sessions
   where id=p_guest_session_id
   for update;
  if not found
     or v_session.revoked_at is not null
     or v_session.expires_at<=now()
     or v_session.request_id is null then
    raise exception 'guest_session_not_available' using errcode='CR404';
  end if;

  select * into v_req
    from public.couranr_delivery_requests
   where id=v_session.request_id
     and requester_kind='consumer'
     and business_account_id is null
     and idempotency_scope='consumer:'||v_session.id::text
   for update;
  if not found then
    raise exception 'request_not_found' using errcode='CR404';
  end if;

  if v_req.request_state<>'draft' then
    raise exception 'consumer_trust_already_tendered' using errcode='CR409';
  end if;

  v_level := private.couranr_derive_protection_level(p_declared_value_cents);
  if v_level is null or v_level='declined' then
    raise exception 'declared_value_invalid' using errcode='CR422';
  end if;

  if p_accept_shipment_certification is not true then
    raise exception 'shipment_certification_required' using errcode='CR422';
  end if;
  if p_accept_electronic_transactions is not true then
    raise exception 'electronic_consent_required' using errcode='CR422';
  end if;
  if p_terms_version is null or btrim(p_terms_version)='' then
    raise exception 'terms_version_required' using errcode='CR422';
  end if;

  update public.couranr_delivery_requests set
    declared_value_cents=p_declared_value_cents,
    protection_level=v_level,
    protection_policy_version='couranr-consumer-protection-v1-2026-09-14',
    sender_terms_version=p_terms_version,
    /* The shipment certification names BOTH documents, so accepting it accepts
       both. Stamped from the server's own statement of the version. */
    sender_prohibited_items_version='couranr-prohibited-items-policy-draft-2026-09',
    sender_terms_accepted_at=coalesce(sender_terms_accepted_at,v_now),
    sender_electronic_consent_at=coalesce(sender_electronic_consent_at,v_now),
    sender_adult_attested_at=coalesce(sender_adult_attested_at,v_now),
    version=version+1,
    updated_at=v_now
  where id=v_req.id
  returning * into v_req;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'customer','record_consumer_trust',
    v_req.request_state,v_req.request_state,
    jsonb_build_object(
      'declaredValueCents',p_declared_value_cents,
      'protectionLevel',v_level,
      'protectionPolicyVersion',v_req.protection_policy_version,
      'senderTermsVersion',p_terms_version,
      'senderProhibitedItemsVersion',v_req.sender_prohibited_items_version,
      'source','consumer_send',
      'guestSessionScoped',true
    )
  );

  return v_req;
end
$fn$;

revoke all on function public.couranr_record_consumer_trust(uuid,integer,text,boolean,boolean)
  from public,anon,authenticated;
grant execute on function public.couranr_record_consumer_trust(uuid,integer,text,boolean,boolean)
  to service_role;

commit;
