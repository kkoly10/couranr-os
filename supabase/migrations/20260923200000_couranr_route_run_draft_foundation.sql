-- RR-001: Business multi-stop DRAFT foundation, not execution authority.
-- A route groups single-destination requests. No request, quote, obligation,
-- plan, assignment, proof, token or driver availability is changed here.
-- Draft versions are immutable references, NOT accepted route quotes.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table public.couranr_route_runs (
  id uuid primary key,
  business_account_id uuid not null references public.business_accounts(id),
  created_by uuid not null references auth.users(id),
  route_state text not null default 'draft' check (route_state = 'draft'),
  current_version integer not null default 1 check (current_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index couranr_rr_business_idx on public.couranr_route_runs(business_account_id, created_at desc);

create table public.couranr_route_run_versions (
  id uuid primary key default gen_random_uuid(),
  route_run_id uuid not null references public.couranr_route_runs(id),
  version integer not null check (version >= 1),
  expected_previous_version integer not null check (expected_previous_version = version - 1),
  idempotency_key uuid not null,
  input_fingerprint text not null check (input_fingerprint ~ '^[0-9a-f]{64}$'),
  title text not null check (length(btrim(title)) between 1 and 100),
  stop_count integer not null check (stop_count between 2 and 5),
  reference_quote_total_cents bigint not null check (reference_quote_total_cents between 0 and 2147483647),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(route_run_id, version),
  unique(route_run_id, idempotency_key)
);
alter table public.couranr_route_runs add constraint couranr_rr_current_version_fk
  foreign key(id,current_version) references public.couranr_route_run_versions(route_run_id,version)
  deferrable initially deferred;

create table public.couranr_route_run_stops (
  route_version_id uuid not null references public.couranr_route_run_versions(id),
  sequence integer not null check (sequence between 1 and 5),
  request_id uuid not null references public.couranr_delivery_requests(id),
  quote_version_id uuid not null references public.couranr_quote_versions(id),
  request_version integer not null check (request_version >= 1),
  pickup_manifest_version integer not null check (pickup_manifest_version >= 0),
  -- The request-owned facts may change later; this records exactly what the
  -- merchant grouped. Immutable quote-owned addresses/recipients stay in QV.
  request_snapshot jsonb not null check (jsonb_typeof(request_snapshot) = 'object'),
  primary key(route_version_id,sequence),
  unique(route_version_id,request_id)
);
create table public.couranr_route_run_events (
  id uuid primary key default gen_random_uuid(),
  route_run_id uuid not null references public.couranr_route_runs(id),
  route_version_id uuid not null unique references public.couranr_route_run_versions(id),
  actor_user_id uuid not null references auth.users(id),
  command text not null check (command in ('create_route_draft','revise_route_draft')),
  created_at timestamptz not null default now()
);

alter table public.couranr_route_runs enable row level security;
alter table public.couranr_route_run_versions enable row level security;
alter table public.couranr_route_run_stops enable row level security;
alter table public.couranr_route_run_events enable row level security;
revoke all on public.couranr_route_runs, public.couranr_route_run_versions,
  public.couranr_route_run_stops, public.couranr_route_run_events from public,anon,authenticated,service_role;
grant select on public.couranr_route_runs, public.couranr_route_run_versions,
  public.couranr_route_run_stops, public.couranr_route_run_events to service_role;

create function private.couranr_assert_route_run_member(p_business uuid,p_actor uuid,p_write boolean)
returns void language plpgsql set search_path = '' as $fn$
begin
  perform 1 from public.business_members
   where business_account_id=p_business and user_id=p_actor and status='active'
     and (p_write is false or role in ('owner','manager','dispatcher')) for share;
  if not found then raise exception 'route_business_access_denied' using errcode='CR403'; end if;
end
$fn$;
revoke all on function private.couranr_assert_route_run_member(uuid,uuid,boolean) from public,anon,authenticated,service_role;

create function private.couranr_route_run_draft_view(p_route uuid,p_version integer)
returns jsonb language sql stable set search_path = '' as $fn$
  select jsonb_build_object(
    'routeRunId',r.id,'businessAccountId',r.business_account_id,'state','draft',
    'version',v.version,'currentVersion',r.current_version,'title',v.title,
    'draftOnly',true,'bookingAvailable',false,'stopCount',v.stop_count,
    'referenceQuoteTotalCents',v.reference_quote_total_cents,
    'quoteBasis','independent_delivery_quotes_not_a_route_offer',
    'stops',coalesce((select jsonb_agg(jsonb_build_object(
      'sequence',s.sequence,'requestId',s.request_id,'quoteVersionId',s.quote_version_id,
      'requestVersion',s.request_version,'pickupManifestVersion',s.pickup_manifest_version,
      'stale',q.id is null or q.request_state<>'draft' or q.version<>s.request_version or
        q.current_quote_version_id is distinct from s.quote_version_id or
        q.pickup_manifest_version<>s.pickup_manifest_version
    ) order by s.sequence) from public.couranr_route_run_stops s
      left join public.couranr_delivery_requests q on q.id=s.request_id
      where s.route_version_id=v.id),'[]'::jsonb))
  from public.couranr_route_runs r join public.couranr_route_run_versions v
    on v.route_run_id=r.id and v.version=p_version where r.id=p_route
$fn$;
revoke all on function private.couranr_route_run_draft_view(uuid,integer) from public,anon,authenticated,service_role;

create function public.couranr_read_route_run_draft(p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare v_version integer;
begin
  perform private.couranr_assert_route_run_member(p_business_account_id,p_actor_user_id,false);
  select current_version into v_version from public.couranr_route_runs
    where id=p_route_run_id and business_account_id=p_business_account_id;
  if not found then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
  return private.couranr_route_run_draft_view(p_route_run_id,v_version);
end
$fn$;

create function public.couranr_save_route_run_draft(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_expected_version integer,p_idempotency_key uuid,p_title text,p_request_ids uuid[]
) returns jsonb language plpgsql security definer set search_path = '' as $fn$
declare
  v_route public.couranr_route_runs;
  v_prior public.couranr_route_run_versions;
  v_request public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_fingerprint text;
  v_version_id uuid;
  v_version integer;
  v_total bigint:=0;
  v_pickup jsonb;
  v_position integer:=0;
  v_request_id uuid;
  v_title text:=btrim(p_title);
begin
  perform private.couranr_assert_route_run_member(p_business_account_id,p_actor_user_id,true);
  if p_route_run_id is null or p_idempotency_key is null or p_expected_version is null or
     p_expected_version<0 or p_expected_version>2147483646 or v_title is null or
     length(v_title) not between 1 and 100 or v_title ~ '[[:cntrl:]]' then
    raise exception 'route_draft_input_invalid' using errcode='CR422';
  end if;
  if p_request_ids is null or array_ndims(p_request_ids) is distinct from 1 or
     cardinality(p_request_ids) not between 2 and 5 or array_position(p_request_ids,null) is not null or
     (select count(distinct x) from unnest(p_request_ids) x)<>cardinality(p_request_ids) then
    raise exception 'route_draft_stops_invalid' using errcode='CR422';
  end if;
  -- Serialize creation, tenant quotas, and revisions without touching dispatch.
  perform pg_advisory_xact_lock(hashtextextended('couranr-route-draft:'||p_business_account_id::text,0));
  v_fingerprint:=encode(sha256(convert_to(jsonb_build_object('title',v_title,
    'requestIds',p_request_ids,'expectedVersion',p_expected_version)::text,'UTF8')),'hex');
  select * into v_route from public.couranr_route_runs where id=p_route_run_id for update;
  if found then
    if v_route.business_account_id is distinct from p_business_account_id then
      raise exception 'route_draft_not_found' using errcode='CR404';
    end if;
    select * into v_prior from public.couranr_route_run_versions
      where route_run_id=p_route_run_id and idempotency_key=p_idempotency_key;
    if found then
      if v_prior.input_fingerprint is distinct from v_fingerprint then
        raise exception 'route_idempotency_conflict' using errcode='CR409';
      end if;
      return private.couranr_route_run_draft_view(p_route_run_id,v_prior.version);
    end if;
    if v_route.current_version<>p_expected_version then
      raise exception 'route_version_conflict' using errcode='CR409';
    end if;
  else
    if p_expected_version<>0 then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
    if (select count(*) from public.couranr_route_runs where business_account_id=p_business_account_id)>=100 then
      raise exception 'route_draft_limit_reached' using errcode='CR409';
    end if;
  end if;
  -- Lock children in a stable order. A concurrent re-quote cannot yield a
  -- mixed snapshot. Draft membership does NOT reserve a child for dispatch.
  perform id from public.couranr_delivery_requests where id=any(p_request_ids) and business_account_id=p_business_account_id and requester_kind='business' order by id for share;
  foreach v_request_id in array p_request_ids loop
    select * into v_request from public.couranr_delivery_requests
      where id=v_request_id and business_account_id=p_business_account_id and requester_kind='business';
    if not found then raise exception 'route_child_not_available' using errcode='CR404'; end if;
    if v_request.request_state<>'draft' or v_request.payer_type<>'merchant' or
       not v_request.single_destination_contract or v_request.additional_stops<>0 then
      raise exception 'route_child_not_eligible' using errcode='CR409';
    end if;
    select * into v_quote from public.couranr_quote_versions where id=v_request.current_quote_version_id
      and request_id=v_request.id and quote_status='estimated' and subtotal_cents is not null;
    if not found or v_quote.subtotal_cents<0 or jsonb_typeof(v_quote.pickup_address_snapshot) is distinct from 'object' then
      raise exception 'route_child_quote_required' using errcode='CR409';
    end if;
    if v_pickup is null then v_pickup:=v_quote.pickup_address_snapshot;
    elsif v_pickup is distinct from v_quote.pickup_address_snapshot then
      raise exception 'route_common_pickup_required' using errcode='CR409';
    end if;
    v_total:=v_total+v_quote.subtotal_cents;
  end loop;
  if v_total>2147483647 then raise exception 'route_quote_total_out_of_range' using errcode='CR422'; end if;
  v_version:=p_expected_version+1;
  if v_route.id is null then
    insert into public.couranr_route_runs(id,business_account_id,created_by)
      values(p_route_run_id,p_business_account_id,p_actor_user_id);
  end if;
  insert into public.couranr_route_run_versions(route_run_id,version,expected_previous_version,
    idempotency_key,input_fingerprint,title,stop_count,reference_quote_total_cents,created_by)
    values(p_route_run_id,v_version,p_expected_version,p_idempotency_key,v_fingerprint,v_title,
      cardinality(p_request_ids),v_total,p_actor_user_id) returning id into v_version_id;
  foreach v_request_id in array p_request_ids loop
    v_position:=v_position+1;
    select * into strict v_request from public.couranr_delivery_requests where id=v_request_id;
    insert into public.couranr_route_run_stops(route_version_id,sequence,request_id,quote_version_id,
      request_version,pickup_manifest_version,request_snapshot)
    values(v_version_id,v_position,v_request.id,v_request.current_quote_version_id,v_request.version,
      v_request.pickup_manifest_version,jsonb_build_object('pickupManifest',v_request.pickup_manifest,
        'declaredValueCents',v_request.declared_value_cents,'weightLb',v_request.weight_lb,
        'weightBand',v_request.weight_band,'readinessState',v_request.readiness_state));
  end loop;
  update public.couranr_route_runs set current_version=v_version,updated_at=now() where id=p_route_run_id;
  insert into public.couranr_route_run_events(route_run_id,route_version_id,actor_user_id,command)
    values(p_route_run_id,v_version_id,p_actor_user_id,
      case when p_expected_version=0 then 'create_route_draft' else 'revise_route_draft' end);
  return private.couranr_route_run_draft_view(p_route_run_id,v_version);
end
$fn$;
revoke all on function public.couranr_save_route_run_draft(uuid,uuid,uuid,integer,uuid,text,uuid[]) from public,anon,authenticated;
revoke all on function public.couranr_read_route_run_draft(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.couranr_save_route_run_draft(uuid,uuid,uuid,integer,uuid,text,uuid[]) to service_role;
grant execute on function public.couranr_read_route_run_draft(uuid,uuid,uuid) to service_role;

comment on table public.couranr_route_runs is
  'Draft-only Route Run foundation. No dispatch/capture/custody authority. Child requests stay single-destination and are NOT claimed by a draft.';
comment on table public.couranr_route_run_versions is
  'Immutable draft revisions, NOT accepted commercial offers. Quote IDs are references; stale/expired children must be revalidated before future booking.';
commit;
