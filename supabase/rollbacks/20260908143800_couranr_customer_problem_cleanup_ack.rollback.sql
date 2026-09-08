begin;

drop function if exists public.couranr_ack_problem_evidence_cleanup_ops(uuid,uuid[]);

-- Restore the pre-ack cleanup selector. This does not delete evidence rows; it
-- only makes old expired tombstones eligible for cleanup again.
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

alter table public.couranr_customer_problem_evidence
  drop column if exists storage_cleaned_at;

commit;
