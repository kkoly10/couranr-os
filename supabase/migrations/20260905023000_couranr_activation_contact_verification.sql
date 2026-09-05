-- MER-003 pilot contact verification.
--
-- Replace merchant self-attestation with a no-cost, Operations-verified contact
-- workflow. Merchants request verification; only Couranr Operations may mark
-- the stored operations phone verified. Changing the phone invalidates the
-- evidence automatically.
--
-- Additive cutover. The legacy merchant verification function remains in the
-- catalog for rollback compatibility, but its service-role EXECUTE privilege
-- is revoked in this migration.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

alter table public.couranr_workspace_activations
  add column contact_verification_requested_at timestamptz,
  add column contact_verification_requested_by uuid,
  add column contact_verified_by uuid;

alter table public.couranr_workspace_activations
  add constraint couranr_wa_contact_request_pair_chk check (
    (contact_verification_requested_at is null) =
    (contact_verification_requested_by is null)
  ),
  add constraint couranr_wa_contact_verified_pair_chk check (
    (contact_verified_at is null) = (contact_verified_by is null)
  );

alter table public.couranr_activation_events
  drop constraint couranr_actev_actor_chk,
  add constraint couranr_actev_actor_chk
    check (actor_type in ('merchant', 'operations', 'system')),
  drop constraint couranr_actev_command_chk,
  add constraint couranr_actev_command_chk check (command in (
    'accept_acknowledgement',
    'request_contact_verification',
    'verify_contact',
    'invalidate_contact_verification',
    'record_test_delivery',
    'request_activation',
    'grant_activation',
    'block_activation'
  ));

create function public.couranr_request_activation_contact_verification(
  p_business_account_id uuid,
  p_actor_user_id       uuid
)
returns public.couranr_workspace_activations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_actor_role text;
  v_phone      text;
  v_row        public.couranr_workspace_activations;
  v_from       text;
begin
  v_actor_role := public.couranr_require_active_member(
    p_business_account_id,
    p_actor_user_id
  );

  if v_actor_role not in ('owner', 'manager') then
    raise exception 'role_may_not_manage_activation' using errcode = 'CR403';
  end if;

  select nullif(btrim(contact_phone), '')
    into v_phone
    from public.couranr_merchant_workspaces
   where business_account_id = p_business_account_id;

  if v_phone is null then
    raise exception 'operations_contact_required' using errcode = 'CR409';
  end if;

  v_row := public.couranr_lock_activation(p_business_account_id);
  v_from := v_row.activation_state;

  if v_row.activation_state = 'live' then
    raise exception 'workspace_already_live' using errcode = 'CR409';
  end if;
  if v_row.contact_verified_at is not null then
    raise exception 'contact_already_verified' using errcode = 'CR409';
  end if;

  update public.couranr_workspace_activations
     set contact_verification_requested_at = coalesce(contact_verification_requested_at, now()),
         contact_verification_requested_by = coalesce(contact_verification_requested_by, p_actor_user_id),
         activation_state = case
           when activation_state = 'not_started' then 'in_progress'
           when activation_state = 'blocked'
                and blocked_reason_code = 'contact_unreachable' then 'in_progress'
           else activation_state
         end,
         blocked_reason_code = case
           when activation_state = 'blocked'
                and blocked_reason_code = 'contact_unreachable' then null
           else blocked_reason_code
         end,
         version    = version + 1,
         updated_at = now()
   where business_account_id = p_business_account_id
  returning * into v_row;

  insert into public.couranr_activation_events
    (business_account_id, actor_user_id, actor_type, command, from_state, to_state)
  values
    (p_business_account_id, p_actor_user_id, 'merchant',
     'request_contact_verification', v_from, v_row.activation_state);

  return v_row;
end
$fn$;

create function public.couranr_verify_activation_contact_by_operations(
  p_business_account_id uuid,
  p_actor_user_id       uuid
)
returns public.couranr_workspace_activations
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_profile_role text;
  v_phone        text;
  v_row          public.couranr_workspace_activations;
  v_from         text;
