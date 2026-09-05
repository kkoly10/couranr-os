-- Restore the pre-hosted Delivery Help issuer. Existing help-token rows and
-- conversations are retained; only future issuance behavior changes.

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
  v_id uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'token_hash_must_be_sha256_hex' using errcode='CR400';
  end if;
  select d.business_account_id into v_business
    from public.couranr_deliveries d where d.id=p_delivery_id;
  if v_business is null then
    raise exception 'delivery_not_found' using errcode='CR404';
  end if;
  insert into public.couranr_help_access_tokens
    (delivery_id,business_account_id,token_hash,expires_at)
  values
    (p_delivery_id,v_business,p_token_hash,
     now()+make_interval(days=>greatest(1,p_ttl_days)))
  returning id into v_id;
  return v_id;
end
$fn$;

revoke all on function public.couranr_issue_help_token(uuid,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_issue_help_token(uuid,text,integer)
  to service_role;

commit;
