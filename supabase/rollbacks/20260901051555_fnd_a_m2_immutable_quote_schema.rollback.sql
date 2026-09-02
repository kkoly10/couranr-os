-- ROLLBACK for Gate A M2.
-- REAL COMMERCIAL DATA WARNING: this rollback refuses while any quote row or
-- nullable consumer-spine tenancy exists. After semantic use, forward repair
-- is the only acceptable rollback strategy.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if exists (select 1 from public.couranr_quote_versions) then
    raise exception 'unsafe rollback: immutable quote history exists; use an application compatibility rollback / forward repair';
  end if;
  if exists (select 1 from public.couranr_payment_obligations where business_account_id is null)
     or exists (select 1 from public.couranr_payment_access_tokens where business_account_id is null)
     or exists (select 1 from public.couranr_service_plans where business_account_id is null)
     or exists (select 1 from public.couranr_deliveries where business_account_id is null) then
    raise exception 'unsafe rollback: consumer commercial spine rows exist; use a forward repair';
  end if;
end
$guard$;

alter table public.couranr_delivery_request_events drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command = any (array[
    'create_delivery_request_draft','calculate_delivery_request_estimate',
    'submit_delivery_request','begin_delivery_request_review',
    'accept_delivery_request_as_quoted','requote_delivery_request',
    'decline_delivery_request','record_payer_quote_approval',
    'begin_delivery_preparation','mark_delivery_ready','mark_delivery_not_ready',
    'mark_delivery_unavailable'
  ]));

alter table public.couranr_deliveries
  drop constraint if exists couranr_dlv_quote_request_fk,
  drop column if exists quote_version_id,
  alter column business_account_id set not null;
alter table public.couranr_service_plans
  drop constraint if exists couranr_sp_quote_request_fk,
  drop column if exists quote_version_id,
  alter column business_account_id set not null;
alter table public.couranr_payment_obligations
  drop constraint if exists couranr_po_quote_request_fk,
  drop column if exists quote_version_id,
  alter column business_account_id set not null;
alter table public.couranr_payment_access_tokens
  alter column business_account_id set not null;
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_current_quote_request_fk,
  drop column if exists current_quote_version_id;

drop trigger if exists couranr_qv_sequence_trg on public.couranr_quote_versions;
drop function if exists private.couranr_enforce_quote_sequence();
drop table if exists public.couranr_quote_versions restrict;
drop function if exists public.couranr_quote_line_items_total(jsonb);

commit;
