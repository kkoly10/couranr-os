-- Rollback for 20260802070000_couranr_dispatch_verify_handoff_code_actor_scope.
--
-- Restores the PREVIOUS definition of each function this migration replaced.
-- Dropping them would remove behaviour an earlier migration created and that
-- live code still calls; the bodies below are copied verbatim from the
-- migration named against each one.

begin;

-- couranr_verify_handoff_code: restored from 20260802050000_couranr_dispatch_driver_execution_commands.sql
create or replace function public.couranr_verify_handoff_code(
  p_delivery_id uuid,
  p_code_kind   text,
  p_code_digest text
)
returns public.couranr_pin_attempt_result
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_row public.couranr_handoff_codes;
  v_out public.couranr_pin_attempt_result;
begin
  if p_code_kind not in ('merchant_pickup', 'recipient_dropoff') then
    raise exception 'unknown_code_kind' using errcode = 'CR400';
  end if;

  select * into v_row from public.couranr_handoff_codes
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind
     and code_state in ('active', 'locked')
   order by generation desc
   limit 1
   for update;

  if not found then
    -- Nothing issued, or every generation superseded. Indistinguishable from
    -- expiry on purpose: neither tells the holder anything actionable.
    v_out := row('expired', p_code_kind, null)::public.couranr_pin_attempt_result;
    return v_out;
  end if;

  if v_row.code_state = 'locked' then
    return row('locked', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  if v_row.expires_at <= now() then
    update public.couranr_handoff_codes
       set code_state = 'expired', version = version + 1, updated_at = now()
     where id = v_row.id;
    return row('expired', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  if p_code_digest is not null and p_code_digest = v_row.code_digest then
    -- Consuming is idempotent from the caller's side: a repeated correct code
    -- returns `accepted` again, and the TRANSITION guard elsewhere is what
    -- stops the state moving twice.
    update public.couranr_handoff_codes
       set code_state = 'consumed',
           consumed_at = coalesce(consumed_at, now()),
           last_attempt_at = now(),
           version = version + 1,
           updated_at = now()
     where id = v_row.id;
    return row('accepted', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;

  update public.couranr_handoff_codes
     set failed_attempts = failed_attempts + 1,
         last_attempt_at = now(),
         code_state = case when failed_attempts + 1 >= 5 then 'locked' else code_state end,
         locked_at  = case when failed_attempts + 1 >= 5 then now() else locked_at end,
         version = version + 1,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if v_row.code_state = 'locked' then
    return row('locked', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
  end if;
  return row('invalid', p_code_kind, v_row.generation)::public.couranr_pin_attempt_result;
end $fn$;

commit;
