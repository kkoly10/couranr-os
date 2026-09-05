-- Roll back only the additional hosted customer safety trigger.
-- No hosted request/intake data is modified or deleted.

begin;

drop trigger if exists couranr_preserve_hosted_customer_safety_evidence
  on public.couranr_delivery_requests;
drop function if exists private.couranr_preserve_hosted_customer_safety_evidence();

commit;
