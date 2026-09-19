-- Restore the pre-fix tenant predicates for the two review functions.
-- This rollback changes no rows or object signatures.

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

do $rollback$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.couranr_begin_delivery_request_review(uuid,uuid,integer,uuid)'::regprocedure
  ) into v_def;

  if position('business_account_id is not distinct from p_business_account_id' in v_def) = 0 then
    raise exception 'begin_review_null_safe_predicate_missing';
  end if;

  execute replace(
    v_def,
    'business_account_id is not distinct from p_business_account_id',
    'business_account_id = p_business_account_id'
  );

  select pg_get_functiondef(
    'public.couranr_decline_delivery_request(uuid,uuid,integer,uuid,text,text)'::regprocedure
  ) into v_def;

  if position('business_account_id is not distinct from p_business_account_id' in v_def) = 0 then
    raise exception 'decline_null_safe_predicate_missing';
  end if;

  execute replace(
    v_def,
    'business_account_id is not distinct from p_business_account_id',
    'business_account_id = p_business_account_id'
  );
end
$rollback$;

commit;
