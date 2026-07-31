-- =====================================================================
-- ROLLBACK for the review-outcome commands (REV-001).
--
-- Restores the three things the forward migration changed:
--   1. drops the three review-outcome functions, by full signature
--   2. restores couranr_submit_delivery_request to its 11-parameter form
--   3. narrows couranr_dre_command_chk back to the original four commands
--
-- Touches no table, no policy and no grant on any pre-existing object.
--
-- !! DATA CHECK BEFORE STEP 3 !!
-- Narrowing the CHECK will FAIL if any event row already records one of the
-- three new commands — which is correct: the append-only log must not be
-- rewritten to make a rollback fit. The guard below raises with the count so
-- the operator can decide. If you must roll back with such rows present,
-- leave the CHECK widened (it constrains nothing that is not also enforced by
-- the functions) and skip section 3 only.
--
-- Rolling back also requires deleting the tracked history row, or the next
-- apply will believe the migration is already present:
--   delete from supabase_migrations.schema_migrations where version = '20260731180000';
-- =====================================================================

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------
-- 1. Drop the three review-outcome commands.
-- ---------------------------------------------------------------------
drop function if exists public.couranr_accept_delivery_request_as_quoted(
  uuid, uuid, integer, uuid
);

drop function if exists public.couranr_requote_delivery_request(
  uuid, uuid, integer, uuid, text, integer, integer, numeric, jsonb, text
);

drop function if exists public.couranr_decline_delivery_request(
  uuid, uuid, integer, uuid, text, text
);

-- ---------------------------------------------------------------------
-- 2. Restore the 11-parameter submit command, byte-for-byte as it stood in
--    20260731055802, minus the acknowledgment metadata.
-- ---------------------------------------------------------------------
drop function if exists public.couranr_submit_delivery_request(
  uuid, uuid, integer, uuid, text, text, integer, integer, numeric, jsonb, jsonb, boolean
);

create function public.couranr_submit_delivery_request(
  p_request_id              uuid,
  p_business_account_id     uuid,
  p_expected_version        integer,
  p_actor_user_id           uuid,
  p_quote_status            text,
  p_pricing_policy_version  text,
  p_delivery_subtotal_cents integer,
  p_included_loaded_miles   integer,
  p_billable_loaded_miles   numeric,
  p_quote_line_items        jsonb,
  p_review_reasons          jsonb
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_row public.couranr_delivery_requests;
  v_sum bigint;
begin
  if jsonb_typeof(p_quote_line_items) <> 'array' then
    raise exception 'quote_line_items_not_array' using errcode = 'CR422';
  end if;

  if p_quote_status = 'estimated' then
    if p_delivery_subtotal_cents is null or p_pricing_policy_version is null then
      raise exception 'quote_incomplete' using errcode = 'CR422';
    end if;
    select coalesce(sum((li ->> 'amountCents')::bigint), 0)
      into v_sum
      from jsonb_array_elements(p_quote_line_items) as li;
    if v_sum is distinct from p_delivery_subtotal_cents::bigint then
      raise exception 'quote_subtotal_mismatch' using errcode = 'CR422';
    end if;
  elsif p_delivery_subtotal_cents is not null then
    raise exception 'quote_amount_on_unpriced_request' using errcode = 'CR422';
  end if;

  perform 1 from public.couranr_delivery_requests
   where id = p_request_id and business_account_id = p_business_account_id;
  if not found then
    raise exception 'request_not_found' using errcode = 'CR404';
  end if;

  update public.couranr_delivery_requests set
    request_state             = 'pending_couranr_review',
    review_state              = 'pending',
    submitted_at              = now(),
    quote_status              = p_quote_status,
    pricing_policy_version    = p_pricing_policy_version,
    delivery_subtotal_cents   = p_delivery_subtotal_cents,
    included_loaded_miles     = p_included_loaded_miles,
    billable_loaded_miles     = p_billable_loaded_miles,
    quote_line_items          = p_quote_line_items,
    review_reasons            = p_review_reasons,
    rounding_applied          = false,
    tax_included              = false,
    payment_due_cents         = null,
    version                   = p_expected_version + 1,
    updated_at                = now()
  where id                  = p_request_id
    and business_account_id = p_business_account_id
    and version             = p_expected_version
    and request_state       = 'draft'
  returning * into v_row;

  if not found then
    raise exception 'version_or_state_conflict' using errcode = 'CR409';
  end if;

  insert into public.couranr_delivery_request_events (
    request_id, actor_user_id, actor_type, command, from_state, to_state, metadata
  ) values (
    v_row.id, p_actor_user_id, 'merchant', 'submit_delivery_request',
    'draft', 'pending_couranr_review',
    jsonb_build_object('reviewReasons', v_row.review_reasons)
  );

  return v_row;
end
$fn$;

comment on function public.couranr_submit_delivery_request is
  'Atomic: moves a draft to pending_couranr_review and appends its submission event in one transaction. SECURITY INVOKER, service_role only.';

revoke all on function public.couranr_submit_delivery_request(
  uuid, uuid, integer, uuid, text, text, integer, integer, numeric, jsonb, jsonb
) from public, anon, authenticated, service_role;

grant execute on function public.couranr_submit_delivery_request(
  uuid, uuid, integer, uuid, text, text, integer, integer, numeric, jsonb, jsonb
) to service_role;

-- ---------------------------------------------------------------------
-- 3. Narrow the event command allow-list back to the original four.
--
-- Refuses rather than rewriting history if the log already records one of
-- the three new commands.
-- ---------------------------------------------------------------------
do $guard$
declare
  v_n bigint;
begin
  select count(*) into v_n
    from public.couranr_delivery_request_events
   where command in ('accept_delivery_request_as_quoted',
                     'requote_delivery_request',
                     'decline_delivery_request');
  if v_n > 0 then
    raise exception
      'refusing to narrow couranr_dre_command_chk: % event row(s) already record a review-outcome command. The append-only log must not be rewritten. Leave the CHECK widened and skip section 3.', v_n;
  end if;
end
$guard$;

alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;

alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft',
    'calculate_delivery_request_estimate',
    'submit_delivery_request',
    'begin_delivery_request_review'));

commit;
