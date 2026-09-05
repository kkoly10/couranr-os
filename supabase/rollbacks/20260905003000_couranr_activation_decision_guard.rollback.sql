-- Rollback for MER-003 activation authority hardening.
--
-- Forward migration is additive and leaves the legacy command intact, so the
-- inverse only removes the guarded cutover command.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

drop function public.couranr_decide_activation_guarded(uuid,uuid,boolean,text);

commit;
