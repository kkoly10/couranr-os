-- Rollback retired merchant contact self-verification authority.
begin;

grant execute on function public.couranr_verify_activation_contact(uuid,uuid)
  to service_role;

commit;
