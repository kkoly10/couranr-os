-- RR-002 rollback refuses once acceptance/abandonment/business value semantics exist.
begin;
set local lock_timeout='5s';
set local statement_timeout='90s';

do $$ begin
  if exists(select 1 from public.couranr_route_runs where route_state<>'draft')
     or exists(select 1 from public.couranr_route_run_claims)
     or exists(select 1 from public.couranr_delivery_request_events where command='record_business_declared_value') then
    raise exception 'route_run_acceptance_rollback_refuses_semantic_use';
  end if;
end $$;

drop trigger if exists couranr_guard_accepted_route_child on public.couranr_delivery_requests;
drop function if exists private.couranr_guard_accepted_route_child();

drop function if exists public.couranr_list_route_runs(uuid,uuid);
drop function if exists public.couranr_abandon_route_run_draft(uuid,uuid,uuid,integer,uuid);
drop function if exists public.couranr_accept_route_run(uuid,uuid,uuid,integer,uuid);
drop function if exists public.couranr_record_business_declared_value(uuid,uuid,uuid,integer,integer);

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
    'sender_cancellation_review_requested'
  ));

create or replace function private.couranr_quote_payer_approved(
  p_quote public.couranr_quote_versions
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $fn$
  select
    /* An obligation that actually reached authorization is payer approval for
       EITHER payer. Money changing hands is the strongest evidence there is,
       and scoping this to customers only would leave a merchant quote
       expirable after its own payment was authorized. 'not_started' and
       'requires_action' are deliberately absent: an obligation that merely
       exists, or an intent merely attached, is not approval. */
    exists (
      select 1 from public.couranr_payment_obligations o
       where o.quote_version_id = p_quote.id
         and o.payment_state in ('authorized','capture_pending','captured'))
    /* And for a merchant-paid quote the merchant IS the payer, so their
       acknowledgment - which names the exact quote version it approved - is
       approval on its own, before any payment exists. */
    or (p_quote.payer_type = 'merchant' and exists (
      select 1 from public.couranr_delivery_request_events e
       where e.request_id = p_quote.request_id
         and e.command    = 'submit_delivery_request'
         and coalesce((e.metadata ->> 'acknowledgment')::boolean, false) is true
         and (e.metadata ->> 'quoteVersionId') = p_quote.id::text));
$fn$;

revoke all on function private.couranr_quote_payer_approved(public.couranr_quote_versions)
  from public,anon,authenticated,service_role;
grant execute on function private.couranr_quote_payer_approved(public.couranr_quote_versions)
  to service_role;

drop table public.couranr_route_run_claims restrict;

alter table public.couranr_route_run_events
  drop constraint couranr_route_run_events_command_check;
alter table public.couranr_route_run_events
  add constraint couranr_route_run_events_command_check
  check(command in ('create_route_draft','revise_route_draft'));
drop index if exists public.couranr_rre_version_idx;
alter table public.couranr_route_run_events
  add constraint couranr_route_run_events_route_version_id_key unique(route_version_id);

alter table public.couranr_route_runs drop constraint couranr_rr_accepted_version_fk;
alter table public.couranr_route_run_versions drop constraint couranr_rrv_route_id_id_uniq;
alter table public.couranr_route_runs drop constraint couranr_rr_acceptance_shape_chk;
drop index if exists public.couranr_rr_accepted_version_idx;
drop index if exists public.couranr_rr_abandoned_by_idx;
drop index if exists public.couranr_rr_accepted_by_idx;
alter table public.couranr_route_runs
  drop column accepted_version,
  drop column accepted_at,
  drop column accepted_by,
  drop column accept_idempotency_key,
  drop column abandoned_at,
  drop column abandoned_by,
  drop column abandon_idempotency_key;
alter table public.couranr_route_runs
  drop constraint couranr_route_runs_route_state_check;
alter table public.couranr_route_runs
  add constraint couranr_route_runs_route_state_check check(route_state='draft');

-- Restore the exact RR-001 function bodies after removing RR-002 columns/state.
create or replace function private.couranr_route_run_draft_view(p_route uuid,p_version integer)
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

create or replace function public.couranr_save_route_run_draft(
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

commit;
