begin;

/*
 * Evidence-guarded rollback. Never erase the identity that makes an already
 * finalized offline proof idempotent, and never erase an Operations attention
 * record merely to make schema history look tidy.
 */
do $$
begin
  if exists (
    select 1 from public.couranr_delivery_proofs where client_evidence_id is not null
  ) or exists (
    select 1 from public.couranr_proof_uploads where client_evidence_id is not null
  ) or exists (
    select 1 from public.couranr_proof_sync_failures
  ) then
    raise exception 'offline_proof_sync_rollback_would_destroy_evidence' using errcode='CR409';
  end if;
end
$$;

drop function if exists public.couranr_report_proof_sync_failure(uuid,uuid,uuid,text,text,text,integer) restrict;
drop function if exists public.couranr_finalize_proof_upload_v2(uuid,uuid,text,integer,text) restrict;
drop function if exists public.couranr_abandon_proof_upload_v2(uuid,uuid,uuid) restrict;
drop function if exists public.couranr_prepare_proof_upload_v2(
  uuid,uuid,text,text,text,text,text,integer,text,integer,uuid,text,timestamptz,numeric,numeric,numeric,uuid
) restrict;

/* Restore the previous exception-first candidate selector. */
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
           select 1 from public.couranr_automation_exceptions ax
            where ax.request_id=r.id and ax.exception_state='open'
         )
         or (
           not exists (
             select 1 from public.couranr_service_plans p
              where p.request_id=r.id
                and p.plan_state='confirmed'
                and p.plan_source='automatic'
           )
           and (
             not exists (
               select 1 from public.couranr_deliveries d where d.request_id=r.id
             )
             or exists (
               select 1
                 from public.couranr_deliveries d
                 join public.couranr_service_plans p on p.id=d.service_plan_id
                where d.request_id=r.id
                  and p.plan_source='operations'
                  and d.fulfillment_state='scheduled'
                  and not exists (
                    select 1 from public.couranr_delivery_assignments a
                     where a.delivery_id=d.id and a.assignment_state='active'
                  )
             )
           )
         )
       )
  ),
  ranked as (
    select id,submitted_at,created_at,count(*) over() as total_count
      from candidate
  )
  select id,total_count
    from ranked
   order by submitted_at asc nulls last,created_at asc
   limit greatest(1,least(coalesce(p_limit,200),200));
$fn$;

revoke all on function public.couranr_operations_queue_candidates(integer)
  from public,anon,authenticated;
grant execute on function public.couranr_operations_queue_candidates(integer)
  to service_role;

drop table if exists public.couranr_proof_sync_failures restrict;

drop index if exists public.couranr_dp_client_evidence_uniq;
drop index if exists public.couranr_pu_client_evidence_idx;

alter table public.couranr_delivery_proofs
  drop constraint if exists couranr_dp_v2_identity_shape_chk,
  drop column if exists client_evidence_id,
  drop column if exists evidence_sha256,
  drop column if exists captured_at;

alter table public.couranr_proof_uploads
  drop constraint if exists couranr_pu_v2_discrepancy_fk,
  drop constraint if exists couranr_pu_v2_accuracy_chk,
  drop constraint if exists couranr_pu_v2_lng_chk,
  drop constraint if exists couranr_pu_v2_lat_chk,
  drop constraint if exists couranr_pu_v2_location_pair_chk,
  drop constraint if exists couranr_pu_v2_identity_shape_chk,
  drop column if exists client_evidence_id,
  drop column if exists evidence_sha256,
  drop column if exists captured_at,
  drop column if exists captured_latitude,
  drop column if exists captured_longitude,
  drop column if exists captured_accuracy_m,
  drop column if exists discrepancy_id;

commit;
