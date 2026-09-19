-- Roll back promotional-credit readiness parity.
--
-- Restores the prior rule: marking a Business delivery ready requires a live
-- Stripe authorization matching the current quote. Use only for rollback
-- rehearsal; it intentionally reintroduces the credited-readiness gap.
begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

create or replace function public.couranr_apply_readiness(
  p_request_id uuid,
  p_business_account_id uuid,
  p_expected_version integer,
  p_actor_user_id uuid,
  p_command text,
  p_to text,
  p_from text[]
)
returns public.couranr_delivery_requests
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_ob public.couranr_payment_obligations;
  v_before text;
begin
  select * into v_req
    from public.couranr_delivery_requests
   where id=p_request_id
     and business_account_id is not distinct from p_business_account_id;

  if not found then
    raise exception 'request_not_found' using errcode='CR404';
  end if;

  perform public.couranr_assert_readiness_mutable(p_request_id);

  if v_req.request_state<>'confirmed' then
    raise exception 'request_not_confirmed' using errcode='CR409';
  end if;

  if p_to='ready' then
    select * into v_ob
      from public.couranr_payment_obligations
     where request_id=v_req.id
       and payment_state<>'cancelled'
     limit 1;

    if not found or v_ob.payment_state<>'authorized' then
      raise exception 'payment_not_authorized' using errcode='CR409';
    end if;

    if v_ob.quote_version_id is distinct from v_req.current_quote_version_id then
      raise exception 'authorization_does_not_match_current_quote' using errcode='CR409';
    end if;
  end if;

  v_before:=v_req.readiness_state;

  update public.couranr_delivery_requests
     set readiness_state=p_to,
         version=p_expected_version+1,
         updated_at=now()
   where id=v_req.id
     and version=p_expected_version
     and readiness_state=any(p_from)
  returning * into v_req;

  if not found then
    raise exception 'version_or_state_conflict' using errcode='CR409';
  end if;

  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,
    case when v_req.requester_kind='business' then 'merchant' else 'customer' end,
    p_command,v_before,p_to,
    jsonb_build_object(
      'readinessFrom',v_before,
      'readinessTo',p_to,
      'readinessMeaning','pickup',
      'requestState',v_req.request_state,
      'quoteVersionId',v_req.current_quote_version_id
    )
  );

  return v_req;
end
$fn$;

revoke all on function public.couranr_apply_readiness(
  uuid, uuid, integer, uuid, text, text, text[]
) from public, anon, authenticated, service_role;

grant execute on function public.couranr_apply_readiness(
  uuid, uuid, integer, uuid, text, text, text[]
) to service_role;

commit;
