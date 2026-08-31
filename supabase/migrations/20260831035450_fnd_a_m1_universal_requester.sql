-- =====================================================================
-- FOUNDATION GATE A / M1
-- Universal requester identity, nullable business tenancy, and durable
-- server-derived idempotency scope.
--
-- ADDITIVE DATA POLICY
--   * existing request ids, timestamps, states, amounts and keys are unchanged
--   * every existing row becomes requester_kind = business
--   * every existing scope is deterministically business:<account uuid>
--   * the legacy (business_account_id, idempotency_key) unique constraint stays
--
-- The derivation trigger is compatibility infrastructure for the existing
-- business command. A future consumer server session may provide a
-- consumer:<opaque-server-scope> value, but browser roles have neither table
-- DML nor function EXECUTE and therefore cannot choose an authority scope.
-- =====================================================================

begin;

set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regclass('public.couranr_delivery_requests') is null
     or to_regclass('public.couranr_delivery_request_events') is null then
    raise exception 'Gate A M1 requires the canonical request tables';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'couranr_delivery_requests'
       and column_name in ('requester_kind','consumer_contact_snapshot','idempotency_scope')
  ) then
    raise exception 'Gate A M1 columns already exist; refusing an unknown partial application';
  end if;
  if exists (
    select 1 from public.couranr_delivery_requests
     where business_account_id is null or created_by is null
  ) then
    raise exception 'Gate A M1 expected the pre-cutover NOT NULL requester shape';
  end if;
end
$guard$;

alter table public.couranr_delivery_requests
  add column requester_kind text not null default 'business',
  add column consumer_contact_snapshot jsonb not null default '{}'::jsonb,
  add column idempotency_scope text;

update public.couranr_delivery_requests
   set idempotency_scope = 'business:' || business_account_id::text
 where idempotency_scope is null;

alter table public.couranr_delivery_requests
  alter column idempotency_scope set not null,
  alter column business_account_id drop not null,
  alter column created_by drop not null;

alter table public.couranr_delivery_requests
  add constraint couranr_dr_requester_kind_chk
    check (requester_kind in ('business','consumer')),
  add constraint couranr_dr_requester_tenancy_chk
    check (
      (requester_kind = 'business' and business_account_id is not null)
      or (requester_kind = 'consumer' and business_account_id is null)
    ),
  add constraint couranr_dr_consumer_contact_object_chk
    check (jsonb_typeof(consumer_contact_snapshot) = 'object'),
  add constraint couranr_dr_consumer_submitted_contact_chk
    check (
      requester_kind <> 'consumer'
      or request_state in ('draft','awaiting_merchant_confirmation')
      or nullif(btrim(consumer_contact_snapshot ->> 'phone'), '') is not null
      or nullif(btrim(consumer_contact_snapshot ->> 'email'), '') is not null
    ),
  add constraint couranr_dr_idempotency_scope_shape_chk
    check (
      (requester_kind = 'business'
       and idempotency_scope = 'business:' || business_account_id::text)
      or (requester_kind = 'consumer'
       and idempotency_scope ~ '^consumer:[A-Za-z0-9._~:-]+$'
       and length(idempotency_scope) between 25 and 265)
    ),
  add constraint couranr_dr_idempotency_key_nonempty_chk
    check (length(btrim(idempotency_key)) > 0),
  add constraint couranr_delivery_requests_scope_idempotency_uniq
    unique (idempotency_scope, idempotency_key);

comment on column public.couranr_delivery_requests.requester_kind is
  'Who requested the delivery: business or consumer. Independent of payer_type.';
comment on column public.couranr_delivery_requests.created_by is
  'Authenticated user that created this request, when one exists. Null is valid for a guest consumer.';
comment on column public.couranr_delivery_requests.consumer_contact_snapshot is
  'Immutable request-time V0 consumer contact snapshot. May contain name, phone and email; submitted consumer requests require phone or email.';
comment on column public.couranr_delivery_requests.idempotency_scope is
  'Server-derived authority scope. Business scopes are business:<account-id>; consumer scopes are opaque server-controlled consumer:* values.';

-- Preserve historical smart_intake values but admit source identities needed
-- by the universal request model. Application code no longer offers
-- smart_intake as a source for newly-created requests.
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_source_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_source_chk check (source in (
    'merchant_portal','consumer_send','hosted_request','operations',
    'api','import','smart_intake'
  ));

-- A guest consumer may be the causal actor without an auth.users row. System
-- events remain strictly userless; merchant/driver/operations still require a
-- real actor id.
alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_actor_present_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_actor_present_chk check (
    (actor_type = 'system' and actor_user_id is null)
    or (actor_type = 'customer')
    or (actor_type in ('merchant','driver','operations') and actor_user_id is not null)
  );

create function private.couranr_derive_requester_scope()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
begin
  if tg_op = 'UPDATE' then
    if new.requester_kind is distinct from old.requester_kind
       or new.business_account_id is distinct from old.business_account_id
       or new.idempotency_scope is distinct from old.idempotency_scope
       or new.consumer_contact_snapshot is distinct from old.consumer_contact_snapshot then
      raise exception 'requester_identity_is_immutable' using errcode = 'CR409';
    end if;
    return new;
  end if;

  if new.requester_kind = 'business' then
    if new.business_account_id is null then
      raise exception 'business_requester_requires_business_account' using errcode = 'CR422';
    end if;
    new.idempotency_scope := 'business:' || new.business_account_id::text;
    new.consumer_contact_snapshot := '{}'::jsonb;
  elsif new.requester_kind = 'consumer' then
    if new.business_account_id is not null then
      raise exception 'consumer_requester_cannot_have_business_account' using errcode = 'CR422';
    end if;
    if new.idempotency_scope is null
       or new.idempotency_scope !~ '^consumer:[A-Za-z0-9._~:-]+$'
       or length(new.idempotency_scope) not between 25 and 265 then
      raise exception 'server_consumer_idempotency_scope_required' using errcode = 'CR422';
    end if;
  else
    raise exception 'unknown_requester_kind' using errcode = 'CR422';
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_derive_requester_scope() from public, anon, authenticated, service_role;
grant execute on function private.couranr_derive_requester_scope() to service_role;

create trigger couranr_dr_requester_scope_trg
before insert or update on public.couranr_delivery_requests
for each row execute function private.couranr_derive_requester_scope();

-- Reassert the service-only posture after adding public-schema columns.
revoke all on table public.couranr_delivery_requests from public, anon, authenticated;
grant select, insert, update on table public.couranr_delivery_requests to service_role;

commit;
