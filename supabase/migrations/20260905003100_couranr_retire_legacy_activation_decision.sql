-- Retire the legacy MER-003 activation decision entrypoint after the guarded
-- application cutover. The function remains in the catalog for historical
-- rollback compatibility, but no runtime role may execute it.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

revoke execute on function public.couranr_decide_activation(uuid,uuid,boolean,text)
  from service_role;

commit;
