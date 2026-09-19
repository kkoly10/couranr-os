-- ============================================================================
-- ASAP after-cutoff automatic-lane parity
--
-- Timing policy records "same_day_after_cutoff" for an ASAP request made at or
-- after 4:00 PM because SAME-DAY fulfillment is no longer eligible. That reason
-- is informational for ASAP: canonical quoting already ignores it and the
-- automatic planner deliberately rolls ASAP work to the next open business
-- window. The original automatic-lane predicate rejected every timing reason,
-- which contradicted both authorities and forced normal after-cutoff work into
-- manual planning.
--
-- Narrow correction:
--   * ASAP + only same_day_after_cutoff remains eligible for the automatic lane
--   * scheduled same-day-after-cutoff still requires review
--   * every other timing-review reason still requires review
--   * all shipment, route, traffic, weight and quote gates are unchanged
-- ============================================================================
begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

create or replace function private.couranr_automatic_lane_reason(p_request_id uuid)
returns text
language plpgsql
security invoker
stable
set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
begin
  select * into v_req
    from public.couranr_delivery_requests
   where id=p_request_id;

  if not found then return 'request_not_found'; end if;
  if v_req.current_quote_version_id is null then return 'current_quote_missing'; end if;

  select * into v_quote
    from public.couranr_quote_versions
   where id=v_req.current_quote_version_id
     and request_id=v_req.id;

  if not found then return 'current_quote_missing'; end if;

  if v_quote.quote_status<>'estimated' or v_quote.subtotal_cents is null then
    return 'quote_not_automatic';
  end if;

  if jsonb_array_length(coalesce(v_quote.review_reasons,'[]'::jsonb))>0
     or jsonb_array_length(coalesce(v_req.review_reasons,'[]'::jsonb))>0 then
    return 'quote_requires_review';
  end if;

  -- Canonical quoting already treats same_day_after_cutoff as informational
  -- for ASAP: it means "next business window", not "a person must plan this".
  -- Preserve review for every other timing reason, and preserve the reason for
  -- scheduled requests where the customer named a specific same-day time.
  if exists (
    select 1
      from jsonb_array_elements_text(
        coalesce(v_req.timing_review_reasons,'[]'::jsonb)
      ) as timing_reason(reason)
     where not (
       v_req.timing_intent='asap'
       and timing_reason.reason='same_day_after_cutoff'
     )
  ) then
    return 'timing_requires_review';
  end if;

  if v_req.restricted_class is distinct from 'none' then
    return 'shipment_safety_not_confirmed';
  end if;

  if coalesce(v_req.additional_stops,0)<>0 then
    return 'multiple_stops_not_automatic';
  end if;

  if v_quote.serviceability_outcome is distinct from 'available_for_request'
     or v_quote.loaded_distance_miles is null
     or v_quote.loaded_distance_miles>25 then
    return 'route_not_automatic';
  end if;

  if v_quote.route_traffic_delay_seconds is null
     or v_quote.route_traffic_delay_seconds>1500 then
    return 'traffic_not_automatic';
  end if;

  if coalesce((v_req.normalized_request_payload->>'overnightRequested')::boolean,false) then
    return 'overnight_not_automatic';
  end if;

  if v_req.weight_lb is not null then
    if v_req.weight_lb<=0 or v_req.weight_lb>50 then
      return 'weight_not_automatic';
    end if;
  elsif v_req.weight_band not in ('0_25_lb','over_25_to_50_lb') then
    return 'weight_not_automatic';
  end if;

  if v_quote.route_duration_seconds is null or v_quote.route_duration_seconds<=0 then
    return 'route_duration_missing';
  end if;

  return null;
end
$fn$;

revoke all on function private.couranr_automatic_lane_reason(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.couranr_automatic_lane_reason(uuid)
  to service_role;

commit;
