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

/*
 * Hosted status reads need one special property the generic issuer does not
 * provide: "issue only if no live token exists." A read endpoint can be called
 * concurrently by two tabs. The old count-then-issue sequence let both observe
 * zero and then revoke each other's token. This command serializes by request
 * and either inserts exactly one new credential or returns false without
 * touching the existing live one.
 */
create or replace function public.couranr_issue_hosted_tracking_if_absent(
  p_request_id uuid,
  p_token_hash text,
  p_ttl_days integer
)
returns boolean
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_host_business_id uuid;
  v_ttl integer:=least(greatest(coalesce(p_ttl_days,30),1),30);
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}
 then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR422';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('couranr-hosted-tracking:'||p_request_id::text)
  );

  select r.* into v_req
    from public.couranr_delivery_requests r
   where r.id=p_request_id
     and r.source='hosted_request'
     and r.requester_kind='consumer'
     and r.business_account_id is null;
  if not found then
    raise exception 'request_not_found' using errcode='CR404';
  end if;
  if v_req.request_state<>'confirmed' then
    raise exception 'request_not_trackable' using errcode='CR409';
  end if;

  if exists (
    select 1
      from public.couranr_delivery_access_tokens t
     where t.request_id=p_request_id
       and t.revoked_at is null
       and t.expires_at>now()
  ) then
    return false;
  end if;

  select h.host_business_account_id
    into v_host_business_id
    from public.couranr_hosted_request_intakes h
   where h.request_id=p_request_id;
  if v_host_business_id is null then
    raise exception 'hosted_relationship_not_found' using errcode='CR404';
  end if;

  insert into public.couranr_delivery_access_tokens(
    request_id,business_account_id,token_hash,audience,expires_at
  ) values (
    p_request_id,v_host_business_id,p_token_hash,
    'recipient',now()+make_interval(days=>v_ttl)
  );

  return true;
end
$fn$;

revoke all on function public.couranr_issue_hosted_tracking_if_absent(uuid,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_issue_hosted_tracking_if_absent(uuid,text,integer)
  to service_role;

commit;
