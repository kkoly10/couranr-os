-- =====================================================================
-- FOUNDATION GATE A / M2
-- Immutable quote-version schema and nullable quote identity FKs.
--
-- This stage creates authority but does not cut commands over yet. All new
-- pointers are nullable until M3 backfills and M5 validates the cutover.
-- =====================================================================

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if to_regclass('public.couranr_delivery_requests') is null
     or to_regclass('public.couranr_payment_obligations') is null
     or to_regclass('public.couranr_service_plans') is null
     or to_regclass('public.couranr_deliveries') is null then
    raise exception 'Gate A M2 requires the request/payment/plan/delivery spine';
  end if;
  if to_regclass('public.couranr_quote_versions') is not null then
    raise exception 'couranr_quote_versions already exists; refusing an unknown shape';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema='public'
       and ((table_name='couranr_delivery_requests' and column_name='current_quote_version_id')
         or (table_name in ('couranr_payment_obligations','couranr_service_plans','couranr_deliveries')
             and column_name='quote_version_id'))
  ) then
    raise exception 'Gate A M2 quote pointer columns already exist; refusing a partial application';
  end if;
end
$guard$;

create function public.couranr_quote_line_items_total(p_line_items jsonb)
returns bigint
language plpgsql
immutable
parallel safe
security invoker
set search_path = ''
as $fn$
declare
  v_total bigint;
begin
  if p_line_items is null or jsonb_typeof(p_line_items) <> 'array' then
    return null;
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_line_items) li
     where jsonb_typeof(li) <> 'object'
        or li ->> 'amountCents' is null
        or (li ->> 'amountCents') !~ '^-?[0-9]+$'
  ) then
    return null;
  end if;
  select coalesce(sum((li ->> 'amountCents')::bigint), 0)
    into v_total
    from jsonb_array_elements(p_line_items) li;
  return v_total;
exception when numeric_value_out_of_range or invalid_text_representation then
  return null;
end
$fn$;

