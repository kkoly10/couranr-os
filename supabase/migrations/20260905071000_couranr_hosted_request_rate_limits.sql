-- Hosted-request abuse controls.
--
-- The public funnel cannot rely on an IP address as identity, and Couranr does
-- not need to collect one merely to rate-limit. Use the two identities the
-- product already has:
--   * merchant host relationship -> caps new hosted sessions per hour
--   * opaque hosted intake        -> caps paid address searches per hour
--
-- The global paid-provider budget remains the final cost ceiling. These limits
-- sit BEFORE it so one browser/session cannot consume the entire daily budget.

begin;

alter table public.couranr_hosted_request_intakes
  add column if not exists places_window_started_at timestamptz,
  add column if not exists places_request_count integer not null default 0;

alter table public.couranr_hosted_request_intakes
  drop constraint if exists couranr_hri_places_count_chk;
alter table public.couranr_hosted_request_intakes
  add constraint couranr_hri_places_count_chk
  check (places_request_count >= 0);

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
  v_recent integer;
  c_sessions_per_host_hour constant integer:=60;
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

  -- Serialize the shared host bucket so two concurrent session creates cannot
  -- both observe 59 and become 60 + 61.
  perform pg_advisory_xact_lock(
    hashtext('couranr-hosted-session:'||v_host.business_account_id::text)
  );

  select count(*) into v_recent
    from public.couranr_hosted_request_intakes h
   where h.host_business_account_id=v_host.business_account_id
     and h.created_at > now()-interval '1 hour';

  if v_recent >= c_sessions_per_host_hour then
    raise exception 'hosted_request_rate_limited' using errcode='CR409';
  end if;

  -- Expired, never-submitted sessions are not audit evidence. Prune them
  -- opportunistically so repeated public opens cannot grow this table forever.
  delete from public.couranr_hosted_request_intakes h
   where h.host_business_account_id=v_host.business_account_id
     and h.request_id is null
     and h.expires_at < now()-interval '1 day';

  insert into public.couranr_hosted_request_intakes(
    host_business_account_id,host_slug_snapshot,token_hash,expires_at
  ) values (
    v_host.business_account_id,v_slug,p_token_hash,now()+make_interval(mins=>v_ttl)
  )
  returning * into v_row;

  return v_row;
end
$fn$;

create or replace function public.couranr_claim_hosted_place_search(
  p_intake_id uuid
)
returns boolean
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_row public.couranr_hosted_request_intakes;
  c_places_per_intake_hour constant integer:=12;
begin
  select * into v_row
    from public.couranr_hosted_request_intakes
   where id=p_intake_id
   for update;

  if not found or v_row.expires_at<=now() then
    raise exception 'hosted_request_not_found' using errcode='CR404';
  end if;

  if v_row.places_window_started_at is null
     or v_row.places_window_started_at<=now()-interval '1 hour' then
    update public.couranr_hosted_request_intakes
       set places_window_started_at=now(),
           places_request_count=1,
           last_used_at=now()
     where id=p_intake_id;
    return true;
  end if;

  if v_row.places_request_count >= c_places_per_intake_hour then
    return false;
  end if;

  update public.couranr_hosted_request_intakes
     set places_request_count=places_request_count+1,
         last_used_at=now()
   where id=p_intake_id;

  return true;
end
$fn$;

revoke all on function public.couranr_claim_hosted_place_search(uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_claim_hosted_place_search(uuid)
  to service_role;

-- Preserve the original service-role-only boundary on session creation.
revoke all on function public.couranr_create_hosted_request_intake(text,text,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_create_hosted_request_intake(text,text,integer)
  to service_role;

commit;
