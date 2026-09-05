-- Rollback for retiring the legacy activation decision entrypoint.
begin;

grant execute on function public.couranr_decide_activation(uuid,uuid,boolean,text)
  to service_role;

commit;