revoke all on function public.couranr_quote_line_items_total(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.couranr_quote_line_items_total(jsonb) to service_role;

create table public.couranr_quote_versions (
  id                            uuid primary key default gen_random_uuid(),
  request_id                    uuid not null,
  quote_number                  integer not null,
  supersedes_quote_version_id   uuid,
  created_at                    timestamptz not null default now(),
  created_by_user_id            uuid,
  request_version_at_creation   integer not null,

  quote_status                  text not null,
  pricing_policy_version        text,
  payer_type                    text not null,
  currency                      text not null default 'usd',
  subtotal_cents                integer,
  included_loaded_miles         integer,
  billable_loaded_miles         numeric(8,3),
  quote_line_items              jsonb,
  review_reasons                jsonb not null default '[]'::jsonb,

  pickup_address_snapshot       jsonb,
  dropoff_address_snapshot      jsonb,
  recipient_snapshot            jsonb,
  shipment_snapshot             jsonb,
  service_configuration_snapshot jsonb,

  loaded_distance_miles         numeric(10,3),
  route_duration_seconds        integer,
  distance_source               text,

  provenance_state              text not null,
  record_origin                 text not null,
  legacy_evidence               jsonb,

  constraint couranr_qv_request_fk
    foreign key (request_id) references public.couranr_delivery_requests(id)
    on update cascade on delete restrict,
  constraint couranr_qv_created_by_fk
    foreign key (created_by_user_id) references auth.users(id)
    on update cascade on delete restrict,
  constraint couranr_qv_supersedes_fk
    foreign key (supersedes_quote_version_id) references public.couranr_quote_versions(id)
    on update cascade on delete restrict,
  constraint couranr_qv_request_number_uniq unique (request_id, quote_number),
  constraint couranr_qv_one_successor_uniq unique (supersedes_quote_version_id),
  constraint couranr_qv_id_request_uniq unique (id, request_id),
  constraint couranr_qv_number_positive_chk check (quote_number >= 1),
  constraint couranr_qv_request_version_chk check (request_version_at_creation >= 1),
  constraint couranr_qv_quote_status_chk check (quote_status in (
    'estimated','manual_review_required','invalid'
  )),
  constraint couranr_qv_payer_chk check (payer_type in ('merchant','customer')),
  constraint couranr_qv_currency_chk check (currency = 'usd'),
  constraint couranr_qv_subtotal_chk check (subtotal_cents is null or subtotal_cents >= 0),
  constraint couranr_qv_included_miles_chk check (
    included_loaded_miles is null or included_loaded_miles >= 0
  ),
  constraint couranr_qv_billable_miles_chk check (
    billable_loaded_miles is null or billable_loaded_miles >= 0
  ),
  constraint couranr_qv_route_distance_chk check (
    loaded_distance_miles is null or loaded_distance_miles >= 0
  ),
  constraint couranr_qv_route_duration_chk check (
    route_duration_seconds is null or route_duration_seconds >= 0
  ),
  constraint couranr_qv_review_reasons_array_chk check (
    jsonb_typeof(review_reasons) = 'array'
  ),
  constraint couranr_qv_line_items_array_chk check (
    quote_line_items is null or jsonb_typeof(quote_line_items) = 'array'
  ),
  constraint couranr_qv_snapshot_shapes_chk check (
    (pickup_address_snapshot is null or jsonb_typeof(pickup_address_snapshot) = 'object')
    and (dropoff_address_snapshot is null or jsonb_typeof(dropoff_address_snapshot) = 'object')
    and (recipient_snapshot is null or jsonb_typeof(recipient_snapshot) = 'object')
    and (shipment_snapshot is null or jsonb_typeof(shipment_snapshot) = 'object')
    and (service_configuration_snapshot is null or jsonb_typeof(service_configuration_snapshot) = 'object')
    and (legacy_evidence is null or jsonb_typeof(legacy_evidence) = 'object')
  ),
  constraint couranr_qv_provenance_chk check (
    provenance_state in ('verified','legacy_partial','legacy_mismatch')
  ),
  constraint couranr_qv_origin_chk check (
    record_origin in ('runtime','legacy_backfill')
  ),
  constraint couranr_qv_estimate_complete_chk check (
    quote_status <> 'estimated'
    or (pricing_policy_version is not null and subtotal_cents is not null)
  ),
  -- Legacy partial/mismatch rows may have no trustworthy complete line-item
  -- set. When line items are present, however, they always add up exactly.
  constraint couranr_qv_line_item_arithmetic_chk check (
    quote_line_items is null
    or (subtotal_cents is not null
        and public.couranr_quote_line_items_total(quote_line_items) = subtotal_cents::bigint)
    or (subtotal_cents is null
        and public.couranr_quote_line_items_total(quote_line_items) = 0)
  ),
  constraint couranr_qv_runtime_verified_chk check (
    record_origin <> 'runtime'
    or (provenance_state = 'verified'
        and (quote_status <> 'estimated' or quote_line_items is not null))
  )
);

comment on table public.couranr_quote_versions is
  'Append-only commercial authority. One immutable numbered quote history per canonical request; runtime may SELECT and INSERT only.';
comment on column public.couranr_quote_versions.request_version_at_creation is
  'Historical CAS evidence only. It is never quote identity or commercial freshness.';
comment on column public.couranr_quote_versions.legacy_evidence is
  'Original incomplete or mismatched request evidence retained without fabricating or altering financial facts.';

create index couranr_qv_request_created_idx
  on public.couranr_quote_versions(request_id, created_at desc);
create index couranr_qv_policy_idx
  on public.couranr_quote_versions(pricing_policy_version, created_at desc);

create function private.couranr_enforce_quote_sequence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $fn$
declare
  v_previous public.couranr_quote_versions;
begin
  if new.quote_number = 1 then
    if new.supersedes_quote_version_id is not null then
      raise exception 'first_quote_cannot_supersede' using errcode = 'CR422';
    end if;
  else
    if new.supersedes_quote_version_id is null then
      raise exception 'successor_quote_requires_predecessor' using errcode = 'CR422';
    end if;
    select * into v_previous
      from public.couranr_quote_versions
     where id = new.supersedes_quote_version_id;
    if not found
       or v_previous.request_id is distinct from new.request_id
       or v_previous.quote_number is distinct from new.quote_number - 1 then
      raise exception 'invalid_quote_predecessor' using errcode = 'CR422';
    end if;
  end if;
  return new;
end
$fn$;

revoke all on function private.couranr_enforce_quote_sequence()
  from public, anon, authenticated, service_role;
grant execute on function private.couranr_enforce_quote_sequence() to service_role;

create trigger couranr_qv_sequence_trg
before insert on public.couranr_quote_versions
for each row execute function private.couranr_enforce_quote_sequence();

alter table public.couranr_quote_versions enable row level security;
revoke all on table public.couranr_quote_versions
  from public, anon, authenticated, service_role;
grant select, insert on table public.couranr_quote_versions to service_role;

alter table public.couranr_delivery_requests
  add column current_quote_version_id uuid;
alter table public.couranr_payment_obligations
  add column quote_version_id uuid,
  alter column business_account_id drop not null;
alter table public.couranr_payment_access_tokens
  alter column business_account_id drop not null;
alter table public.couranr_service_plans
  add column quote_version_id uuid,
  alter column business_account_id drop not null;
alter table public.couranr_deliveries
  add column quote_version_id uuid,
  alter column business_account_id drop not null;

alter table public.couranr_delivery_requests
  add constraint couranr_dr_current_quote_request_fk
  foreign key (current_quote_version_id, id)
  references public.couranr_quote_versions(id, request_id)
  on update restrict on delete restrict not valid;
alter table public.couranr_payment_obligations
  add constraint couranr_po_quote_request_fk
  foreign key (quote_version_id, request_id)
  references public.couranr_quote_versions(id, request_id)
  on update restrict on delete restrict not valid;
alter table public.couranr_service_plans
  add constraint couranr_sp_quote_request_fk
  foreign key (quote_version_id, request_id)
  references public.couranr_quote_versions(id, request_id)
  on update restrict on delete restrict not valid;
alter table public.couranr_deliveries
  add constraint couranr_dlv_quote_request_fk
  foreign key (quote_version_id, request_id)
  references public.couranr_quote_versions(id, request_id)
  on update restrict on delete restrict not valid;

comment on column public.couranr_delivery_requests.current_quote_version_id is
  'Exact immutable quote currently projected onto the mutable request row.';
comment on column public.couranr_payment_obligations.quote_version_id is
  'Exact immutable quote whose amount/policy/payer this obligation authorizes.';
comment on column public.couranr_service_plans.quote_version_id is
  'Exact immutable quote for which Couranr confirmed this service plan.';
comment on column public.couranr_deliveries.quote_version_id is
  'Exact immutable accepted quote from which this delivery commercial snapshot was created.';
comment on column public.couranr_payment_obligations.request_version is
  'Historical request CAS generation observed when the obligation was created. Not commercial identity.';

alter table public.couranr_delivery_request_events
  drop constraint if exists couranr_dre_command_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_command_chk check (command = any (array[
    'create_delivery_request_draft','calculate_delivery_request_estimate',
    'create_quote_version','submit_delivery_request','begin_delivery_request_review',
    'accept_delivery_request_as_quoted','requote_delivery_request',
    'decline_delivery_request','record_payer_quote_approval',
    'begin_delivery_preparation','mark_delivery_ready','mark_delivery_not_ready',
    'mark_delivery_unavailable'
  ]));

commit;
