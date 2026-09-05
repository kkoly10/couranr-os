-- Hosted Consumer deliveries keep commercial business_account_id NULL. Delivery
-- Help still needs a non-null relationship scope because the existing help-token
-- and conversation schema are tenant-scoped. Derive that scope from the durable
-- hosted intake; do not fabricate merchant tenancy onto the request/delivery.
--
-- Direct Consumer Same Day remains unchanged: it has no merchant relationship,
-- so this legacy tenant-scoped help issuer still refuses it. /send owns that
-- broader product gap separately and remains production-disabled.

begin;

create or replace function public.couranr_issue_help_token(
  p_delivery_id uuid,
  p_token_hash text,
  p_ttl_days integer default 14
)
returns uuid
language plpgsql
security definer
set search_path=''
as $fn$
declare
  v_business uuid;
  v_request_id uuid;
  v_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR400';
  end if;

  select d.business_account_id,d.request_id
    into v_business,v_request_id
    from public.couranr_deliveries d
   where d.id=p_delivery_id;
  if not found then
    raise exception 'delivery_not_found' using errcode='CR404';
  end if;

  if v_business is null then
    select h.host_business_account_id
      into v_business
      from public.couranr_hosted_request_intakes h
      join public.couranr_delivery_requests r on r.id=h.request_id
     where h.request_id=v_request_id
       and r.source='hosted_request'
       and r.requester_kind='consumer'
       and r.business_account_id is null;
  end if;

  if v_business is null then
    raise exception 'delivery_not_found' using errcode='CR404';
  end if;

  insert into public.couranr_help_access_tokens(
    delivery_id,business_account_id,token_hash,expires_at
  )
  values(
    p_delivery_id,v_business,p_token_hash,
    now()+make_interval(days=>greatest(1,p_ttl_days))
  )
  returning id into v_id;

  return v_id;
end
$fn$;

revoke all on function public.couranr_issue_help_token(uuid,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_issue_help_token(uuid,text,integer)
  to service_role;

commit;
