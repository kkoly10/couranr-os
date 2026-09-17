-- B: the recipient drop-off PIN, end to end, for a consumer shipment.
--
-- WHAT WAS ACTUALLY MISSING. The `recipient_dropoff` credential has existed
-- since 20260802030000 and the driver has always been able to verify one. What
-- no consumer shipment could do is ISSUE one. Both issuing routes require an
-- authenticated actor — Couranr Operations, or a merchant — and a consumer
-- shipment has neither. The recipient is a guest holding a tracking link.
--
-- `couranr_hc_issuer_xor_chk` is why, and it is worth stating precisely because
-- it is the kind of constraint that looks like a formality:
--
--     check ((issued_by is null) <> (issued_by_guest_session_id is null))
--
-- Exactly one of TWO issuers. A row attributed to a tracking token has both of
-- those null, so `true <> true` is false and the INSERT is refused. Adding a
-- third column BESIDE this constraint would change nothing — the old rule would
-- still reject every row the new column exists to carry. It has to be replaced,
-- which is the same lesson `couranr_dp_type_chk` taught at cost: when two rules
-- police one column, satisfying one of them is satisfying none.
--
-- So this migration replaces the two-armed XOR with an exactly-one-of-three
-- count. Every existing row has exactly one issuer, so the new constraint
-- validates against live data without a backfill.
--
-- WHY THE RECIPIENT ISSUES IT TO THEMSELVES. The PIN is the recipient's half of
-- the handoff: the driver asks for it and the recipient reads it back. It is
-- therefore minted into the recipient's own browser, from their own tracking
-- link, and it is NEVER sent by email. An emailed PIN is a PIN in the mailbox of
-- whoever else can read that mailbox, and it would reduce the credential to
-- exactly the assurance the tracking link already carries. The link proves
-- control of the address; the PIN is meant to prove presence at the door.
--
-- FORWARD-ONLY. 20260905190000 is applied in production and is not edited.

begin;

/* --------------------------------------------------- the third issuer ---- */

alter table public.couranr_handoff_codes
  add column if not exists issued_by_access_token_id uuid
    references public.couranr_delivery_access_tokens(id)
    on update cascade on delete restrict;

comment on column public.couranr_handoff_codes.issued_by_access_token_id is
  'The recipient tracking token that minted this credential. Set only for a '
  'consumer recipient_dropoff PIN, where there is no authenticated issuer and '
  'no guest session — the recipient is a guest holding a tracking link.';

/* Replaced, not supplemented: the old rule rejects every row the new column
   exists to carry, so leaving it in place would make this migration inert. */
alter table public.couranr_handoff_codes
  drop constraint if exists couranr_hc_issuer_xor_chk;

alter table public.couranr_handoff_codes
  add constraint couranr_hc_issuer_xor_chk check (
    (case when issued_by is not null then 1 else 0 end)
    + (case when issued_by_guest_session_id is not null then 1 else 0 end)
    + (case when issued_by_access_token_id is not null then 1 else 0 end)
    = 1
  );

/* A tracking token may only ever attribute a RECIPIENT credential. Without this
   the new arm would be a second way to mint a merchant_pickup code, which is
   the sender's credential and must never be issuable by the recipient. */
alter table public.couranr_handoff_codes
  drop constraint if exists couranr_hc_token_issuer_kind_chk;

alter table public.couranr_handoff_codes
  add constraint couranr_hc_token_issuer_kind_chk check (
    issued_by_access_token_id is null or code_kind = 'recipient_dropoff'
  );

/* ------------------------------------------------------------ command ---- */

/*
 * Mint the recipient's drop-off PIN from their tracking link.
 *
 * THE EXPECTED GENERATION IS NOT CEREMONY. An earlier draft of this function
 * omitted it, reasoning that the recipient's page displays no generation and so
 * has nothing to be stale about. That reasoning was wrong, and reading the
 * existing caller is what showed it: the generation is inside the SIGNED DIGEST
 * — `recipient:v1:<delivery>:<generation>:<code>` — precisely so that
 * regenerating a code cannot produce the same digest for the same six digits.
 * The caller must therefore know the generation BEFORE it hashes, and the only
 * safe way to reconcile that with a generation the database assigns is to have
 * the caller propose one and the database refuse a stale proposal. Without the
 * CAS, a lost race stores a digest signed for generation N against a row
 * numbered N+1, and the recipient's PIN would simply never verify.
 *
 * The raw PIN never reaches PostgreSQL. The caller hashes it and passes a
 * digest, which couranr_hc_digest_shape_chk refuses unless it is 64 lower-case
 * hex — a six-digit string cannot satisfy that.
 */
