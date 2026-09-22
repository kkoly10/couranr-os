begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $$ begin
  if exists(select 1 from public.couranr_driver_portraits)
     or exists(select 1 from public.couranr_delivery_assignments
               where driver_display_name_snapshot is not null)
     or exists(select 1 from storage.objects where bucket_id='couranr-driver-portraits') then
    raise exception 'driver_portrait_rollback_refused_live_identity_history_use_forward_repair';
  end if;
end $$;
drop trigger couranr_assignment_driver_identity_snapshot on public.couranr_delivery_assignments;
drop function public.couranr_snapshot_assigned_driver_identity();
drop function public.couranr_revoke_driver_portrait(uuid,integer,uuid);
drop function public.couranr_publish_driver_portrait(uuid,integer,uuid,text,uuid,boolean);
alter table public.couranr_delivery_assignments
  drop column driver_display_name_snapshot,drop column driver_portrait_id;
alter table public.couranr_drivers drop column current_portrait_id;
drop table public.couranr_driver_portraits restrict;
-- Retain the compatible empty private bucket. The forward migration accepts a
-- bucket provisioned outside this migration, so rollback cannot truthfully
-- claim ownership and delete it. Reapply is idempotent against this residue.
commit;
