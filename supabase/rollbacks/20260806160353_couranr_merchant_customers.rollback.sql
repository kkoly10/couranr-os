-- Rollback for 20260806160000_couranr_merchant_customers.
--
-- RESTRICT on both tables, the same fail-safe as the other rollbacks: these
-- rows are the MERCHANT'S OWN customer records — names, contacts, saved
-- destinations and their private notes. If any exist, dropping the tables
-- destroys data the merchant entered and that Couranr does not own. This
-- refuses in that case and the decision becomes a person's.
--
-- Addresses are dropped first because they reference customers.
--
-- Nothing here touches couranr_delivery_requests: the recipient snapshots on
-- submitted requests are documented as immutable and were never modified by
-- the forward migration, so the delivery history survives a rollback intact.

begin;

drop function if exists public.couranr_add_customer_address(uuid, uuid, uuid, text, jsonb, text);
drop function if exists public.couranr_set_customer_archived(uuid, uuid, uuid, boolean);
drop function if exists public.couranr_update_merchant_customer(uuid, uuid, uuid, integer, text, text, text, text, text, text, text);
drop function if exists public.couranr_create_merchant_customer(uuid, uuid, text, text, text, text, text, text, text);

drop table if exists public.customer_addresses restrict;
drop table if exists public.merchant_customers restrict;

commit;
