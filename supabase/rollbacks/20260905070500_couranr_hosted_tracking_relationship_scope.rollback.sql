-- Restore the pre-hosted tracking-token issuer. Existing tracking tokens are
-- retained; only future token relationship scope changes.

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

  update public.couranr_delivery_access_tokens t
     set revoked_at=now(), revoked_reason='replaced_by_new_link'
   where t.request_id=p_request_id
     and t.revoked_at is null;

  insert into public.couranr_delivery_access_tokens(
    request_id,business_account_id,token_hash,audience,expires_at
  ) values (
    v_req.id,v_req.business_account_id,p_token_hash,
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
