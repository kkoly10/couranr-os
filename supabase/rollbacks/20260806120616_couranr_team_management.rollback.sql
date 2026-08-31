-- Rollback for 20260806120000_couranr_team_management.
--
-- Drops the commands, then the audit table with RESTRICT.
--
-- RESTRICT is deliberate and is the same fail-safe the private/analytics
-- rollback uses: `couranr_team_events` is an AUDIT TRAIL. If it has recorded
-- real membership changes, dropping it destroys the only record of who was
-- given or denied access and when. This script refuses in that case, and
-- whether to lose that history becomes a decision for a person rather than
-- something a rollback does quietly.
--
-- To roll back a populated table, export the rows first and then drop it by
-- hand — deliberately, with the export in front of you.
--
-- Nothing here touches `business_members` or `business_accounts`: the forward
-- migration only added functions that write them, so removing the functions
-- removes the capability and leaves every row exactly as it is.

begin;

drop function if exists public.couranr_update_workspace_profile(uuid, uuid, text, text, jsonb, text, text);
drop function if exists public.couranr_reactivate_member(uuid, uuid, uuid);
drop function if exists public.couranr_disable_member(uuid, uuid, uuid);
drop function if exists public.couranr_change_member_role(uuid, uuid, uuid, text);
drop function if exists public.couranr_accept_member_invite(uuid, uuid);
drop function if exists public.couranr_invite_member(uuid, uuid, uuid, text, text);
drop function if exists public.couranr_require_active_member(uuid, uuid);
drop function if exists public.couranr_lock_and_count_active_owners(uuid);

-- Fails if the audit table holds anything a dependent object needs, and is
-- the point at which a populated trail stops the rollback.
drop table if exists public.couranr_team_events restrict;

commit;
