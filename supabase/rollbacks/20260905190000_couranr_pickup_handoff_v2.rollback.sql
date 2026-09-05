-- Rollback for 20260905190000_couranr_pickup_handoff_v2.sql.
--
-- Refuses once V2 sender/custody evidence exists. A rollback must never erase
-- a sender manifest or make a guest-issued credential unattributable.

begin;

do $$
declare
  v_manifest_count bigint := 0;
  v_guest_code_count bigint := 0;
  v_frozen_count bigint := 0;
begin
  if to_regclass('public.couranr_delivery_requests') is not null
     and exists (
       select 1 from information_schema.columns
        where table_schema='public'
          and table_name='couranr_delivery_requests'
          and column_name='pickup_manifest'
     )
  then
    select count(*) into v_manifest_count
      from public.couranr_delivery_requests
     where pickup_manifest is not null;
  end if;

  if to_regclass('public.couranr_handoff_codes') is not null
     and exists (
       select 1 from information_schema.columns
        where table_schema='public'
          and table_name='couranr_handoff_codes'
          and column_name='issued_by_guest_session_id'
     )
  then
    select count(*) into v_guest_code_count
      from public.couranr_handoff_codes
     where issued_by_guest_session_id is not null;
  end if;

  if to_regclass('public.couranr_deliveries') is not null then
    select count(*) into v_frozen_count
      from public.couranr_deliveries
     where shipment ? 'pickupManifest';
  end if;

  if v_manifest_count > 0 or v_guest_code_count > 0 or v_frozen_count > 0 then
    raise exception 'pickup_handoff_v2_rollback_would_destroy_evidence'
      using errcode='CR409';
  end if;
end
$$;

drop trigger if exists couranr_freeze_pickup_manifest_trg on public.couranr_deliveries;

drop function if exists public.couranr_complete_pickup_v2(uuid,integer,uuid,numeric,numeric,numeric);
drop function if exists public.couranr_issue_guest_pickup_code_cas(uuid,integer,text,uuid,integer);
drop function if exists private.couranr_freeze_pickup_manifest_on_delivery();
drop function if exists public.couranr_confirm_hosted_pickup_manifest(uuid,uuid,uuid,integer,text,integer,text,text);
drop function if exists public.couranr_set_hosted_customer_pickup_manifest(uuid,integer,text,integer,text,text);
drop function if exists public.couranr_set_consumer_pickup_manifest(uuid,integer,text,integer,text,text);
drop function if exists public.couranr_set_operations_pickup_manifest(uuid,uuid,integer,text,integer,text,text);
drop function if exists public.couranr_set_business_pickup_manifest(uuid,uuid,uuid,integer,text,integer,text,text);
drop function if exists private.couranr_write_pickup_manifest(uuid,integer,jsonb);
drop function if exists private.couranr_build_pickup_manifest(text,integer,text,text,text);

alter table public.couranr_handoff_codes
  drop constraint if exists couranr_hc_issuer_xor_chk;
alter table public.couranr_handoff_codes
  drop column if exists issued_by_guest_session_id;
alter table public.couranr_handoff_codes
  alter column issued_by set not null;

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_pickup_manifest_version_chk;
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_pickup_manifest_obj_chk;
alter table public.couranr_delivery_requests
  drop column if exists pickup_manifest_version;
alter table public.couranr_delivery_requests
  drop column if exists pickup_manifest;

commit;
