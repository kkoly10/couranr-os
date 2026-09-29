-- RR-002: Route Run accepted-contract foundation.
--
-- A Route Run may now move from draft -> accepted or draft -> abandoned.
-- ACCEPTED IS NOT BOOKED: this migration still creates no payment obligation,
-- service plan, delivery, assignment, route optimization call, custody token or
-- proof. Acceptance freezes the exact draft version and atomically CLAIMS every
-- child so it cannot be submitted/requoted/changed as a standalone delivery.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

do $$ begin
  if to_regclass('public.couranr_route_runs') is null
     or to_regprocedure('private.couranr_quote_version_is_expired(public.couranr_quote_versions,timestamptz)') is null
     or to_regprocedure('private.couranr_derive_protection_level(integer)') is null then
    raise exception 'route_run_acceptance_requires_rr001_and_trust_foundation';
  end if;
end $$;

alter table public.couranr_route_runs
  drop constraint if exists couranr_route_runs_route_state_check;
alter table public.couranr_route_runs
  add constraint couranr_route_runs_route_state_check
  check(route_state in ('draft','accepted','abandoned'));

alter table public.couranr_route_runs
  add column accepted_version integer,
  add column accepted_at timestamptz,
  add column accepted_by uuid references auth.users(id),
  add column accept_idempotency_key uuid,
  add column abandoned_at timestamptz,
  add column abandoned_by uuid references auth.users(id),
  add column abandon_idempotency_key uuid;

alter table public.couranr_route_runs
  add constraint couranr_rr_acceptance_shape_chk check (
    (route_state='draft'
      and accepted_version is null and accepted_at is null and accepted_by is null
      and abandoned_at is null and abandoned_by is null)
    or (route_state='accepted'
      and accepted_version is not null and accepted_at is not null and accepted_by is not null
      and accept_idempotency_key is not null
      and abandoned_at is null and abandoned_by is null)
    or (route_state='abandoned'
      and accepted_version is null and accepted_at is null and accepted_by is null
      and abandoned_at is not null and abandoned_by is not null
      and abandon_idempotency_key is not null)
  );

alter table public.couranr_route_runs
  add constraint couranr_rr_accepted_version_fk
  foreign key(id,accepted_version)
  references public.couranr_route_run_versions(route_run_id,version)
  deferrable initially deferred;

create index couranr_rr_accepted_by_idx on public.couranr_route_runs(accepted_by);
create index couranr_rr_abandoned_by_idx on public.couranr_route_runs(abandoned_by);
create index couranr_rr_accepted_version_idx on public.couranr_route_runs(id,accepted_version);

alter table public.couranr_route_run_versions
  add constraint couranr_rrv_route_id_id_uniq unique(route_run_id,id);

create table public.couranr_route_run_claims (
  request_id uuid primary key references public.couranr_delivery_requests(id),
  route_run_id uuid not null references public.couranr_route_runs(id),
  route_version_id uuid not null references public.couranr_route_run_versions(id),
  claimed_at timestamptz not null default now(),
  unique(route_run_id,request_id),
  constraint couranr_rrc_route_version_fk
    foreign key(route_run_id,route_version_id)
    references public.couranr_route_run_versions(route_run_id,id)
);
create index couranr_rrc_route_idx on public.couranr_route_run_claims(route_run_id);
create index couranr_rrc_version_idx on public.couranr_route_run_claims(route_version_id);
alter table public.couranr_route_run_claims enable row level security;
revoke all on public.couranr_route_run_claims from public,anon,authenticated,service_role;
grant select on public.couranr_route_run_claims to service_role;

-- RR-001 allowed exactly one event per draft version because every version had
-- exactly one create/revise event. RR-002 adds lifecycle events AGAINST that
-- immutable version, so the event log must be one-to-many while version history
-- itself stays immutable.
alter table public.couranr_route_run_events
  drop constraint if exists couranr_route_run_events_route_version_id_key;