create or replace function public.couranr_issue_recipient_dropoff_code(
  p_token_hash text,
  p_expected_generation integer,
  p_code_digest text,
  p_ttl_minutes integer
)
returns public.couranr_handoff_codes
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_token public.couranr_delivery_access_tokens;
  v_request public.couranr_delivery_requests;
  v_dlv public.couranr_deliveries;
  v_gen integer;
  v_recent timestamptz;
  v_row public.couranr_handoff_codes;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'tracking_token_not_available' using errcode='CR404';
  end if;
  if p_expected_generation is null or p_expected_generation < 1 then
    raise exception 'handoff_generation_conflict' using errcode='CR409';
  end if;
  if p_code_digest is null or p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'recipient_code_digest_required' using errcode='CR400';
  end if;

  select t.* into v_token from public.couranr_delivery_access_tokens t
   where t.token_hash=p_token_hash for update;
  if not found or v_token.revoked_at is not null or v_token.expires_at<=now()
     or v_token.audience<>'recipient' then
    raise exception 'tracking_token_not_available' using errcode='CR404';
  end if;

  select r.* into v_request from public.couranr_delivery_requests r
   where r.id=v_token.request_id;
  if not found or v_request.requester_kind<>'consumer'
     or v_request.business_account_id is not null
     or v_request.protection_policy_version is null
     or v_request.request_state<>'confirmed' then
    raise exception 'recipient_code_not_allowed' using errcode='CR409';
  end if;

  /* Serializes two concurrent clicks. Everything below reads and writes the
     handoff codes for THIS delivery and nothing else. */
  select d.* into v_dlv from public.couranr_deliveries d
   where d.request_id=v_request.id for update;
  if not found then
    raise exception 'recipient_code_not_allowed' using errcode='CR409';
  end if;
  if v_dlv.fulfillment_state in (
    'delivered','could_not_deliver','cancelled','return_required','returning','returned'
  ) then
    raise exception 'recipient_code_too_late' using errcode='CR409';
  end if;

  /* A recipient page that re-mints on every render would churn the credential
     and defeat the supersede trail. Thirty seconds is long enough to stop that
     and short enough that a recipient who genuinely needs a fresh PIN at the
     door is not left waiting. */
  select max(issued_at) into v_recent
    from public.couranr_handoff_codes
   where delivery_id=v_dlv.id
     and code_kind='recipient_dropoff'
     and code_state='active';
  if v_recent is not null and v_recent > now()-interval '30 seconds' then
    raise exception 'recipient_code_reissued_too_soon' using errcode='CR429';
  end if;

  select coalesce(max(generation),0)+1 into v_gen
    from public.couranr_handoff_codes
   where delivery_id=v_dlv.id and code_kind='recipient_dropoff';
  if p_expected_generation <> v_gen then
    raise exception 'handoff_generation_conflict' using errcode='CR409';
  end if;

  update public.couranr_handoff_codes
     set code_state='superseded', superseded_at=now(),
         version=version+1, updated_at=now()
   where delivery_id=v_dlv.id
     and code_kind='recipient_dropoff'
     and code_state in ('active','locked');

  insert into public.couranr_handoff_codes(
    delivery_id,code_kind,generation,code_digest,code_state,
    issued_by,issued_by_guest_session_id,issued_by_access_token_id,
    issued_at,expires_at,failed_attempts
  ) values (
    v_dlv.id,'recipient_dropoff',v_gen,p_code_digest,'active',
    null,null,v_token.id,now(),
    now()+make_interval(mins=>least(greatest(coalesce(p_ttl_minutes,720),5),4320)),
    0
  ) returning * into v_row;

  update public.couranr_delivery_access_tokens
     set last_used_at=now() where id=v_token.id;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_request.id,null,'customer','issue_recipient_dropoff_code',
    v_request.request_state,v_request.request_state,
    /* The generation and the expiry. NEVER the digest, and obviously never the
       PIN — a request event is readable by every Operations surface. */
    jsonb_build_object('generation',v_gen,'expiresAt',v_row.expires_at)
  );

  return v_row;
end
$fn$;

comment on function public.couranr_issue_recipient_dropoff_code is
  'Mints the recipient drop-off PIN from a recipient-audience tracking token. '
  'The raw PIN never enters PostgreSQL and is never emailed.';

revoke all on function public.couranr_issue_recipient_dropoff_code(text,integer,text,integer)
  from public,anon,authenticated;
grant execute on function public.couranr_issue_recipient_dropoff_code(text,integer,text,integer)
  to service_role;

/* The command vocabulary is closed and enforced on INSERT only, so an omission
   here is invisible to every static assertion and fatal on the first call.
   Re-stated in full rather than patched: an earlier draft of this migration
   rewrote pg_get_constraintdef's rendering with a string replace, which trusts
   how PostgreSQL happens to print `in (...)` today instead of the vocabulary
   itself. The list below is 20260916193159's, verbatim, plus one verb. */
alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft','create_hosted_delivery_request',
    'calculate_delivery_request_estimate','create_quote_version',
    'submit_delivery_request','validate_hosted_delivery_request',
    'begin_delivery_request_review','accept_delivery_request_as_quoted',
    'auto_accept_delivery_request','auto_plan_delivery_request',
    'requote_delivery_request','decline_delivery_request',
    'record_payer_quote_approval','begin_delivery_preparation',
    'mark_delivery_ready','mark_delivery_not_ready','mark_delivery_unavailable',
    'cancel_delivery_request','apply_promotional_credit','record_consumer_trust',
    'record_recipient_adult_attestation','issue_recipient_dropoff_code'
  ));

commit;
