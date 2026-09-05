-- Couranr hosted-request adversarial closure
-- Safety evidence is monotonic across customer intake -> merchant validation.
-- A specific customer-declared restricted class may be confirmed or escalated
-- to unknown, but it cannot be silently erased/reclassified before review.

begin;

create or replace function private.couranr_preserve_hosted_customer_safety_evidence()
returns trigger
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_customer_class text;
begin
  if old.source='hosted_request'
     and old.requester_kind='consumer'
     and old.business_account_id is null
     and old.request_state='awaiting_merchant_confirmation'
     and new.restricted_class is distinct from old.restricted_class then

    select customer_restricted_class
      into v_customer_class
      from public.couranr_hosted_request_intakes
     where request_id=old.id;

    if v_customer_class is not null
       and v_customer_class not in ('none','unknown')
       and new.restricted_class not in (v_customer_class,'unknown') then
      raise exception 'hosted_customer_safety_evidence_conflict'
        using errcode='CR409';
    end if;
  end if;

  return new;
end
$fn$;

drop trigger if exists couranr_preserve_hosted_customer_safety_evidence
  on public.couranr_delivery_requests;
create trigger couranr_preserve_hosted_customer_safety_evidence
before update of restricted_class
on public.couranr_delivery_requests
for each row
execute function private.couranr_preserve_hosted_customer_safety_evidence();

revoke all on function private.couranr_preserve_hosted_customer_safety_evidence()
  from public,anon,authenticated,service_role;
grant execute on function private.couranr_preserve_hosted_customer_safety_evidence()
  to service_role;

commit;
