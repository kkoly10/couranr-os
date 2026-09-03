-- =====================================================================
-- ROLLBACK — consumer /send (20260903030000)
--
-- Drops the six consumer commands and the guest-session table, and restores
-- NOT NULL on couranr_delivery_access_tokens.business_account_id.
--
-- EVIDENCE GUARDS — HARD-REFUSE, forward repair required, when history would
-- be destroyed:
--   * any couranr_delivery_requests row with requester_kind = 'consumer'
--     (dropping the commands and the session table would strand real consumer
--     request history behind a FK and erase who could reach it);
--   * any couranr_consumer_guest_sessions row at all (a session is the only
--     record that a guest credential was ever minted);
--   * any couranr_delivery_access_tokens row with a NULL business_account_id
--     (SET NOT NULL would fail mid-transaction anyway; refuse it by name).
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $evidence$
declare v_count bigint;
begin
  select count(*) into v_count from public.couranr_delivery_requests
   where requester_kind = 'consumer';
  if v_count > 0 then
    raise exception
      'consumer_send_rollback_would_strand_consumer_requests: % consumer request(s) exist; forward repair required',
      v_count;
  end if;
end
$evidence$;

do $evidence$
declare v_count bigint;
begin
  select count(*) into v_count from public.couranr_consumer_guest_sessions;
  if v_count > 0 then
    raise exception
      'consumer_send_rollback_would_destroy_guest_sessions: % guest session(s) recorded; forward repair required',
      v_count;
  end if;
exception when undefined_table then
  null;
end
$evidence$;

do $evidence$
declare v_count bigint;
begin
  select count(*) into v_count from public.couranr_delivery_access_tokens
   where business_account_id is null;
  if v_count > 0 then
    raise exception
      'consumer_send_rollback_would_destroy_consumer_tracking_links: % null-business tracking link(s) exist; forward repair required',
      v_count;
  end if;
end
$evidence$;

drop function if exists public.couranr_submit_consumer_delivery_request(uuid,uuid,integer);
drop function if exists public.couranr_calculate_consumer_delivery_request_estimate(
  uuid,uuid,integer,boolean,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text);
drop function if exists public.couranr_create_consumer_delivery_request_draft(
  uuid,text,jsonb,text,text,text,text,numeric,integer,text,boolean,text,jsonb,jsonb,boolean,bigint,integer,integer,integer,text,text,text,text,text,integer,integer,numeric,jsonb,jsonb,text,text,text,timestamptz,jsonb,text);
drop function if exists public.couranr_bind_consumer_guest_request(uuid,uuid);
drop function if exists public.couranr_redeem_consumer_guest_session(text);
drop function if exists public.couranr_create_consumer_guest_session(text,integer);

drop table if exists public.couranr_consumer_guest_sessions restrict;

-- Safe because the evidence guard above proved no NULL exists.
alter table public.couranr_delivery_access_tokens
  alter column business_account_id set not null;

comment on column public.couranr_delivery_access_tokens.business_account_id is null;

commit;
