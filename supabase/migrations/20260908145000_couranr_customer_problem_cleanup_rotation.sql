begin;

-- CUS-004 cleanup-generation correction. Once an expired row has been deleted
-- and acknowledged by Operations, reusing that logical clientEvidenceId must
-- start a NEW cleanup generation. Otherwise storage_cleaned_at from the old
-- object path would suppress cleanup of the newly rotated path.

create or replace function public.couranr_prepare_customer_problem_evidence(
  p_token_id uuid,
  p_report_id uuid,
  p_client_evidence_id uuid,
  p_object_path text,
  p_expected_mime text,
  p_expected_bytes integer,
  p_evidence_sha256 text
) returns public.couranr_customer_problem_evidence
language plpgsql security definer set search_path=''
as $fn$
declare
  v_delivery uuid;
  v_report public.couranr_customer_problem_reports;
  v_existing public.couranr_customer_problem_evidence;
  v_row public.couranr_customer_problem_evidence;
  v_count integer;
  v_prefix text;
begin
  select h.delivery_id into v_delivery
  from public.couranr_help_access_tokens h
  where h.id=p_token_id and h.revoked_at is null and h.expires_at>now();

  if v_delivery is null then
    raise exception 'help_link_not_available' using errcode='CR404';
  end if;

  select * into v_report
  from public.couranr_customer_problem_reports
  where id=p_report_id and delivery_id=v_delivery
  for update;

  if v_report.id is null then
    raise exception 'problem_report_not_found' using errcode='CR404';
  end if;
  if v_report.report_state not in ('draft','awaiting_evidence') then
    raise exception 'problem_evidence_not_open' using errcode='CR409';
  end if;
  if p_expected_mime not in ('image/jpeg','image/png','image/webp','image/heic') then
    raise exception 'problem_evidence_mime_invalid' using errcode='CR400';
  end if;
  if p_expected_bytes is null or p_expected_bytes<1 or p_expected_bytes>10485760 then
    raise exception 'problem_evidence_size_invalid' using errcode='CR400';
  end if;
  if p_evidence_sha256 is null or p_evidence_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'problem_evidence_digest_invalid' using errcode='CR400';
  end if;

  select * into v_existing
  from public.couranr_customer_problem_evidence
  where report_id=p_report_id and client_evidence_id=p_client_evidence_id;

  if v_existing.id is not null then
    if v_existing.expected_mime is distinct from p_expected_mime
       or v_existing.expected_bytes is distinct from p_expected_bytes
       or v_existing.evidence_sha256 is distinct from p_evidence_sha256 then
      raise exception 'problem_evidence_identity_conflict' using errcode='CR409';
    end if;

    if v_existing.upload_state='verified' then
      return v_existing;
    end if;

    if v_existing.expires_at<=now() then
      -- The server wrapper cleans the expired object's old storage path BEFORE
      -- calling this refresh. Reuse the logical client evidence identity but
      -- rotate its server-owned destination only after the provider URL is
      -- certainly dead.
      update public.couranr_customer_problem_evidence
         set object_path=p_object_path,
             upload_state='pending',
             finalized_at=null,
             storage_cleaned_at=null,
             expires_at=now()+interval '125 minutes'
       where id=v_existing.id
      returning * into v_existing;
      return v_existing;
    end if;

    if v_existing.upload_state='abandoned' then
      -- The old provider URL is still alive and still consumes one of the
      -- five technical grant slots until its two-hour lifetime ends.
      raise exception 'problem_evidence_grant_still_active' using errcode='CR409';
    end if;

    return v_existing;
  end if;

  select count(*) into v_count
  from public.couranr_customer_problem_evidence
  where report_id=p_report_id
    and (
      upload_state='verified'
      or (upload_state in ('pending','abandoned') and expires_at>now())
    );

  -- Technical storage/abuse guard, not a claim/compensation policy.
  if v_count>=5 then
    raise exception 'problem_evidence_limit_reached' using errcode='CR400';
  end if;

  v_prefix:='customer-problem/v1/'||v_delivery::text||'/'||
            p_report_id::text||'/'||p_client_evidence_id::text||'/';
  if p_object_path is null
     or left(p_object_path,length(v_prefix))<>v_prefix
     or p_object_path !~ '^customer-problem/v1/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f]{32}\.(jpg|png|webp|heic)$' then
    raise exception 'problem_evidence_path_invalid' using errcode='CR422';
  end if;

  insert into public.couranr_customer_problem_evidence(
    report_id,client_evidence_id,object_path,
    expected_mime,expected_bytes,evidence_sha256
  ) values (
    p_report_id,p_client_evidence_id,p_object_path,
    p_expected_mime,p_expected_bytes,p_evidence_sha256
  ) returning * into v_row;

  insert into public.couranr_customer_problem_report_events(
    report_id,actor_kind,actor_user_id,command,from_state,to_state,metadata
  ) values (
    p_report_id,'customer',null,'photo_prepared',
    v_report.report_state,v_report.report_state,
    jsonb_build_object('evidenceId',v_row.id)
  );
  return v_row;
end
$fn$;

revoke all on function public.couranr_prepare_customer_problem_evidence(
  uuid,uuid,uuid,text,text,integer,text
) from public,anon,authenticated,service_role;
grant execute on function public.couranr_prepare_customer_problem_evidence(
  uuid,uuid,uuid,text,text,integer,text
) to service_role;

commit;
