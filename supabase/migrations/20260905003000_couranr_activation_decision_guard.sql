-- MER-003 activation authority hardening.
--
-- The Operations UI already disables grant/block outside pending review, but
-- the database command itself did not. A service-role caller could therefore
-- grant a workspace from not_started/in_progress, grant after current policy
-- versions had gone stale, or block a live workspace through the activation
-- command. The database must own those gates.
--
-- Additive cutover: the old function remains for the previous deployment while
-- the application switches to this guarded command.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

create function public.couranr_decide_activation_guarded(
  p_business_account_id uuid,
  p_actor_user_id       uuid,
  p_grant               boolean,
  p_blocked_reason_code text,
  p_required_acks       jsonb
)
returns public.couranr_workspace_activations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_profile_role text;
  v_row          public.couranr_workspace_activations;
  v_kind         text;
  v_version      text;
begin
  select role into v_profile_role
    from public.profiles
   where id = p_actor_user_id;

  if v_profile_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  if p_required_acks is null or jsonb_typeof(p_required_acks) <> 'object' then
    raise exception 'required_acknowledgements_missing' using errcode = 'CR400';
  end if;

  select * into v_row
    from public.couranr_workspace_activations
   where business_account_id = p_business_account_id
   for update;

  if not found then
    raise exception 'activation_not_found' using errcode = 'CR404';
  end if;

  -- Activation decisions are review outcomes, not a generic account-state
  -- setter. Account pause/suspension is a separate future authority.
  if v_row.activation_state <> 'pending_couranr_review' then
    raise exception 'activation_not_pending_review' using errcode = 'CR409';
  end if;

  if p_grant then
    -- Re-check every CURRENT server-governed document version at the instant
    -- Operations grants. A policy update after the merchant requested review
    -- therefore makes grant fail closed until the new version is accepted.
    for v_kind, v_version in select * from jsonb_each_text(p_required_acks)
    loop
      perform 1
        from public.couranr_activation_acknowledgements
       where business_account_id = p_business_account_id
         and ack_kind = v_kind
         and ack_version = v_version;
      if not found then
        raise exception 'activation_requirements_not_met' using errcode = 'CR409';
      end if;
    end loop;

    if v_row.contact_verified_at is null
       or v_row.test_delivery_request_id is null
       or v_row.requested_at is null then
      raise exception 'activation_requirements_not_met' using errcode = 'CR409';
    end if;

    -- Defense in depth: the recorded test delivery must still belong to this
    -- exact business. The recording command already enforces this at write
    -- time, but grant is an irreversible authority boundary and rechecks it.
    perform 1
      from public.couranr_delivery_requests
     where id = v_row.test_delivery_request_id
       and business_account_id = p_business_account_id;
    if not found then
      raise exception 'activation_requirements_not_met' using errcode = 'CR409';
    end if;
  else
    if p_blocked_reason_code not in (
      'contact_unreachable',
      'prohibited_items_risk',
      'incomplete_information',
      'additional_review_required'
    ) then
      raise exception 'unknown_activation_block_reason' using errcode = 'CR400';
    end if;
  end if;

  update public.couranr_workspace_activations
     set activation_state    = case when p_grant then 'live' else 'blocked' end,
         blocked_reason_code = case when p_grant then null else p_blocked_reason_code end,
         reviewed_at         = now(),
         reviewed_by         = p_actor_user_id,
         version             = version + 1,
         updated_at          = now()
   where business_account_id = p_business_account_id
  returning * into v_row;

  insert into public.couranr_activation_events
    (business_account_id, actor_user_id, actor_type, command, from_state, to_state, metadata)
  values
    (p_business_account_id, p_actor_user_id, 'operations',
     case when p_grant then 'grant_activation' else 'block_activation' end,
     'pending_couranr_review', v_row.activation_state,
     case when p_grant then '{}'::jsonb
          else jsonb_build_object('reasonCode', p_blocked_reason_code) end);

  return v_row;
end
$fn$;

revoke all on function public.couranr_decide_activation_guarded(uuid,uuid,boolean,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_decide_activation_guarded(uuid,uuid,boolean,text,jsonb)
  to service_role;

commit;
