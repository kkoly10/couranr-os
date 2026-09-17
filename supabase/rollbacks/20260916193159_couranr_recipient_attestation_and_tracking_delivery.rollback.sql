-- Roll back Stage 6 only before it has produced recipient evidence or a sent
-- recipient notification. Once either exists, preserve history and forward-fix.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if exists (
    select 1 from public.couranr_delivery_requests
     where recipient_attestation_version is not null
        or recipient_adult_attested_at is not null limit 1
  ) then
    raise exception 'refusing_stage_6_rollback_with_recipient_attestation_evidence';
  end if;
  if exists (
    select 1 from public.couranr_delivery_access_tokens
     where recipient_notification_claimed_at is not null
        or recipient_notified_at is not null
        or recipient_notification_provider_id is not null limit 1
  ) then
    raise exception 'refusing_stage_6_rollback_with_recipient_notification_evidence';
  end if;
end
$guard$;

drop function if exists public.couranr_attest_recipient_adult(text,text,boolean) restrict;
drop function if exists public.couranr_fail_recipient_tracking_notification(text,text) restrict;
drop function if exists public.couranr_mark_recipient_tracking_notification(text,text) restrict;
drop function if exists public.couranr_claim_consumer_recipient_tracking_delivery(uuid,text,integer) restrict;

drop trigger if exists couranr_dr_freeze_recipient_attestation_version
  on public.couranr_delivery_requests;
drop function if exists private.couranr_freeze_recipient_attestation_version() restrict;

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
    'cancel_delivery_request','apply_promotional_credit','record_consumer_trust'
  ));

alter table public.couranr_delivery_access_tokens
  drop constraint if exists couranr_dat_recipient_notification_pair_chk,
  drop column if exists recipient_notification_provider_id restrict,
  drop column if exists recipient_notified_at restrict;
alter table public.couranr_delivery_access_tokens
  drop column if exists recipient_notification_claimed_at restrict;

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_recipient_attestation_evidence_chk,
  drop column if exists recipient_attestation_version restrict;

commit;