begin
  select role into v_profile_role
    from public.profiles
   where id = p_actor_user_id;

  if v_profile_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode = 'CR403';
  end if;

  select nullif(btrim(contact_phone), '')
    into v_phone
    from public.couranr_merchant_workspaces
   where business_account_id = p_business_account_id;

  if v_phone is null then
    raise exception 'operations_contact_required' using errcode = 'CR409';
  end if;

  select * into v_row
    from public.couranr_workspace_activations
   where business_account_id = p_business_account_id
   for update;

  if not found then
    raise exception 'activation_not_found' using errcode = 'CR404';
  end if;

  if v_row.contact_verification_requested_at is null then
    raise exception 'contact_verification_not_requested' using errcode = 'CR409';
  end if;

  v_from := v_row.activation_state;

  update public.couranr_workspace_activations
     set contact_verified_at = now(),
         contact_verified_by = p_actor_user_id,
         activation_state = case
           when activation_state = 'not_started' then 'in_progress'
           when activation_state = 'blocked'
                and blocked_reason_code = 'contact_unreachable' then 'in_progress'
           else activation_state
         end,
         blocked_reason_code = case
           when activation_state = 'blocked'
                and blocked_reason_code = 'contact_unreachable' then null
           else blocked_reason_code
         end,
         version    = version + 1,
         updated_at = now()
   where business_account_id = p_business_account_id
  returning * into v_row;

  insert into public.couranr_activation_events
    (business_account_id, actor_user_id, actor_type, command, from_state, to_state)
  values
    (p_business_account_id, p_actor_user_id, 'operations',
     'verify_contact', v_from, v_row.activation_state);

  return v_row;
end
$fn$;

-- Changing the operations phone makes any prior evidence stale. The trigger
-- never stores either phone number in audit metadata. If the workspace was
-- waiting on activation review, move it back to in_progress so Operations
-- cannot grant against a prerequisite that disappeared. A live workspace is
-- not silently deactivated; it is surfaced to Operations as needing renewed
-- contact verification.
create function private.couranr_invalidate_activation_contact_on_workspace_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_from text;
  v_to   text;
begin
  if new.contact_phone is not distinct from old.contact_phone then
    return new;
  end if;

  select activation_state into v_from
    from public.couranr_workspace_activations
   where business_account_id = new.business_account_id
   for update;

  if not found then
    return new;
  end if;

  update public.couranr_workspace_activations
     set contact_verified_at = null,
         contact_verified_by = null,
         contact_verification_requested_at = null,
         contact_verification_requested_by = null,
         activation_state = case
           when activation_state = 'pending_couranr_review' then 'in_progress'
           else activation_state
         end,
         requested_at = case
           when activation_state = 'pending_couranr_review' then null
           else requested_at
         end,
         version    = version + 1,
         updated_at = now()
   where business_account_id = new.business_account_id
  returning activation_state into v_to;

  insert into public.couranr_activation_events
    (business_account_id, actor_user_id, actor_type, command, from_state, to_state, metadata)
  values
    (new.business_account_id, null, 'system',
     'invalidate_contact_verification', v_from, v_to,
     jsonb_build_object('reason', 'operations_contact_changed'));

  return new;
end
$fn$;

drop trigger if exists couranr_workspace_contact_activation_invalidation_trg
  on public.couranr_merchant_workspaces;
create trigger couranr_workspace_contact_activation_invalidation_trg
after update of contact_phone on public.couranr_merchant_workspaces
for each row
when (old.contact_phone is distinct from new.contact_phone)
execute function private.couranr_invalidate_activation_contact_on_workspace_update();

revoke all on function public.couranr_request_activation_contact_verification(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_request_activation_contact_verification(uuid,uuid)
  to service_role;

revoke all on function public.couranr_verify_activation_contact_by_operations(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_verify_activation_contact_by_operations(uuid,uuid)
  to service_role;

revoke all on function private.couranr_invalidate_activation_contact_on_workspace_update()
  from public, anon, authenticated, service_role;

-- The old merchant self-attestation is no longer an authority path.
revoke execute on function public.couranr_verify_activation_contact(uuid,uuid)
  from service_role;

commit;
