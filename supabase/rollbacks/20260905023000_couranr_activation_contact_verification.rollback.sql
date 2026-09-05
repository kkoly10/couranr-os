-- Rollback MER-003 pilot contact verification.
begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

grant execute on function public.couranr_verify_activation_contact(uuid,uuid)
  to service_role;

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
