-- Hosted Consumer deliveries are Consumer-owned and keep delivery.business_account_id NULL.
-- That is correct commercial tenancy, but a hosted delivery still has a real merchant
-- relationship that must survive into delivery_chat. Derive the conversation scope
-- from couranr_hosted_request_intakes rather than forging merchant tenancy.

begin;

create or replace function public.couranr_ensure_delivery_chat(
  p_delivery_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_business_account_id uuid;
  v_request_id uuid;
  v_conversation_id uuid;
begin
  select d.business_account_id,d.request_id
    into v_business_account_id,v_request_id
    from public.couranr_deliveries d
   where d.id = p_delivery_id;

  if not found then
    raise exception 'delivery_not_found' using errcode = 'CR404';
  end if;

  -- A hosted Consumer delivery has NULL commercial tenancy by design. Its
  -- durable host relationship is the merchant scope for delivery chat.
  if v_business_account_id is null then
    select h.host_business_account_id
      into v_business_account_id
      from public.couranr_hosted_request_intakes h
      join public.couranr_delivery_requests r on r.id=h.request_id
     where h.request_id=v_request_id
       and r.source='hosted_request'
       and r.requester_kind='consumer'
       and r.business_account_id is null;
  end if;

  -- Direct Consumer Same Day has no merchant. Keep its existing behavior:
  -- customer communication remains on the delivery-help token surface.
  if v_business_account_id is null then
    return null;
  end if;

  insert into public.couranr_conversations(
    kind,business_account_id,delivery_id,status,urgency,due_state
  )
  values (
    'delivery_chat',v_business_account_id,p_delivery_id,'open','routine','on_time'
  )
  on conflict (delivery_id, kind) where delivery_id is not null
  do nothing;

  select c.id
    into v_conversation_id
    from public.couranr_conversations c
   where c.delivery_id=p_delivery_id
     and c.kind='delivery_chat';

  if v_conversation_id is null then
    raise exception 'delivery_chat_issue_failed' using errcode='CR422';
  end if;

  insert into public.couranr_conversation_participants(
    conversation_id,participant_kind,user_id,member_role
  )
  select
    v_conversation_id,'merchant',bm.user_id,bm.role
  from public.business_members bm
  where bm.business_account_id=v_business_account_id
    and bm.status='active'
    and bm.role in ('owner','manager','dispatcher')
    and not exists (
      select 1
        from public.couranr_conversation_participants p
       where p.conversation_id=v_conversation_id
         and p.user_id=bm.user_id
         and p.participant_kind='merchant'
         and p.left_at is null
    );

  return v_conversation_id;
end
$fn$;

create or replace function public.couranr_reconcile_delivery_chats()
returns table(deliveries_checked integer, active_drivers_checked integer)
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_delivery record;
  v_assignment record;
  v_deliveries integer := 0;
  v_drivers integer := 0;
begin
  for v_delivery in
    select d.id
      from public.couranr_deliveries d
     where d.business_account_id is not null
        or exists (
          select 1
            from public.couranr_hosted_request_intakes h
            join public.couranr_delivery_requests r on r.id=h.request_id
           where h.request_id=d.request_id
             and r.source='hosted_request'
             and r.requester_kind='consumer'
             and r.business_account_id is null
        )
  loop
    perform public.couranr_ensure_delivery_chat(v_delivery.id);
    v_deliveries := v_deliveries + 1;
  end loop;

  for v_assignment in
    select a.delivery_id,a.driver_id
      from public.couranr_delivery_assignments a
      join public.couranr_deliveries d on d.id=a.delivery_id
     where a.assignment_state='active'
       and a.ended_at is null
       and (
         d.business_account_id is not null
         or exists (
           select 1
             from public.couranr_hosted_request_intakes h
             join public.couranr_delivery_requests r on r.id=h.request_id
            where h.request_id=d.request_id
              and r.source='hosted_request'
              and r.requester_kind='consumer'
              and r.business_account_id is null
         )
       )
  loop
    perform public.couranr_join_assignment_delivery_chat(
      v_assignment.delivery_id,v_assignment.driver_id
    );
    v_drivers := v_drivers + 1;
  end loop;

  return query select v_deliveries,v_drivers;
end
$fn$;

revoke all on function public.couranr_ensure_delivery_chat(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_ensure_delivery_chat(uuid) to service_role;

revoke all on function public.couranr_reconcile_delivery_chats()
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_reconcile_delivery_chats() to service_role;

-- Catch any hosted delivery inserted between PR #53 deployment and this correction.
select * from public.couranr_reconcile_delivery_chats();

commit;
