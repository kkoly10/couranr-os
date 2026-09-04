-- Rollback for handoff-code generation CAS.
--
-- The forward migration is additive and leaves the legacy five-argument
-- issuance command intact for deployment compatibility. Its true inverse is
-- therefore only to remove the new CAS command.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

drop function public.couranr_issue_handoff_code_cas(uuid,text,integer,text,uuid,integer);

commit;