create index if not exists couranr_rre_version_idx
  on public.couranr_route_run_events(route_version_id);

alter table public.couranr_route_run_events
  drop constraint if exists couranr_route_run_events_command_check;
alter table public.couranr_route_run_events
  add constraint couranr_route_run_events_command_check
  check(command in ('create_route_draft','revise_route_draft','accept_route_run','abandon_route_draft'));

-- An accepted merchant Route Run is itself payer approval of each exact child
-- quote. This extends QVL-001 without adding a mutable approval flag: the
-- immutable accepted version + claimed child is the evidence. The acceptance
-- command checks expiry BEFORE setting route_state='accepted', so an expired
-- quote cannot bootstrap itself into approval.
create or replace function private.couranr_quote_payer_approved(
  p_quote public.couranr_quote_versions
)
returns boolean
language sql
stable
security invoker
set search_path=''
as $fn$
  select
    exists (
      select 1 from public.couranr_payment_obligations o
       where o.quote_version_id=p_quote.id
         and o.payment_state in ('authorized','capture_pending','captured'))
    or (p_quote.payer_type='merchant' and exists (
      select 1 from public.couranr_delivery_request_events e
       where e.request_id=p_quote.request_id
         and e.command='submit_delivery_request'
         and coalesce((e.metadata ->> 'acknowledgment')::boolean,false) is true
         and (e.metadata ->> 'quoteVersionId')=p_quote.id::text))
    or (p_quote.payer_type='merchant' and exists (
      select 1
        from public.couranr_route_run_claims c
        join public.couranr_route_runs r
          on r.id=c.route_run_id
         and r.route_state='accepted'
         and r.accepted_version is not null
        join public.couranr_route_run_versions v
          on v.route_run_id=r.id
         and v.version=r.accepted_version
         and v.id=c.route_version_id
        join public.couranr_route_run_stops s
          on s.route_version_id=v.id
         and s.request_id=c.request_id
       where c.request_id=p_quote.request_id
         and s.quote_version_id=p_quote.id));
$fn$;

revoke all on function private.couranr_quote_payer_approved(public.couranr_quote_versions)
  from public,anon,authenticated,service_role;
grant execute on function private.couranr_quote_payer_approved(public.couranr_quote_versions)
  to service_role;

-- Accepted children are frozen until the later Route executor explicitly owns
-- their lifecycle. No generic request command can accidentally submit/requote
-- or cancel one in the meantime.
create or replace function private.couranr_guard_accepted_route_child()
returns trigger language plpgsql security invoker set search_path='' as $fn$
begin
  if exists (
    select 1
    from public.couranr_route_run_claims c
    join public.couranr_route_runs r on r.id=c.route_run_id
    where c.request_id=old.id and r.route_state='accepted'
  ) then
    raise exception 'route_child_claimed' using errcode='CR409';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$fn$;
revoke all on function private.couranr_guard_accepted_route_child()
  from public,anon,authenticated,service_role;

drop trigger if exists couranr_guard_accepted_route_child on public.couranr_delivery_requests;
create trigger couranr_guard_accepted_route_child
before update or delete on public.couranr_delivery_requests
for each row execute function private.couranr_guard_accepted_route_child();

-- Extend the closed request-event vocabulary for the Business declared-value
-- evidence written below. Re-state the latest vocabulary exactly + one command.
alter table public.couranr_delivery_request_events
  drop constraint couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check(command in (
    'create_delivery_request_draft','create_hosted_delivery_request',
    'calculate_delivery_request_estimate','create_quote_version',
    'submit_delivery_request','validate_hosted_delivery_request',
    'begin_delivery_request_review','accept_delivery_request_as_quoted',
    'auto_accept_delivery_request','auto_plan_delivery_request',
    'requote_delivery_request','decline_delivery_request',
    'record_payer_quote_approval','begin_delivery_preparation',
    'mark_delivery_ready','mark_delivery_not_ready','mark_delivery_unavailable',
    'cancel_delivery_request','apply_promotional_credit','record_consumer_trust',
    'record_recipient_adult_attestation','issue_recipient_dropoff_code',
    'sender_cancellation_review_requested','record_business_declared_value'
  ));

