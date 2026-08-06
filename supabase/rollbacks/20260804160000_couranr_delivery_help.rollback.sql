-- Rollback for P8-004 Delivery Help.
--
-- DROPS the help-token table. If any Delivery Help link has been issued, this
-- destroys it — every link in a customer's hands stops working, and the
-- messages they sent become unattributable because their participant rows
-- reference these tokens.
--
-- The forward migration is additive: it creates one table and four functions
-- and alters nothing that existed before it. There is no partial state to
-- unwind, so this exists to satisfy the migration-order authority's pairing
-- requirement rather than because reverting is a reasonable operation.
--
-- `restrict` on the table drop is deliberate: couranr_conversation_participants
-- carries a foreign key to it, so the drop FAILS LOUDLY if any customer
-- participant still points at a token. Resolve those rows deliberately rather
-- than letting a cascade remove a customer from their own thread.

begin;

drop function if exists public.couranr_help_post_message(uuid, text, text, text);
drop function if exists public.couranr_help_thread(uuid);
drop function if exists public.couranr_redeem_help_token(text);
drop function if exists public.couranr_issue_help_token(uuid, text, integer);

drop table if exists public.couranr_help_access_tokens restrict;

commit;
