-- Roll back the withdrawn-proof-method conversion backstop.
--
-- REFUSES ON EVIDENCE. Restoring the unguarded functions would let a historical
-- leave_at_door request materialize a delivery with no customer authorization —
-- the exact hole the forward migration closed. If any such request still exists
-- without a delivery, this refuses and requires rolling forward.
--
-- The function bodies are not restored here: reverting them by hand would risk
-- reproducing a stale commercial snapshot, and both are replaced by name on the
-- way forward anyway.

begin;

do $$
declare v_at_risk integer;
begin
  select count(*) into v_at_risk
  from public.couranr_delivery_requests r
  where r.proof_method not in ('photo_or_pin','signature')
    and not exists (select 1 from public.couranr_deliveries d where d.request_id = r.id);

  if v_at_risk > 0 then
    raise exception using
      errcode = 'CR409',
      message = 'withdrawn_proof_method_conversion_rollback_refused',
      detail = format('requests that could still materialize: %s', v_at_risk),
      hint = 'Removing this guard would let those become deliveries with no '
             'customer authorization. Roll forward.';
  end if;
end $$;

commit;
