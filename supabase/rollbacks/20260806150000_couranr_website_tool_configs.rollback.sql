-- Rollback for 20260806150000_couranr_website_tool_configs.
--
-- RESTRICT on the table, the same fail-safe the other rollbacks use: the rows
-- hold merchants' own embed designs and publish decisions. If any exist,
-- dropping the table discards work a person did, so this refuses and the
-- choice becomes theirs — export first, then drop by hand.
--
-- Nothing here touches business_accounts: the forward migration only added a
-- table referencing it.

begin;

drop function if exists public.couranr_save_website_tool_config(uuid, uuid, text, text, text, integer, text);

drop table if exists public.couranr_website_tool_configs restrict;

commit;
