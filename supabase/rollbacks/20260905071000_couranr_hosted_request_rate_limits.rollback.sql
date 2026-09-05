-- Remove hosted abuse counters and restore the pre-limit session issuer.
-- Submitted request/intake evidence is not modified or deleted.

begin;

drop function if exists public.couranr_claim_hosted_place_search(uuid);

create or replace function public.couranr_create_hosted_request_intake(
  p_slug text,
  p_token_hash text,
  p_ttl_minutes integer
)
returns public.couranr_hosted_request_intakes
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_host record;
  v_row public.couranr_hosted_request_intakes;
  v_slug text:=lower(btrim(coalesce(p_slug,'')));
  v_ttl integer:=least(greatest(coalesce(p_ttl_minutes,1440),5),1440);
begin
  if v_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(v_slug)>120 then
    raise exception 'hosted_merchant_not_found' using errcode='CR404';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'hosted_token_invalid' using errcode='CR404';
  end if;

  select * into v_host
    from public.couranr_resolve_hosted_request_merchant(v_slug);
  if not found then
    raise exception 'hosted_merchant_not_found' using errcode='CR404';
  end if;

  insert into public.couranr_hosted_request_intakes(
    host_business_account_id,host_slug_snapshot,token_hash,expires_at
  ) values (
    v_host.business_account_id,v_slug,p_token_hash,now()+make_interval(mins=>v_ttl)
  )
  returning * into v_row;

  return v_row;
end
$fn$;

revoke all on function public.couranr_create_hosted_request_intake(text,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_create_hosted_request_intake(text,text,integer)
  to service_role;

alter table public.couranr_hosted_request_intakes
  drop constraint if exists couranr_hri_places_count_chk,
  drop column if exists places_request_count,
  drop column if exists places_window_started_at;

commit;
