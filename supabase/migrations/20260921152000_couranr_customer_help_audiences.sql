-- One-delivery Help remains the existing conversation/message command system.
-- Sender and recipient get separate threads so neither reads the other's
-- private reports or Operations replies. Direct Consumer has no fake tenant.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$ begin
  if to_regclass('public.couranr_help_access_tokens') is null
     or to_regclass('public.couranr_conversations') is null
     or to_regclass('public.couranr_delivery_access_tokens') is null then
    raise exception 'customer_help_audiences_unknown_schema';
  end if;
  if not exists(select 1 from pg_indexes
                 where schemaname='public' and tablename='couranr_conversations'
                   and indexname='couranr_cv_one_thread_per_delivery_kind') then
    raise exception 'customer_help_audiences_unknown_unique_index';
  end if;
end $$;

alter table public.couranr_help_access_tokens
  add column audience text not null default 'legacy';
alter table public.couranr_help_access_tokens
  add constraint couranr_hat_audience_chk check(audience in ('legacy','sender','recipient'));
alter table public.couranr_help_access_tokens
  alter column business_account_id drop not null;

alter table public.couranr_conversations
  add column customer_audience text not null default 'legacy';
alter table public.couranr_conversations
  add constraint couranr_cv_customer_audience_chk
  check(customer_audience in ('legacy','sender','recipient'));
alter table public.couranr_conversations
  alter column business_account_id drop not null;

-- Existing one-thread-per-delivery rows are all `legacy`, so this index
-- preserves their identity while allowing one sender and one recipient Help
-- thread. Delivery chat still has one row because it always uses legacy.
drop index public.couranr_cv_one_thread_per_delivery_kind;
create unique index couranr_cv_one_thread_per_delivery_kind
  on public.couranr_conversations(delivery_id,kind,customer_audience)
  where delivery_id is not null;

create or replace function private.couranr_help_null_tenant_guard()
returns trigger language plpgsql security invoker set search_path=''
as $fn$
begin
  if new.business_account_id is null and not exists(
    select 1 from public.couranr_deliveries d
    join public.couranr_delivery_requests r on r.id=d.request_id
    where d.id=new.delivery_id and d.business_account_id is null
      and r.requester_kind='consumer' and r.business_account_id is null
  ) then
    raise exception 'help_tenant_scope_required' using errcode='CR409';
  end if;
  if tg_table_name='couranr_conversations' then
    if new.business_account_id is null and new.kind<>'delivery_help' then
      raise exception 'help_tenant_scope_required' using errcode='CR409';
    end if;
  end if;
  return new;
end
$fn$;
create trigger couranr_hat_null_tenant_guard before insert or update of business_account_id,delivery_id
  on public.couranr_help_access_tokens for each row
  execute function private.couranr_help_null_tenant_guard();
create trigger couranr_cv_null_tenant_guard before insert or update of business_account_id,delivery_id
  on public.couranr_conversations for each row
  execute function private.couranr_help_null_tenant_guard();

-- The existing merchant/hosted delivery-chat command must infer the new
-- three-key index. All tenant/participant semantics are retained verbatim.
create or replace function public.couranr_ensure_delivery_chat(p_delivery_id uuid)
returns uuid language plpgsql security invoker set search_path=''
as $fn$
declare
  v_business_account_id uuid;
  v_request_id uuid;
  v_conversation_id uuid;