-- Business declared value: generic draft-only risk fact used by Route Run and
-- available to ordinary Business deliveries too. The browser names the value;
-- the SERVER derives protection_level and the DB CHECK re-derives it again.
create or replace function public.couranr_record_business_declared_value(
  p_business_account_id uuid,
  p_actor_user_id uuid,
  p_request_id uuid,
  p_expected_version integer,
  p_declared_value_cents integer
) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare
  v_req public.couranr_delivery_requests;
  v_level text;
begin
  perform private.couranr_assert_route_run_member(p_business_account_id,p_actor_user_id,true);
  select * into v_req
    from public.couranr_delivery_requests
   where id=p_request_id
     and business_account_id=p_business_account_id
     and requester_kind='business'
   for update;
  if not found then raise exception 'route_child_not_available' using errcode='CR404'; end if;
  if v_req.request_state<>'draft' then
    raise exception 'route_child_not_eligible' using errcode='CR409';
  end if;
  v_level:=private.couranr_derive_protection_level(p_declared_value_cents);
  if v_level is null or v_level='declined' then
    raise exception 'declared_value_invalid' using errcode='CR422';
  end if;
  -- Exact replay is idempotent even if the caller did not receive the first
  -- response. Return the current version so the builder can continue safely.
  if v_req.declared_value_cents is not distinct from p_declared_value_cents
     and v_req.protection_level is not distinct from v_level
     and v_req.protection_policy_version is not distinct from 'couranr-business-protection-v1-2026-09-26' then
    return jsonb_build_object(
      'requestId',v_req.id,
      'version',v_req.version,
      'declaredValueCents',v_req.declared_value_cents,
      'protectionLevel',v_req.protection_level
    );
  end if;
  if p_expected_version is null or v_req.version<>p_expected_version then
    raise exception 'route_child_version_conflict' using errcode='CR409';
  end if;
  update public.couranr_delivery_requests
     set declared_value_cents=p_declared_value_cents,
         protection_level=v_level,
         protection_policy_version='couranr-business-protection-v1-2026-09-26',
         version=version+1,
         updated_at=now()
   where id=v_req.id
   returning * into v_req;
  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_req.id,p_actor_user_id,'merchant','record_business_declared_value',
    v_req.request_state,v_req.request_state,
    jsonb_build_object(
      'declaredValueCents',p_declared_value_cents,
      'protectionLevel',v_level,
      'protectionPolicyVersion',v_req.protection_policy_version,
      'source','merchant_portal'
    )
  );
  return jsonb_build_object(
    'requestId',v_req.id,
    'version',v_req.version,
    'declaredValueCents',v_req.declared_value_cents,
    'protectionLevel',v_req.protection_level
  );
end
$fn$;
revoke all on function public.couranr_record_business_declared_value(uuid,uuid,uuid,integer,integer)
  from public,anon,authenticated;
grant execute on function public.couranr_record_business_declared_value(uuid,uuid,uuid,integer,integer)
  to service_role;

