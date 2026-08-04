-- =====================================================================
-- ROLLBACK for the payment authorization tables.
--
-- Drops the three tables this migration created and narrows the request event
-- allow-list back to its pre-payment set.
--
-- !! DATA LOSS !!
-- Unlike every other rollback in this directory, this one DESTROYS ROWS:
-- obligations, payment events and payment links. That is unavoidable when
-- dropping a table, which is why it is spelled out here rather than discovered.
-- If any obligation has ever reached `authorized`, real money is being held
-- against a PaymentIntent this drops all record of. DO NOT RUN IT in that case
-- without first cancelling those PaymentIntents in Stripe and exporting the
-- rows. The guard below refuses rather than trusting the operator to remember.
--
--   delete from supabase_migrations.schema_migrations where version = '20260731230000';
-- =====================================================================

begin;

do $guard$
declare v_n bigint;
begin
  select count(*) into v_n from public.couranr_payment_obligations
   where payment_state = 'authorized';
  if v_n > 0 then
    raise exception
      'refusing to drop the payment tables: % obligation(s) are AUTHORIZED and hold funds in Stripe. Cancel those PaymentIntents and export these rows first.', v_n;
  end if;
end
$guard$;

drop function if exists public.couranr_revoke_payment_access_tokens(uuid, text);
drop function if exists public.couranr_redeem_payment_access_token(text);
drop function if exists public.couranr_issue_payment_access_token(uuid, uuid, text, integer);
drop function if exists public.couranr_apply_payment_intent_state(
  text, text, text, text, integer, integer, text, jsonb);
drop function if exists public.couranr_attach_payment_intent(uuid, integer, text);
drop function if exists public.couranr_create_payment_obligation(uuid, uuid, text);

drop table if exists public.couranr_payment_access_tokens restrict;
drop table if exists public.couranr_payment_events restrict;
drop table if exists public.couranr_payment_obligations restrict;
drop type  if exists public.couranr_payment_apply_result;

-- Narrow the request event allow-list. Refuses rather than rewriting history.
do $guard$
declare v_n bigint;
begin
  select count(*) into v_n from public.couranr_delivery_request_events
   where command = 'record_payer_quote_approval';
  if v_n > 0 then
    raise exception
      'refusing to narrow couranr_dre_command_chk: % event row(s) record a payer approval. The append-only log must not be rewritten; leave the CHECK widened.', v_n;
  end if;
end
$guard$;

alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (
    command = any (array[
      'create_delivery_request_draft',
      'calculate_delivery_request_estimate',
      'submit_delivery_request',
      'begin_delivery_request_review',
      'accept_delivery_request_as_quoted',
      'requote_delivery_request',
      'decline_delivery_request'
    ])
  );

commit;