begin
  select d.business_account_id,d.request_id into v_business_account_id,v_request_id
    from public.couranr_deliveries d where d.id=p_delivery_id;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;
  if v_business_account_id is null then
    select h.host_business_account_id into v_business_account_id
      from public.couranr_hosted_request_intakes h
      join public.couranr_delivery_requests r on r.id=h.request_id
     where h.request_id=v_request_id and r.source='hosted_request'
       and r.requester_kind='consumer' and r.business_account_id is null;
  end if;
  if v_business_account_id is null then return null; end if;
  insert into public.couranr_conversations(
    kind,business_account_id,delivery_id,status,urgency,due_state,customer_audience
  ) values ('delivery_chat',v_business_account_id,p_delivery_id,'open','routine','on_time','legacy')
  on conflict (delivery_id,kind,customer_audience) where delivery_id is not null do nothing;
  select c.id into v_conversation_id from public.couranr_conversations c
   where c.delivery_id=p_delivery_id and c.kind='delivery_chat' and c.customer_audience='legacy';
  if v_conversation_id is null then raise exception 'delivery_chat_issue_failed' using errcode='CR422'; end if;
  insert into public.couranr_conversation_participants(
    conversation_id,participant_kind,user_id,member_role
  ) select v_conversation_id,'merchant',bm.user_id,bm.role
      from public.business_members bm
     where bm.business_account_id=v_business_account_id and bm.status='active'
       and bm.role in ('owner','manager','dispatcher')
       and not exists(select 1 from public.couranr_conversation_participants p
                       where p.conversation_id=v_conversation_id and p.user_id=bm.user_id
                         and p.participant_kind='merchant' and p.left_at is null);
  return v_conversation_id;
end
$fn$;

create or replace function public.couranr_redeem_help_token(p_token_hash text)
returns table(out_token_id uuid,out_delivery_id uuid,out_conversation_id uuid)
language plpgsql security definer set search_path=''
as $fn$
declare
  v_token public.couranr_help_access_tokens;
  v_conversation uuid;
  v_participant uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;
  select t.* into v_token from public.couranr_help_access_tokens t
   where t.token_hash=p_token_hash;
  if not found or v_token.revoked_at is not null or v_token.expires_at<=now() then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;
  insert into public.couranr_conversations(
    kind,business_account_id,delivery_id,status,customer_audience
  ) values ('delivery_help',v_token.business_account_id,v_token.delivery_id,'open',v_token.audience)
  on conflict (delivery_id,kind,customer_audience) where delivery_id is not null do nothing;
  select c.id into v_conversation from public.couranr_conversations c
   where c.delivery_id=v_token.delivery_id and c.kind='delivery_help'
     and c.customer_audience=v_token.audience;
  if v_conversation is null then raise exception 'help_link_not_available' using errcode='CR404'; end if;
  insert into public.couranr_conversation_participants(
    conversation_id,participant_kind,user_id,access_token_id
  ) values (v_conversation,'customer',null,v_token.id)
  on conflict (conversation_id,access_token_id) where left_at is null
    and access_token_id is not null do nothing;
  select p.id into v_participant from public.couranr_conversation_participants p
   where p.conversation_id=v_conversation and p.access_token_id=v_token.id and p.left_at is null;
  if v_participant is null then raise exception 'help_link_not_available' using errcode='CR404'; end if;
  update public.couranr_help_access_tokens set last_used_at=now() where id=v_token.id;
  return query select v_token.id,v_token.delivery_id,v_conversation;
end
$fn$;

-- Keep the Operations manual issuer and hosted relationship semantics. A
-- tenantless direct Consumer must use an audience-bound sender/recipient
-- issuer; a legacy token could otherwise be handed to a recipient and expose
-- payer cancellation controls.
create or replace function public.couranr_issue_help_token(
  p_delivery_id uuid,p_token_hash text,p_ttl_days integer default 14
)
returns uuid language plpgsql security definer set search_path=''
as $fn$
declare v_business uuid; v_request uuid; v_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR400';
  end if;
  select d.business_account_id,d.request_id into v_business,v_request
    from public.couranr_deliveries d where d.id=p_delivery_id;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;
  if v_business is null then
    select h.host_business_account_id into v_business
      from public.couranr_hosted_request_intakes h
      join public.couranr_delivery_requests r on r.id=h.request_id
     where h.request_id=v_request and r.source='hosted_request'
       and r.requester_kind='consumer' and r.business_account_id is null;
  end if;
  if v_business is null then
    raise exception 'customer_help_audience_required' using errcode='CR409';
  end if;
  insert into public.couranr_help_access_tokens(
    delivery_id,business_account_id,token_hash,expires_at,audience
  ) values (p_delivery_id,v_business,p_token_hash,
            now()+make_interval(days=>least(greatest(coalesce(p_ttl_days,14),1),30)),'legacy')
  returning id into v_id;
  return v_id;
