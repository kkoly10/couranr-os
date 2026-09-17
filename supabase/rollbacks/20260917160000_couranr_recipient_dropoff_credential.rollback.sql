-- Roll back the recipient drop-off credential.
--
-- REFUSES ON EVIDENCE, following the pattern 20260905* established: a PIN that
-- was actually minted is part of a custody record, and restoring the two-armed
-- issuer XOR while such a row exists would make the table's own constraint
-- reject its own data. The column is therefore only removable when nothing has
-- used it.
--
-- Re-runnable: every statement is `if exists`.

begin;

do $$
declare v_issued integer;
begin
  select count(*) into v_issued
  from public.couranr_handoff_codes
  where issued_by_access_token_id is not null;

  if v_issued > 0 then
    raise exception using
      errcode = 'CR409',
      message = 'recipient_dropoff_credential_rollback_refused',
      detail = format('recipient-issued credentials: %s', v_issued),
      hint = 'A recipient has minted a drop-off PIN. Restoring the two-armed '
             'issuer rule would invalidate that row. Roll forward instead.';
  end if;
end $$;

drop function if exists public.couranr_issue_recipient_dropoff_code(text,integer,text,integer) restrict;

alter table public.couranr_handoff_codes
  drop constraint if exists couranr_hc_token_issuer_kind_chk;

alter table public.couranr_handoff_codes
  drop constraint if exists couranr_hc_issuer_xor_chk;
alter table public.couranr_handoff_codes
  add constraint couranr_hc_issuer_xor_chk
  check ((issued_by is null) <> (issued_by_guest_session_id is null));

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
    'cancel_delivery_request','apply_promotional_credit','record_consumer_trust',
    'record_recipient_adult_attestation'
  ));

commit;
