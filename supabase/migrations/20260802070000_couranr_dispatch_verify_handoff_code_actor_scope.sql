/*
 * SECURITY FIX: PIN verification was not scoped to the caller.
 *
 * `couranr_verify_handoff_code(p_delivery_id, p_code_kind, p_code_digest)` took
 * no actor and checked no assignment. The TypeScript wrapper accepted a
 * `userId` and never passed it — it appeared in the type signature and nowhere
 * in the body.
 *
 * So any AUTHENTICATED user who knew a delivery's UUID could submit guesses
 * against that delivery's credential. Five wrong ones lock it, and a locked
 * credential stays locked until someone regenerates it: a one-request denial
 * of service against a real delivery in progress, performed by anyone with an
 * account. A lucky guess would have consumed the credential outright — one in
 * 200,000 across five attempts per delivery, which is not a number to accept
 * when the fix is free.
 *
 * Fixed HERE rather than in TypeScript. The attempt counter is the entire
 * safety argument for a six-digit code, so the check that protects it must be
 * inside the same transaction that increments it. A guard in the wrapper would
 * be one refactor away from being bypassed by a second caller.
 *
 * `couranr_driver_assignment_for` raises CR403 `not_your_delivery` for a
 * caller with no driver profile, no active assignment, or an assignment on a
 * different delivery — all three identical — so a stranger's attempt never
 * reaches the counter at all.
 *
 * The three-argument function is DROPPED, not left beside the new one. Adding
 * a parameter creates an overload, and the insecure signature would have
 * stayed callable.
 *
 * Found by an adversarial read of the API integration, not by a test — the
 * suite was green. The behavioural proof belongs in Group Q.
 */

drop function if exists public.couranr_verify_handoff_code(uuid, text, text);

create or replace function public.couranr_verify_handoff_code(
  p_delivery_id   uuid,
  p_code_kind     text,
  p_code_digest   text,
  p_actor_user_id uuid
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

  -- The gate. Raises CR403 before any row is read or any counter moves.
  perform public.couranr_driver_assignment_for(p_delivery_id, p_actor_user_id);

  select * into v_row from public.couranr_handoff_codes
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind
     and code_state in ('active', 'locked')
   order by generation desc
   limit 1
   for update;

  if not found then
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

revoke all on function public.couranr_verify_handoff_code(uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.couranr_verify_handoff_code(uuid, text, text, uuid) from service_role;
grant execute on function public.couranr_verify_handoff_code(uuid, text, text, uuid) to service_role;