-- Replace the view projection so list/detail can truthfully show draft,
-- accepted and abandoned without inventing execution state.
create or replace function private.couranr_route_run_draft_view(p_route uuid,p_version integer)
returns jsonb language sql stable set search_path='' as $fn$
  select jsonb_build_object(
    'routeRunId',r.id,'businessAccountId',r.business_account_id,'state',r.route_state,
    'version',v.version,'currentVersion',r.current_version,'title',v.title,
    'draftOnly',(r.route_state='draft'),'bookingAvailable',false,
    'executionAvailable',false,'stopCount',v.stop_count,
    'referenceQuoteTotalCents',v.reference_quote_total_cents,
    'quoteBasis','independent_delivery_quotes_not_a_route_offer',
    'acceptedVersion',r.accepted_version,'acceptedAt',r.accepted_at,
    'abandonedAt',r.abandoned_at,
    'stops',coalesce((select jsonb_agg(jsonb_build_object(
      'sequence',s.sequence,'requestId',s.request_id,'quoteVersionId',s.quote_version_id,
      'requestVersion',s.request_version,'pickupManifestVersion',s.pickup_manifest_version,
      'claimed',c.request_id is not null,
      'stale',q.id is null or q.request_state<>'draft' or q.version<>s.request_version or
        q.current_quote_version_id is distinct from s.quote_version_id or
        q.pickup_manifest_version<>s.pickup_manifest_version
    ) order by s.sequence) from public.couranr_route_run_stops s
      left join public.couranr_delivery_requests q on q.id=s.request_id
      left join public.couranr_route_run_claims c on c.request_id=s.request_id and c.route_run_id=r.id
      where s.route_version_id=v.id),'[]'::jsonb))
  from public.couranr_route_runs r join public.couranr_route_run_versions v
    on v.route_run_id=r.id and v.version=p_version where r.id=p_route
$fn$;

