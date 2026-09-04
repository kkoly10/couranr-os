begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

drop function if exists public.couranr_set_my_driver_availability(
  uuid,integer,text
) restrict;

commit;
