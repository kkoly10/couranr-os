begin;
drop function if exists public.couranr_mark_business_recipient_tracking_notification(text,text);
drop function if exists public.couranr_claim_business_recipient_tracking_delivery(uuid,text,integer);
commit;
