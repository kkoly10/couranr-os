-- Roll back 20260904155724_couranr_consumer_readiness_parity.
-- readiness_state itself predates this migration. Only the new guest-scoped
-- command is removed, and only if it has not written canonical audit evidence.
begin;
do $$
begin
  if exists(
    select 1 from public.couranr_delivery_request_events
     where actor_type='customer'
       and command in ('mark_delivery_ready','mark_delivery_not_ready')
       and coalesce((metadata->>'guestSessionScoped')::boolean,false)
  ) then
    raise exception 'refusing to remove consumer readiness writer: audit evidence exists';
  end if;
end $$;
drop function if exists public.couranr_set_consumer_pickup_readiness(uuid,text) restrict;
commit;
