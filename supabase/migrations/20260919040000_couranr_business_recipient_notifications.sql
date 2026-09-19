begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

create or replace function public.couranr_claim_business_recipient_tracking_delivery(
  p_request_id uuid,p_token_hash text,p_ttl_days integer
)
returns table(outcome text,token_id uuid,expires_at timestamptz)
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_request public.couranr_delivery_requests;
  v_token public.couranr_delivery_access_tokens;
  v_business_id uuid;
  v_ttl integer:=least(greatest(coalesce(p_ttl_days,30),1),30);
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR422';
  end if;
  select r.* into v_request from public.couranr_delivery_requests r where r.id=p_request_id for update;
  if not found or v_request.request_state<>'confirmed'
     or nullif(btrim(coalesce(v_request.recipient_email,'')),'') is null then
    raise exception 'business_recipient_tracking_not_available' using errcode='CR409';
  end if;
  v_business_id:=v_request.business_account_id;
  if v_business_id is null and v_request.source='hosted_request' and v_request.requester_kind='consumer' then
    select h.host_business_account_id into v_business_id from public.couranr_hosted_request_intakes h where h.request_id=v_request.id;
  end if;
  if v_business_id is null then raise exception 'business_recipient_tracking_not_available' using errcode='CR409'; end if;

  select t.* into v_token
    from public.couranr_delivery_access_tokens t
   where t.request_id=v_request.id and t.audience='recipient'
     and t.revoked_at is null and t.expires_at>now()
   order by t.created_at desc limit 1 for update;

  if found and v_token.recipient_notified_at is not null then
    return query select 'sent'::text,v_token.id,v_token.expires_at; return;
  end if;
  if found and v_token.recipient_notification_claimed_at is null then
    return query select 'existing_unclaimed'::text,v_token.id,v_token.expires_at; return;
  end if;
  if found and v_token.recipient_notification_claimed_at>now()-interval '2 minutes' then
    return query select 'in_progress'::text,v_token.id,v_token.expires_at; return;
  end if;
  if found then
    update public.couranr_delivery_access_tokens
       set revoked_at=now(),revoked_reason='business_recipient_notification_claim_expired'
     where id=v_token.id;
  end if;

  insert into public.couranr_delivery_access_tokens(
    request_id,business_account_id,token_hash,audience,expires_at,recipient_notification_claimed_at
  ) values (
    v_request.id,v_business_id,p_token_hash,'recipient',now()+make_interval(days=>v_ttl),now()
  ) returning * into v_token;
  return query select 'issued'::text,v_token.id,v_token.expires_at;
end
$fn$;

create or replace function public.couranr_mark_business_recipient_tracking_notification(
  p_token_hash text,p_provider_id text
)
returns public.couranr_delivery_access_tokens
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_token public.couranr_delivery_access_tokens;
  v_request public.couranr_delivery_requests;
  v_business_id uuid;
  v_provider_id text:=nullif(btrim(coalesce(p_provider_id,'')),'');
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'token_hash_must_be_sha256_hex' using errcode='CR422'; end if;
  if v_provider_id is null then raise exception 'notification_provider_id_required' using errcode='CR422'; end if;

  select t.* into v_token from public.couranr_delivery_access_tokens t where t.token_hash=p_token_hash for update;
  if not found or v_token.revoked_at is not null or v_token.expires_at<=now()
     or v_token.audience<>'recipient' or v_token.recipient_notification_claimed_at is null then
    raise exception 'tracking_token_not_available' using errcode='CR404';
  end if;

  select r.* into v_request from public.couranr_delivery_requests r where r.id=v_token.request_id;
  if not found or v_request.request_state<>'confirmed'
     or nullif(btrim(coalesce(v_request.recipient_email,'')),'') is null then
    raise exception 'recipient_notification_not_allowed' using errcode='CR422';
  end if;
  v_business_id:=v_request.business_account_id;
  if v_business_id is null and v_request.source='hosted_request' and v_request.requester_kind='consumer' then
    select h.host_business_account_id into v_business_id from public.couranr_hosted_request_intakes h where h.request_id=v_request.id;
  end if;
  if v_business_id is null or v_token.business_account_id is distinct from v_business_id then
    raise exception 'recipient_notification_not_allowed' using errcode='CR422';
  end if;

  if v_token.recipient_notified_at is not null then
    if v_token.recipient_notification_provider_id is distinct from v_provider_id then
      raise exception 'recipient_notification_already_recorded' using errcode='CR409';
    end if;
    return v_token;
  end if;
  update public.couranr_delivery_access_tokens
     set recipient_notified_at=now(),recipient_notification_provider_id=v_provider_id
   where id=v_token.id returning * into v_token;
  return v_token;
end
$fn$;

revoke all on function public.couranr_claim_business_recipient_tracking_delivery(uuid,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.couranr_mark_business_recipient_tracking_notification(text,text) from public,anon,authenticated,service_role;
grant execute on function public.couranr_claim_business_recipient_tracking_delivery(uuid,text,integer) to service_role;
grant execute on function public.couranr_mark_business_recipient_tracking_notification(text,text) to service_role;
commit;
