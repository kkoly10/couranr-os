begin;

-- Follow-up to production hardening 20260908143516. Successful Storage cleanup
-- must retire a tombstone from future 100-row batches without deleting the
-- evidence record itself.

alter table public.couranr_customer_problem_evidence
  add column if not exists storage_cleaned_at timestamptz;

create or replace function public.couranr_collect_expired_problem_evidence_ops(
  p_actor_user_id uuid,
  p_limit integer default 100
) returns table (
  out_id uuid,
  out_object_path text
)
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
begin
  select role into v_role
  from public.profiles
  where id=p_actor_user_id;

  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;
  if p_limit is null or p_limit<1 or p_limit>500 then
    raise exception 'cleanup_limit_invalid' using errcode='CR400';
  end if;

  return query
  with candidates as (
    select e.id
    from public.couranr_customer_problem_evidence e
    where e.upload_state in ('pending','abandoned')
      and e.expires_at<=now()
      and e.storage_cleaned_at is null
    order by e.expires_at asc,e.id
    limit p_limit
    for update skip locked
  ),
  changed as (
    update public.couranr_customer_problem_evidence e
       set upload_state='abandoned'
      from candidates c
     where e.id=c.id
    returning e.id,e.object_path
  )
  select c.id,c.object_path
  from changed c;
end
$fn$;

revoke all on function public.couranr_collect_expired_problem_evidence_ops(
  uuid,integer
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_collect_expired_problem_evidence_ops(
  uuid,integer
) to service_role;


create or replace function public.couranr_ack_problem_evidence_cleanup_ops(
  p_actor_user_id uuid,
  p_evidence_ids uuid[]
) returns integer
language plpgsql security invoker set search_path=''
as $fn$
declare
  v_role text;
  v_count integer;
begin
  select role into v_role
  from public.profiles
  where id=p_actor_user_id;

  if v_role is distinct from 'admin' then
    raise exception 'operations_access_required' using errcode='CR403';
  end if;
  if p_evidence_ids is null
     or coalesce(array_length(p_evidence_ids,1),0)<1
     or array_length(p_evidence_ids,1)>100 then
    raise exception 'cleanup_evidence_ids_invalid' using errcode='CR400';
  end if;

  -- ACK only rows that are still the expired abandoned grant we collected.
  -- If a customer legitimately reused the logical evidence row with a new
  -- server-owned path between collect and ACK, that row is pending/unexpired
  -- and must NOT be marked cleaned.
  update public.couranr_customer_problem_evidence e
     set storage_cleaned_at=now()
   where e.id=any(p_evidence_ids)
     and e.upload_state='abandoned'
     and e.expires_at<=now()
     and e.storage_cleaned_at is null;

  get diagnostics v_count=row_count;
  return v_count;
end
$fn$;

revoke all on function public.couranr_ack_problem_evidence_cleanup_ops(
  uuid,uuid[]
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_ack_problem_evidence_cleanup_ops(
  uuid,uuid[]
) to service_role;

comment on column public.couranr_customer_problem_evidence.storage_cleaned_at is
  'Set only after Operations receives a successful private Storage deletion response. '
  'Keeps successful cleanup tombstones out of future bounded cleanup batches.';

commit;
