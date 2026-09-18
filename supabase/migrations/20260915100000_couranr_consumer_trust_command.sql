-- The governed command that records the Consumer Same Day trust facts.
--
-- WHY A COMMAND AND NOT EIGHT MORE PARAMETERS. The create RPC already takes 36
-- arguments and the estimate RPC 30-odd. Threading declared value, protection
-- level, policy version and four consent timestamps through either of them
-- would mean every caller restating facts it has no business knowing — and the
-- protection LEVEL is derived, so a parameter for it is a parameter a client
-- could eventually be allowed to set. One narrow command that takes the
-- sender's statement and derives everything else keeps that impossible.
--
-- WHAT IT REFUSES, and why each refusal is here rather than only in TypeScript:
-- the server module is the first gate and this is the last one. A future route,
-- a script, or a repaired session that reached the RPC directly meets the same
-- rules, because the rules live with the data.
--
-- DRAFT ONLY. This records a statement not yet tendered. Once the request
-- leaves draft, couranr_dr_freeze_consent_evidence owns these columns and they
-- are append-only — so this command cannot be used to rewrite what a sender
-- represented after the fact, which is exactly the property a later claim
-- depends on.

begin;

/* The event vocabulary is CLOSED, and this command needs a word in it.
   Extending it is a deliberate act rather than a convenience: an open
   vocabulary would let any future writer invent a verb, and the queue, the
   claims bundle and Operations all read these words.

   Found by CALLING the command, not by reading it. couranr_dre_command_chk
   fires only on INSERT, so it is invisible to every text assertion, every
   typecheck and the migration applying cleanly — the same class as the foreign
   key that made Delivery Help redemption fail for its whole life behind 1230
   green tests.

   Re-stated in full rather than patched, because `in (...)` cannot be appended
   to; the list below is 20260905040000's plus one. */
alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft',
    'create_hosted_delivery_request',
    'calculate_delivery_request_estimate',
    'create_quote_version',
    'submit_delivery_request',
    'validate_hosted_delivery_request',
    'begin_delivery_request_review',
    'accept_delivery_request_as_quoted',
    'auto_accept_delivery_request',
    'auto_plan_delivery_request',
    'requote_delivery_request',
    'decline_delivery_request',
    'record_payer_quote_approval',
    'begin_delivery_preparation',
    'mark_delivery_ready',
    'mark_delivery_not_ready',
    'mark_delivery_unavailable',
    'cancel_delivery_request',
    'apply_promotional_credit',
    'record_consumer_trust'
  ));

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
  -- The guest session is the authority boundary, exactly as it is for
  -- couranr_set_consumer_pickup_readiness: the caller names a SESSION, never a
  -- request id, so no browser can address another sender's delivery.
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

  -- THE LEVEL IS DERIVED, never accepted. The same function
  -- couranr_dr_protection_derived_chk re-checks the stored row against, so the
  -- write and the constraint cannot disagree by construction.
  v_level := private.couranr_derive_protection_level(p_declared_value_cents);
  if v_level is null or v_level='declined' then
    raise exception 'declared_value_invalid' using errcode='CR422';
  end if;

  -- Booleans, and each refusal names WHICH acknowledgement is missing. A
  -- generic "acceptance required" would leave the sender hunting.
  if p_accept_shipment_certification is not true then
    raise exception 'shipment_certification_required' using errcode='CR422';
  end if;
  if p_accept_electronic_transactions is not true then
    raise exception 'electronic_consent_required' using errcode='CR422';
  end if;
  if p_terms_version is null or btrim(p_terms_version)='' then
    raise exception 'terms_version_required' using errcode='CR422';
  end if;

  /* coalesce, not assignment, on every timestamp: if the sender revises the
     draft and re-accepts, the moment recorded stays the FIRST moment they
     accepted this version of the document. A later moment would be a more
     flattering record of the same event, which is not what evidence is for.
     The document version itself is overwritten deliberately — re-accepting
     against a NEW version is a new acceptance, and the both-or-neither rule
     couranr_dr_terms_evidence_chk keeps version and timestamp together. */
  update public.couranr_delivery_requests set
    declared_value_cents=p_declared_value_cents,
    protection_level=v_level,
    protection_policy_version='couranr-consumer-protection-v1-2026-09-14',
    sender_terms_version=p_terms_version,
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
      -- The AMOUNT is recorded; the acknowledgement text is not. The version
      -- says what was agreed to and the document says what it means.
      'source','consumer_send',
      'guestSessionScoped',true
    )
  );

  return v_req;
end
$fn$;

comment on function public.couranr_record_consumer_trust is
  'Records the Consumer Same Day sender statement: declared value, the DERIVED '
  'protection level, the policy version, and the consent evidence. Draft only — '
  'once tendered, couranr_dr_freeze_consent_evidence makes these append-only.';

revoke all on function public.couranr_record_consumer_trust(uuid,integer,text,boolean,boolean)
  from public,anon,authenticated;
grant execute on function public.couranr_record_consumer_trust(uuid,integer,text,boolean,boolean)
  to service_role;

commit;
