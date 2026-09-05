-- Hosted Consumer requests keep request.business_account_id NULL. Tracking links
-- still need the sender relationship so the sanitized PUB-006 projection can
-- name the business that is sending the order. Derive that relationship from
-- the immutable hosted intake when issuing the token; do not rewrite request
-- tenancy.

begin;

create or replace function public.couranr_issue_delivery_access_token(
  p_request_id uuid,
  p_token_hash text,
  p_ttl_days integer
)
returns public.couranr_delivery_access_tokens
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_tok public.couranr_delivery_access_tokens;
  v_ttl integer;
  v_relationship_business_id uuid;
begin
  v_ttl := least(greatest(coalesce(p_ttl_days,30),1),30);

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR422';
  end if;

  select r.* into v_req
    from public.couranr_delivery_requests r
   where r.id=p_request_id;
  if not found then
    raise exception 'request_not_found' using errcode='CR404';
  end if;

  if v_req.request_state <> 'confirmed' then
    raise exception 'request_not_trackable' using errcode='CR409';
  end if;

  v_relationship_business_id := v_req.business_account_id;
  if v_relationship_business_id is null
     and v_req.source='hosted_request'
     and v_req.requester_kind='consumer' then
    select h.host_business_account_id
      into v_relationship_business_id
      from public.couranr_hosted_request_intakes h
     where h.request_id=v_req.id;
  end if;

  update public.couranr_delivery_access_tokens t
     set revoked_at=now(), revoked_reason='replaced_by_new_link'
   where t.request_id=p_request_id
     and t.revoked_at is null;

  insert into public.couranr_delivery_access_tokens(
    request_id,business_account_id,token_hash,audience,expires_at
  ) values (
    v_req.id,v_relationship_business_id,p_token_hash,
    'recipient',now()+make_interval(days=>v_ttl)
  )
  returning * into v_tok;

  return v_tok;
end
$fn$;

revoke all on function public.couranr_issue_delivery_access_token(uuid,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_issue_delivery_access_token(uuid,text,integer)
  to service_role;

commit;
