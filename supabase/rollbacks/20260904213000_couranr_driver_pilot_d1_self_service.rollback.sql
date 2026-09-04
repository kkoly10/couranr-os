begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

drop function if exists public.couranr_update_my_vehicle_capabilities(
  uuid,uuid,integer,integer,integer,integer,integer,boolean,boolean,boolean,boolean,boolean
) restrict;
drop function if exists public.couranr_set_my_vehicle_availability(
  uuid,uuid,integer,text
) restrict;
drop function if exists public.couranr_set_my_driver_availability(
  uuid,integer,text
) restrict;

commit;
