-- Hosted request rollback. Refuse to destroy durable request/host evidence.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $guard$
begin
  if to_regclass('public.couranr_hosted_request_intakes') is not null
     and exists (select 1 from public.couranr_hosted_request_intakes limit 1) then
    raise exception 'Refusing hosted-request rollback: durable intake rows exist';
  end if;
end
$guard$;

drop function if exists public.couranr_decline_hosted_delivery_request(
  uuid,uuid,integer,uuid,text
) restrict;
drop function if exists public.couranr_validate_hosted_delivery_request(
  uuid,uuid,integer,uuid,text,numeric,text,text,boolean,jsonb,jsonb,
  bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,
  text,text,timestamptz,jsonb
) restrict;
drop function if exists public.couranr_create_hosted_delivery_request(
  uuid,text,text,text,jsonb,text,text,text,numeric,text,text,boolean,text
) restrict;

drop table if exists public.couranr_hosted_request_intakes restrict;

alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command in (
    'create_delivery_request_draft','calculate_delivery_request_estimate','create_quote_version',
    'submit_delivery_request','begin_delivery_request_review',
    'accept_delivery_request_as_quoted','auto_accept_delivery_request','auto_plan_delivery_request',
    'requote_delivery_request','decline_delivery_request','record_payer_quote_approval',
    'begin_delivery_preparation','mark_delivery_ready','mark_delivery_not_ready',
    'mark_delivery_unavailable','cancel_delivery_request','apply_promotional_credit'
  ));

commit;
