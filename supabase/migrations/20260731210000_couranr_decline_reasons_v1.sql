-- =====================================================================
-- Couranr decline reasons v1 — REV-002, owner-approved 2026-07-31.
--
-- Replaces the placeholder taxonomy that shipped with the review outcomes.
-- The placeholder was built from codes already in the tree because no
-- authority defined a vocabulary; the owner has now decided one, so this is
-- the canonical set and `couranr-decline-v1` is its version.
--
-- THE MERCHANT MESSAGE IS DERIVED HERE, NOT SUPPLIED.
-- There is no `p_merchant_message` parameter. A caller cannot choose what a
-- merchant is told a decline means, in the same way no caller can choose a
-- price or a target state. The mapping below is the only place a code becomes
-- prose at write time, so the recorded message and the recorded code can never
-- disagree.
--
-- WHAT IS *NOT* A DECLINE REASON.
--   over_max_automatic_miles, over_max_automatic_weight
--     Review TRIGGERS (lib/couranr/pricing ReviewReasonCode). They say a quote
--     needs a human, not that Couranr refused the work. Declining with one of
--     them would tell a merchant "we cannot serve you" when the truth is "we
--     have to price this by hand".
--   overnight_not_offered_in_this_release
--     Conceptually a `requested_time_unavailable`, and deliberately NOT
--     retained: a release-internal detail is not something to say to a
--     merchant, and it would rot the moment overnight ships.
--
-- APPEND-ONLY IS RESPECTED. No existing event row is read, rewritten, deleted
-- or migrated. Events written under the placeholder taxonomy keep their
-- original `reason` key and their original code; the reader maps any code it
-- does not recognise onto the generic safe message.
--
-- ADDITIVE. One function is replaced by its identical signature. No table, no
-- column, no row, no constraint and no other function is touched.
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regprocedure(
       'public.couranr_decline_delivery_request(uuid,uuid,integer,uuid,text,text)'
     ) is null then
    raise exception
      'couranr_decline_delivery_request is missing; apply 20260731180000 first';
  end if;
end
$guard$;

drop function public.couranr_decline_delivery_request(uuid, uuid, integer, uuid, text, text);

create function public.couranr_decline_delivery_request(
  p_request_id          uuid,
  p_business_account_id uuid,
  p_expected_version    integer,
  p_actor_user_id       uuid,
  p_decline_reason      text,
  p_internal_note       text
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row  public.couranr_delivery_requests;
  v_note text;
  v_msg  text;
begin
  v_note := nullif(btrim(coalesce(p_internal_note, '')), '');

  -- The taxonomy and its merchant-safe copy, in one place. An unrecognised
  -- code produces NULL here and is refused below, so this `case` is both the
  -- allow-list and the message table — they cannot drift apart.
  v_msg := case p_decline_reason
    when 'outside_service_area' then
      'Couranr could not confirm service for this route.'
    when 'requested_time_unavailable' then
      'Couranr could not confirm the requested delivery time.'
    when 'no_driver_available' then
      'Couranr does not have an available driver for this request.'
    when 'no_compatible_vehicle' then
      'Couranr could not confirm a compatible vehicle for this shipment.'
    when 'shipment_not_supported' then
      'This shipment cannot be handled through Couranr.'
    when 'merchant_account_on_hold' then
      'This business account needs attention before Couranr can confirm service.'
    when 'duplicate_or_superseded' then
      'This request was replaced by another request.'
    when 'other' then
      'Couranr could not confirm this request. Contact Couranr Support for details.'
    else null
  end;

  -- Covers null, empty, whitespace, a retired code and anything invented.
  if v_msg is null then
    raise exception 'decline_reason_unrecognized' using errcode = 'CR422';
  end if;

  -- `other` names nothing, and `merchant_account_on_hold` is an assertion
  -- about a business that someone has to be able to justify later. Both are
  -- only honest with a note.
  if p_decline_reason in ('other', 'merchant_account_on_hold') and v_note is null then
    raise exception 'internal_note_required' using errcode = 'CR422';
  end if;

  perform 1 from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  update public.couranr_delivery_requests set
    request_state = 'declined',
    review_state  = 'declined',
    version       = p_expected_version + 1,
    updated_at    = now()
  where id                  = p_request_id
    and business_account_id = p_business_account_id
    and version             = p_expected_version
    and request_state       = 'pending_couranr_review'
    and review_state        = 'pending'
  returning * into v_row;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  -- `internalNote` lives here and ONLY here. No read path that serves a
  -- merchant or a customer selects it; see getDeliveryRequest.
  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_actor_user_id, 'operations', 'decline_delivery_request',
    'pending_couranr_review', 'declined',
    jsonb_build_object(
      'payerType',       v_row.payer_type,
      'reviewState',     'declined',
      'reasonCode',      p_decline_reason,
      'reasonVersion',   'couranr-decline-v1',
      'merchantMessage', v_msg,
      'internalNote',    v_note
    )
  );

  return v_row;
end
$fn$;

comment on function public.couranr_decline_delivery_request is
  'Atomic: records that Couranr could not confirm service. The reason must be one of the couranr-decline-v1 codes (CR422 otherwise); other and merchant_account_on_hold additionally require an internal note. The merchant-safe message is derived here from the code, never supplied by a caller. SECURITY INVOKER, service_role only.';

-- A dropped function takes its grants with it, and this project's
-- pg_default_acl hands EXECUTE to anon, authenticated, service_role AND
-- PUBLIC on every newly created function in `public`.
revoke all on function
  public.couranr_decline_delivery_request(uuid, uuid, integer, uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  public.couranr_decline_delivery_request(uuid, uuid, integer, uuid, text, text)
  to service_role;

commit;
