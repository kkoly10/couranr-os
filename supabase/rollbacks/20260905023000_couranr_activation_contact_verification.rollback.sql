-- Rollback MER-003 pilot contact verification.
-- REAL PRODUCTION DATA: couranr_activation_events is an append-only audit log.
-- The forward migration widened its actor_type/command CHECKs to admit
-- 'system' and the request/invalidate contact-verification commands, and added
-- contact-verification evidence columns to couranr_workspace_activations. Once
-- the feature has written any such row, re-adding the NARROW CHECKs below would
-- abort with check_violation (23514) and dropping the evidence columns would
-- erase audit history. Refuse in that case and roll forward instead, matching
-- the sibling rollbacks (20260904152329 / 20260904055602 / 20260904175646).
begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if exists (select 1 from public.couranr_activation_events
             where actor_type = 'system'
                or command in ('request_contact_verification','invalidate_contact_verification'))
     or exists (select 1 from public.couranr_workspace_activations
                where contact_verification_requested_at is not null
                   or contact_verification_requested_by is not null
                   or contact_verified_by is not null) then
    raise exception 'refusing to restore pre-contact-verification constraints/columns: contact verification evidence exists; roll forward instead';
  end if;
end
$guard$;

drop trigger if exists couranr_workspace_contact_activation_invalidation_trg
  on public.couranr_merchant_workspaces;
drop function if exists private.couranr_invalidate_activation_contact_on_workspace_update();
drop function if exists public.couranr_verify_activation_contact_by_operations(uuid,uuid);
drop function if exists public.couranr_request_activation_contact_verification(uuid,uuid);

alter table public.couranr_activation_events
  drop constraint couranr_actev_actor_chk,
  add constraint couranr_actev_actor_chk
    check (actor_type in ('merchant', 'operations')),
  drop constraint couranr_actev_command_chk,
  add constraint couranr_actev_command_chk check (command in (
    'accept_acknowledgement',
    'verify_contact',
    'record_test_delivery',
    'request_activation',
    'grant_activation',
    'block_activation'
  ));

alter table public.couranr_workspace_activations
  drop constraint if exists couranr_wa_contact_verified_actor_chk,
  drop constraint if exists couranr_wa_contact_request_pair_chk,
  drop column if exists contact_verified_by,
  drop column if exists contact_verification_requested_by,
  drop column if exists contact_verification_requested_at;

commit;