create or replace function public.couranr_save_route_run_draft(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_expected_version integer,p_idempotency_key uuid,p_title text,p_request_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $fn$
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
  perform pg_advisory_xact_lock(hashtextextended('couranr-route-draft:'||p_business_account_id::text,0));
  v_fingerprint:=encode(sha256(convert_to(jsonb_build_object('title',v_title,
    'requestIds',p_request_ids,'expectedVersion',p_expected_version)::text,'UTF8')),'hex');
  select * into v_route from public.couranr_route_runs where id=p_route_run_id for update;
  if found then
    if v_route.business_account_id is distinct from p_business_account_id then
      raise exception 'route_draft_not_found' using errcode='CR404';
    end if;
    if v_route.route_state<>'draft' then
      raise exception 'route_not_editable' using errcode='CR409';
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
    if (select count(*) from public.couranr_route_runs where business_account_id=p_business_account_id and route_state='draft')>=100 then
      raise exception 'route_draft_limit_reached' using errcode='CR409';
    end if;
  end if;
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

create or replace function public.couranr_accept_route_run(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_expected_version integer,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_version public.couranr_route_run_versions;
  v_stop public.couranr_route_run_stops;
  v_req public.couranr_delivery_requests;
  v_quote public.couranr_quote_versions;
  v_pickup jsonb;
  v_timing jsonb;
  v_total_value bigint:=0;
begin
  perform private.couranr_assert_route_run_member(p_business_account_id,p_actor_user_id,true);
  if p_idempotency_key is null or p_expected_version is null or p_expected_version<1 then
    raise exception 'route_accept_input_invalid' using errcode='CR422';
  end if;
  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id and business_account_id=p_business_account_id
   for update;
  if not found then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
  if v_route.route_state='accepted' then
    if v_route.accept_idempotency_key=p_idempotency_key then
      return private.couranr_route_run_draft_view(p_route_run_id,v_route.accepted_version);
    end if;
    raise exception 'route_already_accepted' using errcode='CR409';
  end if;
  if v_route.route_state<>'draft' then raise exception 'route_not_editable' using errcode='CR409'; end if;
  if v_route.current_version<>p_expected_version then raise exception 'route_version_conflict' using errcode='CR409'; end if;
  select * into strict v_version from public.couranr_route_run_versions
   where route_run_id=p_route_run_id and version=v_route.current_version;

  -- Stable lock order closes submit/requote-vs-accept races.
  perform q.id
    from public.couranr_route_run_stops s
    join public.couranr_delivery_requests q on q.id=s.request_id
   where s.route_version_id=v_version.id
   order by q.id for update of q;

  for v_stop in select * from public.couranr_route_run_stops where route_version_id=v_version.id order by sequence loop
    select * into v_req from public.couranr_delivery_requests where id=v_stop.request_id;
    if not found or v_req.business_account_id is distinct from p_business_account_id then
      raise exception 'route_child_not_available' using errcode='CR404';
    end if;
    if v_req.request_state<>'draft' or v_req.payer_type<>'merchant' or
       not v_req.single_destination_contract or v_req.additional_stops<>0 or
       v_req.version<>v_stop.request_version or
       v_req.current_quote_version_id is distinct from v_stop.quote_version_id or
       v_req.pickup_manifest_version<>v_stop.pickup_manifest_version then
      raise exception 'route_child_stale' using errcode='CR409';
    end if;
    if v_req.restricted_class is distinct from 'none' then
      raise exception 'route_child_restricted_class_not_supported' using errcode='CR409';
    end if;
    if v_req.service_level is distinct from 'standard' then
      raise exception 'route_child_service_level_not_supported' using errcode='CR409';
    end if;
    if (v_req.weight_lb is not null and (v_req.weight_lb<=0 or v_req.weight_lb>50))
       or (v_req.weight_lb is null and v_req.weight_band not in ('0_25_lb','over_25_to_50_lb')) then
      raise exception 'route_child_weight_not_supported' using errcode='CR409';
    end if;
    if v_req.recipient_email is null or btrim(v_req.recipient_email)='' then
      raise exception 'route_child_recipient_email_required' using errcode='CR409';
    end if;
    if v_req.pickup_manifest is null
       or jsonb_typeof(v_req.pickup_manifest) is distinct from 'object'
       or v_req.pickup_manifest_policy_version is distinct from 'pickup-handoff-v2'
       or nullif(btrim(v_req.pickup_manifest ->> 'description'),'') is null then
      raise exception 'route_child_pickup_manifest_required' using errcode='CR409';
    end if;
    if v_req.declared_value_cents is null
       or v_req.protection_policy_version is distinct from 'couranr-business-protection-v1-2026-09-26'
       or v_req.protection_level is null then
      raise exception 'route_child_declared_value_required' using errcode='CR409';
    end if;
    if v_timing is null then
      v_timing:=jsonb_build_object(
        'timingIntent',v_req.timing_intent,
        'requestedPickupLocal',v_req.requested_pickup_local,
        'operatingTimezone',v_req.operating_timezone
      );
    elsif v_timing is distinct from jsonb_build_object(
        'timingIntent',v_req.timing_intent,
        'requestedPickupLocal',v_req.requested_pickup_local,
        'operatingTimezone',v_req.operating_timezone
      ) then
      raise exception 'route_common_timing_required' using errcode='CR409';
    end if;
    v_total_value:=v_total_value+v_req.declared_value_cents;
    if v_total_value>50000 then raise exception 'route_declared_value_exceeded' using errcode='CR409'; end if;
    select * into v_quote from public.couranr_quote_versions
     where id=v_stop.quote_version_id and request_id=v_req.id
       and quote_status='estimated' and subtotal_cents is not null;
    if not found then raise exception 'route_child_quote_required' using errcode='CR409'; end if;
    if private.couranr_quote_version_is_expired(v_quote,now()) then
      raise exception 'route_child_quote_expired' using errcode='CR409';
    end if;
    if v_pickup is null then v_pickup:=v_quote.pickup_address_snapshot;
    elsif v_pickup is distinct from v_quote.pickup_address_snapshot then
      raise exception 'route_common_pickup_required' using errcode='CR409';
    end if;
  end loop;

  -- One statement set, one transaction. The request_id PK is the cross-route
  -- exclusion: if another Route accepted the same child first, this fails and
  -- NOTHING in this acceptance commits.
  insert into public.couranr_route_run_claims(request_id,route_run_id,route_version_id)
  select request_id,p_route_run_id,v_version.id
    from public.couranr_route_run_stops
   where route_version_id=v_version.id
   order by sequence;

  update public.couranr_route_runs
     set route_state='accepted',accepted_version=v_version.version,
         accepted_at=now(),accepted_by=p_actor_user_id,
         accept_idempotency_key=p_idempotency_key,updated_at=now()
   where id=p_route_run_id;
  insert into public.couranr_route_run_events(route_run_id,route_version_id,actor_user_id,command)
  values(p_route_run_id,v_version.id,p_actor_user_id,'accept_route_run');
  return private.couranr_route_run_draft_view(p_route_run_id,v_version.version);
exception when unique_violation then
  raise exception 'route_child_already_claimed' using errcode='CR409';
end
$fn$;

create or replace function public.couranr_abandon_route_run_draft(
  p_business_account_id uuid,p_actor_user_id uuid,p_route_run_id uuid,
  p_expected_version integer,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare
  v_route public.couranr_route_runs;
  v_version_id uuid;
begin
  perform private.couranr_assert_route_run_member(p_business_account_id,p_actor_user_id,true);
  if p_idempotency_key is null or p_expected_version is null or p_expected_version<1 then
    raise exception 'route_abandon_input_invalid' using errcode='CR422';
  end if;
  select * into v_route from public.couranr_route_runs
   where id=p_route_run_id and business_account_id=p_business_account_id for update;
  if not found then raise exception 'route_draft_not_found' using errcode='CR404'; end if;
  if v_route.route_state='abandoned' then
    if v_route.abandon_idempotency_key=p_idempotency_key then
      return private.couranr_route_run_draft_view(p_route_run_id,v_route.current_version);
    end if;
    raise exception 'route_already_abandoned' using errcode='CR409';
  end if;
  if v_route.route_state<>'draft' then raise exception 'route_not_editable' using errcode='CR409'; end if;
  if v_route.current_version<>p_expected_version then raise exception 'route_version_conflict' using errcode='CR409'; end if;
  select id into strict v_version_id from public.couranr_route_run_versions
   where route_run_id=p_route_run_id and version=v_route.current_version;
  update public.couranr_route_runs
     set route_state='abandoned',abandoned_at=now(),abandoned_by=p_actor_user_id,
         abandon_idempotency_key=p_idempotency_key,updated_at=now()
   where id=p_route_run_id;
  insert into public.couranr_route_run_events(route_run_id,route_version_id,actor_user_id,command)
  values(p_route_run_id,v_version_id,p_actor_user_id,'abandon_route_draft');
  return private.couranr_route_run_draft_view(p_route_run_id,v_route.current_version);
end
$fn$;

create or replace function public.couranr_list_route_runs(
  p_business_account_id uuid,p_actor_user_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $fn$
begin
  perform private.couranr_assert_route_run_member(p_business_account_id,p_actor_user_id,false);
  return coalesce((
    select jsonb_agg(private.couranr_route_run_draft_view(r.id,
      case when r.route_state='accepted' then r.accepted_version else r.current_version end)
      order by r.updated_at desc)
    from (
      select *
      from public.couranr_route_runs
      where business_account_id=p_business_account_id
      order by updated_at desc
      limit 200
    ) r
  ),'[]'::jsonb);
end
$fn$;

revoke all on function public.couranr_accept_route_run(uuid,uuid,uuid,integer,uuid)
  from public,anon,authenticated;
revoke all on function public.couranr_abandon_route_run_draft(uuid,uuid,uuid,integer,uuid)
  from public,anon,authenticated;
revoke all on function public.couranr_list_route_runs(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.couranr_accept_route_run(uuid,uuid,uuid,integer,uuid) to service_role;
grant execute on function public.couranr_abandon_route_run_draft(uuid,uuid,uuid,integer,uuid) to service_role;
grant execute on function public.couranr_list_route_runs(uuid,uuid) to service_role;

comment on table public.couranr_route_run_claims is
  'RR-002 accepted-child lock. A request_id can belong to at most one accepted Route Run. Acceptance is still not booking/payment/dispatch/custody.';
comment on function public.couranr_accept_route_run is
  'RR-002 freezes the exact current draft version and atomically claims all children. It does not book, charge, dispatch or create custody.';

commit;
