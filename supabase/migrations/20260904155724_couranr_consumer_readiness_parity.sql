-- Consumer pickup readiness parity for Automatic Fulfillment V1.
-- FND-006: Consumer and Business share the SAME readiness_state vocabulary.
-- This records the guest's explicit pickup-readiness declaration on the
-- canonical request; it does not create a second consumer readiness machine.
begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create or replace function public.couranr_set_consumer_pickup_readiness(
  p_guest_session_id uuid,
  p_readiness text
)
returns public.couranr_delivery_requests
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_consumer_guest_sessions;
  v_req public.couranr_delivery_requests;
  v_before text;
  v_command text;
begin
  if p_readiness not in ('ready','not_ready') then
    raise exception 'consumer_readiness_invalid' using errcode='CR422';
  end if;

  select * into v_session
    from public.couranr_consumer_guest_sessions
   where id=p_guest_session_id
   for update;
  if not found
     or v_session.revoked_at is not null
     or v_session.expires_at<=now()
     or v_session.request_id is null then
    raise exception 'guest_session_not_available' using errcode='CR404';
  end if;

  select * into v_req
    from public.couranr_delivery_requests
   where id=v_session.request_id
     and requester_kind='consumer'
     and business_account_id is null
     and idempotency_scope='consumer:'||v_session.id::text
   for update;
  if not found then
    raise exception 'request_not_found' using errcode='CR404';
  end if;

  if v_req.request_state in ('declined','cancelled','closed') then
    raise exception 'request_not_editable' using errcode='CR409';
  end if;

  -- Idempotent declaration: repeated UI saves and retries do not mint events
  -- or versions when the canonical readiness already says the same thing.
  if v_req.readiness_state=p_readiness then
    return v_req;
  end if;

  v_before:=v_req.readiness_state;
  v_command:=case when p_readiness='ready'
                  then 'mark_delivery_ready'
                  else 'mark_delivery_not_ready' end;

  update public.couranr_delivery_requests
     set readiness_state=p_readiness,
         version=version+1,
         updated_at=now()
   where id=v_req.id
  returning * into v_req;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,null,'customer',v_command,
    v_req.request_state,v_req.request_state,
    jsonb_build_object(
      'readinessBefore',v_before,
      'readinessAfter',p_readiness,
      'source','consumer_send',
      'guestSessionScoped',true
    )
  );

  return v_req;
end
$fn$;

revoke all on function public.couranr_set_consumer_pickup_readiness(uuid,text)
  from public,anon,authenticated;
grant execute on function public.couranr_set_consumer_pickup_readiness(uuid,text)
  to service_role;

commit;
