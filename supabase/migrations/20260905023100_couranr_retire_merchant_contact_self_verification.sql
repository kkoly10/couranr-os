-- Retire the merchant self-attestation entrypoint after the manual Operations
-- verification application cutover is READY.
begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

revoke execute on function public.couranr_verify_activation_contact(uuid,uuid)
  from service_role;

commit;
