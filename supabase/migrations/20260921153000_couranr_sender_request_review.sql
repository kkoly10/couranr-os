-- Before a canonical delivery exists, Delivery Help cannot be issued. This
-- request-scoped command records one sender cancellation REVIEW request on
-- the existing request event spine. It never cancels or moves money. Once a
-- delivery exists, CUS-002 Delivery Help owns stage-based review instead.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$ begin
  if to_regclass('public.couranr_delivery_request_events') is null
     or to_regclass('public.couranr_consumer_guest_sessions') is null
     or not exists(select 1 from pg_constraint
                    where conrelid='public.couranr_delivery_request_events'::regclass
                      and conname='couranr_dre_command_chk') then
    raise exception 'sender_request_review_unknown_schema';
  end if;
end $$;

alter table public.couranr_delivery_request_events drop constraint couranr_dre_command_chk;
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

create unique index couranr_dre_sender_review_idempotency
  on public.couranr_delivery_request_events(request_id)
  where command='sender_cancellation_review_requested';

create function public.couranr_request_sender_cancellation_review(
  p_guest_session_id uuid,p_idempotency_key text,p_note text
)
returns uuid language plpgsql security invoker set search_path=''
as $fn$
declare
  v_session public.couranr_consumer_guest_sessions;
  v_request public.couranr_delivery_requests;
  v_existing uuid;
  v_id uuid;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key))<8
     or length(p_idempotency_key)>128
     or p_note is null or length(btrim(p_note))<5 or length(p_note)>1200 then
    raise exception 'sender_review_input_invalid' using errcode='CR400';
  end if;
  select s.* into v_session from public.couranr_consumer_guest_sessions s
   where s.id=p_guest_session_id and s.revoked_at is null and s.expires_at>now()
   for update;
  if not found or v_session.request_id is null then
    raise exception 'sender_review_not_available' using errcode='CR404';
  end if;
  select r.* into v_request from public.couranr_delivery_requests r
   where r.id=v_session.request_id and r.requester_kind='consumer'
     and r.business_account_id is null for update;
  if not found then raise exception 'sender_review_not_available' using errcode='CR404'; end if;
  select e.id into v_existing from public.couranr_delivery_request_events e
   where e.request_id=v_request.id and e.command='sender_cancellation_review_requested';
  if v_existing is not null then return v_existing; end if;
  if v_request.request_state not in (
    'awaiting_quote_acceptance','pending_couranr_review','quote_revision_required','confirmed'
  ) or exists(select 1 from public.couranr_deliveries d where d.request_id=v_request.id) then
    raise exception 'sender_review_use_delivery_help' using errcode='CR409';
  end if;
  insert into public.couranr_delivery_request_events(
    request_id,actor_user_id,actor_type,command,from_state,to_state,metadata
  ) values (
    v_request.id,null,'customer','sender_cancellation_review_requested',
    v_request.request_state,v_request.request_state,
    jsonb_build_object('idempotencyKey',p_idempotency_key,
                       'senderReviewNote',btrim(p_note),
                       'stage','before_delivery_creation')
  ) returning id into v_id;
  return v_id;
end
$fn$;

revoke all on function public.couranr_request_sender_cancellation_review(uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_request_sender_cancellation_review(uuid,text,text)
  to service_role;

-- A review request must enter the existing Operations queue even if an
-- automatic plan otherwise hides this request from routine manual work.
create or replace function public.couranr_operations_queue_candidates(
  p_limit integer default 200
)
returns table(request_id uuid,total_count bigint)
language sql security invoker set search_path=''
as $fn$
  with candidate as (
    select r.id,r.submitted_at,r.created_at
      from public.couranr_delivery_requests r
     where r.request_state in (
       'pending_couranr_review','confirmed','awaiting_quote_acceptance','quote_revision_required'
     )
       and (
         exists (
           select 1 from public.couranr_delivery_request_events e
            where e.request_id=r.id and e.command='sender_cancellation_review_requested'
              -- Automatic conversion must not make an unanswered customer
              -- request disappear from Operations during an active delivery.
              and not exists (
                select 1 from public.couranr_deliveries d
                 where d.request_id=r.id and d.fulfillment_state in
                   ('cancelled','could_not_deliver','delivered','returned')
              )
         )
         or exists (
           select 1 from public.couranr_automation_exceptions ax
            where ax.request_id=r.id and ax.exception_state='open'
         )
         or exists (
           select 1 from public.couranr_proof_sync_failures psf
            where psf.request_id=r.id and psf.failure_state='open'
         )
         or (
           not exists (
             select 1 from public.couranr_service_plans p
              where p.request_id=r.id and p.plan_state='confirmed'
                and p.plan_source='automatic'
           )
           and (
             not exists (
               select 1 from public.couranr_deliveries d where d.request_id=r.id
             )
             or exists (
               select 1 from public.couranr_deliveries d
               join public.couranr_service_plans p on p.id=d.service_plan_id
                where d.request_id=r.id and p.plan_source='operations'
                  and d.fulfillment_state='scheduled'
                  and not exists (
                    select 1 from public.couranr_delivery_assignments a
                     where a.delivery_id=d.id and a.assignment_state='active'
                  )
             )
           )
         )
       )
  ), ranked as (
    select id,submitted_at,created_at,count(*) over() as total_count from candidate
  )
  select id,total_count from ranked
   order by submitted_at asc nulls last,created_at asc
   limit greatest(1,least(coalesce(p_limit,200),200));
$fn$;
commit;
