-- Rollback for handoff-code generation CAS.
--
-- Restores the prior five-argument command exactly. This intentionally restores
-- its old concurrency behavior too; rollback is the true inverse and should be
-- used only if the application is rolled back with it.

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

drop function public.couranr_issue_handoff_code(uuid,text,integer,text,uuid,integer);

create function public.couranr_issue_handoff_code(
  p_delivery_id   uuid,
  p_code_kind     text,
  p_code_digest   text,
  p_actor_user_id uuid,
  p_ttl_minutes   integer
)
returns public.couranr_handoff_codes
language plpgsql security invoker set search_path = ''
as $fn$
declare
  v_dlv public.couranr_deliveries;
  v_gen integer;
  v_row public.couranr_handoff_codes;
begin
  if p_code_kind not in ('merchant_pickup', 'recipient_dropoff') then
    raise exception 'unknown_code_kind' using errcode = 'CR400';
  end if;
  if p_code_digest !~ '^[0-9a-f]{64}$' then
    raise exception 'digest_required' using errcode = 'CR400';
  end if;
  if p_actor_user_id is null then
    raise exception 'actor_required' using errcode = 'CR403';
  end if;

  select * into v_dlv
    from public.couranr_deliveries
   where id = p_delivery_id
   for update;
  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;
  if v_dlv.fulfillment_state in ('delivered', 'cancelled', 'could_not_deliver') then
    raise exception 'delivery_already_settled' using errcode = 'CR409';
  end if;

  update public.couranr_handoff_codes
     set code_state = 'superseded',
         superseded_at = now(),
         version = version + 1,
         updated_at = now()
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind
     and code_state in ('active', 'locked');

  select coalesce(max(generation), 0) + 1
    into v_gen
    from public.couranr_handoff_codes
   where delivery_id = p_delivery_id
     and code_kind = p_code_kind;

  insert into public.couranr_handoff_codes (
    delivery_id, code_kind, generation, code_digest, code_state,
    issued_by, issued_at, expires_at, failed_attempts
  ) values (
    p_delivery_id, p_code_kind, v_gen, p_code_digest, 'active',
    p_actor_user_id, now(),
    now() + make_interval(mins => greatest(coalesce(p_ttl_minutes, 1440), 5)),
    0
  )
  returning * into v_row;

  return v_row;
end
$fn$;

revoke all on function public.couranr_issue_handoff_code(uuid,text,text,uuid,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_issue_handoff_code(uuid,text,text,uuid,integer)
  to service_role;

commit;
