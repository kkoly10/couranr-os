-- =====================================================================
-- ROLLBACK for decline reasons v1 (REV-002).
--
-- Restores couranr_decline_delivery_request to the placeholder form that
-- 20260731180000 created: a free-text non-empty reason, no taxonomy, no
-- derived merchant message. Identical signature.
--
-- !! READ THIS BEFORE ROLLING BACK !!
-- Events already written under couranr-decline-v1 keep their `reasonCode`,
-- `reasonVersion` and `merchantMessage` keys. They are NOT rewritten and must
-- not be — the log is append-only. The restored function writes the older
-- `reason` key instead, so the two shapes coexist. The reader already handles
-- both (`reasonCode ?? legacyReason`), so nothing breaks; but any v1 code that
-- the placeholder taxonomy did not contain — requested_time_unavailable,
-- no_driver_available, no_compatible_vehicle, shipment_not_supported,
-- merchant_account_on_hold, duplicate_or_superseded — will then be unknown to
-- the TypeScript layer and render the generic safe message. That is the
-- designed fallback, not a defect.
--
-- Also revert lib/couranr/requests/states.ts, or the UI will offer codes the
-- restored function refuses.
--
-- Touches no table, no column and no row.
--
--   delete from supabase_migrations.schema_migrations where version = '20260731210000';
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

drop function if exists
  public.couranr_decline_delivery_request(uuid, uuid, integer, uuid, text, text);

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
  v_row public.couranr_delivery_requests;
begin
  -- A structured reason is required. A decline with no reason is unreviewable
  -- later and unexplainable to the merchant.
  if p_decline_reason is null or length(btrim(p_decline_reason)) = 0 then
    raise exception 'decline_reason_required' using errcode = 'CR422';
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

  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_actor_user_id, 'operations', 'decline_delivery_request',
    'pending_couranr_review', 'declined',
    jsonb_build_object(
      'payerType',    v_row.payer_type,
      'reviewState',  'declined',
      'reason',       p_decline_reason,
      'internalNote', nullif(btrim(coalesce(p_internal_note, '')), '')
    )
  );

  return v_row;
end
$fn$;

revoke all on function
  public.couranr_decline_delivery_request(uuid, uuid, integer, uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function
  public.couranr_decline_delivery_request(uuid, uuid, integer, uuid, text, text)
  to service_role;

commit;
