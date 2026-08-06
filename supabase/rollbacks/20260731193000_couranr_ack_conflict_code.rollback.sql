-- =====================================================================
-- ROLLBACK for the acknowledgment SQLSTATE change.
--
-- Restores couranr_accept_delivery_request_as_quoted to the CR409 form that
-- 20260731180000 created. Identical signature, so nothing else has to change.
--
-- NOTE: after rolling back, `classifyDatabaseError` must stop mapping CR412,
-- or a missing acknowledgment will read as `internal` rather than a conflict.
--
-- Touches no table, no column and no row.
--
--   delete from supabase_migrations.schema_migrations where version = '20260731193000';
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

drop function if exists public.couranr_accept_delivery_request_as_quoted(uuid, uuid, integer, uuid);

create function public.couranr_accept_delivery_request_as_quoted(
  p_request_id          uuid,
  p_business_account_id uuid,
  p_expected_version    integer,
  p_actor_user_id       uuid
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_current  public.couranr_delivery_requests;
  v_row      public.couranr_delivery_requests;
  v_target   text;
  v_ack      jsonb;
begin
  select * into v_current
    from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  -- A confirm must rest on a real, server-computed quote.
  if v_current.quote_status is distinct from 'estimated'
     or v_current.delivery_subtotal_cents is null then
    raise exception 'no_server_quote_to_confirm' using errcode = 'CR422';
  end if;

  if v_current.payer_type = 'merchant' then
    -- The shortcut past payer approval is only sound with proof that the
    -- merchant approved THIS quote at submission.
    select e.metadata into v_ack
      from public.couranr_delivery_request_events e
     where e.request_id = p_request_id
       and e.command    = 'submit_delivery_request'
     order by e.created_at desc
     limit 1;

    if v_ack is null or coalesce((v_ack ->> 'acknowledgment')::boolean, false) is not true then
      -- Never silently confirm. A stable conflict the caller can act on.
      raise exception 'merchant_acknowledgment_missing' using errcode = 'CR409';
    end if;

    -- The quote must be the SUBMITTED quote, unrevised.
    if (v_ack ->> 'deliverySubtotalCents') is null
       or (v_ack ->> 'deliverySubtotalCents')::bigint
            is distinct from v_current.delivery_subtotal_cents::bigint
       or (v_ack ->> 'pricingPolicyVersion')
            is distinct from v_current.pricing_policy_version then
      raise exception 'quote_revised_since_acknowledgment' using errcode = 'CR409';
    end if;

    v_target := 'confirmed';
  else
    -- Customer-paid: the merchant cannot approve on the customer's behalf.
    v_target := 'awaiting_quote_acceptance';
  end if;

  update public.couranr_delivery_requests set
    request_state = v_target,
    review_state  = 'accepted_as_quoted',
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
    v_row.id, p_actor_user_id, 'operations', 'accept_delivery_request_as_quoted',
    'pending_couranr_review', v_target,
    jsonb_build_object(
      'payerType',             v_row.payer_type,
      'reviewState',           'accepted_as_quoted',
      'deliverySubtotalCents', v_row.delivery_subtotal_cents,
      'pricingPolicyVersion',  v_row.pricing_policy_version,
      'quoteChanged',          false
    )
  );

  return v_row;
end
$fn$;

revoke all on function public.couranr_accept_delivery_request_as_quoted(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.couranr_accept_delivery_request_as_quoted(uuid, uuid, integer, uuid)
  to service_role;

commit;