end
$fn$;

create function public.couranr_issue_customer_help_token(
  p_source_kind text,p_source_token_hash text,p_help_token_hash text
)
returns uuid language plpgsql security invoker set search_path=''
as $fn$
declare
  v_request uuid; v_delivery uuid; v_business uuid; v_audience text; v_id uuid;
begin
  if p_source_token_hash is null or p_source_token_hash !~ '^[0-9a-f]{64}$'
     or p_help_token_hash is null or p_help_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'help_source_not_available' using errcode='CR404';
  end if;
  if p_source_kind='sender_guest' then
    select s.request_id into v_request from public.couranr_consumer_guest_sessions s
     where s.token_hash=p_source_token_hash and s.revoked_at is null and s.expires_at>now();
    v_audience:='sender';
  elsif p_source_kind='recipient_tracking' then
    select t.request_id into v_request from public.couranr_delivery_access_tokens t
     where t.token_hash=p_source_token_hash and t.audience='recipient'
       and t.revoked_at is null and t.expires_at>now();
    v_audience:='recipient';
  else
    raise exception 'help_source_not_available' using errcode='CR404';
  end if;
  if v_request is null then raise exception 'help_source_not_available' using errcode='CR404'; end if;
  if p_source_kind='sender_guest' and not exists (
    select 1 from public.couranr_delivery_requests r
     where r.id=v_request and r.requester_kind='consumer'
       and r.business_account_id is null and r.source='consumer_send'
  ) then
    raise exception 'help_source_not_available' using errcode='CR404';
  end if;
  select d.id,d.business_account_id into v_delivery,v_business
    from public.couranr_deliveries d where d.request_id=v_request;
  if v_delivery is null then raise exception 'help_not_open_before_delivery' using errcode='CR409'; end if;
  if v_business is null then
    select h.host_business_account_id into v_business
      from public.couranr_hosted_request_intakes h
      join public.couranr_delivery_requests r on r.id=h.request_id
     where h.request_id=v_request and r.source='hosted_request'
       and r.requester_kind='consumer' and r.business_account_id is null;
  end if;
  insert into public.couranr_help_access_tokens(
    delivery_id,business_account_id,token_hash,expires_at,audience
  ) values(v_delivery,v_business,p_help_token_hash,now()+interval '14 days',v_audience)
  returning id into v_id;
  return v_id;
end
$fn$;

-- Recipient Help is evidence/reporting authority, never payer cancellation.
create function private.couranr_recipient_help_resolution_guard()
returns trigger language plpgsql security definer set search_path=''
as $fn$
begin
  if new.event_type='help_resolution_requested' and exists(
    select 1 from public.couranr_conversation_messages m
    join public.couranr_conversation_participants p on p.id=m.author_participant_id
    join public.couranr_help_access_tokens t on t.id=p.access_token_id
    where m.id=new.message_id and t.audience='recipient'
  ) then
    raise exception 'recipient_cannot_request_financial_resolution' using errcode='CR403';
  end if;
  return new;
end
$fn$;
create trigger couranr_recipient_help_resolution_guard
  before insert on public.couranr_conversation_events
  for each row execute function private.couranr_recipient_help_resolution_guard();

revoke all on function public.couranr_issue_customer_help_token(text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_issue_customer_help_token(text,text,text) to service_role;
revoke all on function private.couranr_help_null_tenant_guard() from public,anon,authenticated;
revoke all on function private.couranr_recipient_help_resolution_guard() from public,anon,authenticated;
commit;
