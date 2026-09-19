-- Consumer Same Day requests are tenantless: business_account_id IS NULL.
-- The legacy Operations review opener and decline command compared tenant scope
-- with "=", so NULL = NULL evaluated to UNKNOWN and every consumer request
-- looked nonexistent. Keep the existing function bodies byte-for-byte except
-- for the tenant predicate, which must use NULL-safe equality just like the
-- already-hardened accept/requote review commands.
--
-- ADDITIVE/COMPATIBLE: no table/column/data changes; function signatures,
-- grants, state transitions, audit events, and error vocabulary are unchanged.

begin;

set local statement_timeout = '60s';
set local lock_timeout = '10s';

do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef(
    'public.couranr_begin_delivery_request_review(uuid,uuid,integer,uuid)'::regprocedure
  ) into v_def;

  if position('business_account_id = p_business_account_id' in v_def) = 0 then
    raise exception 'begin_review_expected_tenant_predicate_missing';
  end if;

  execute replace(
    v_def,
    'business_account_id = p_business_account_id',
    'business_account_id is not distinct from p_business_account_id'
  );

  select pg_get_functiondef(
    'public.couranr_decline_delivery_request(uuid,uuid,integer,uuid,text,text)'::regprocedure
  ) into v_def;

  if position('business_account_id = p_business_account_id' in v_def) = 0 then
    raise exception 'decline_expected_tenant_predicate_missing';
  end if;

  execute replace(
    v_def,
    'business_account_id = p_business_account_id',
    'business_account_id is not distinct from p_business_account_id'
  );
end
$migration$;

commit;
