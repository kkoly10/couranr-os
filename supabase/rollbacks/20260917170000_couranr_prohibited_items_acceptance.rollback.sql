-- Roll back prohibited-items acceptance recording.
--
-- REFUSES ON EVIDENCE: once a sender's acceptance of that policy is recorded,
-- removing the column deletes the record of an agreement they were shown. The
-- column is only removable when nothing has been stamped.
--
-- The function bodies are NOT restored here: reverting them would re-point the
-- command at a column this file may have removed, and both are replaced by name
-- on the way forward anyway. Roll forward.

begin;

do $$
declare v_recorded integer;
begin
  select count(*) into v_recorded
  from public.couranr_delivery_requests
  where sender_prohibited_items_version is not null;

  if v_recorded > 0 then
    raise exception using
      errcode = 'CR409',
      message = 'prohibited_items_acceptance_rollback_refused',
      detail = format('recorded acceptances: %s', v_recorded),
      hint = 'Senders have accepted this policy. Removing the column deletes '
             'the record of an agreement they were shown. Roll forward instead.';
  end if;
end $$;

commit;
