-- ROLLBACK for Gate A M1.
--
-- Safe only while every request still has the old business/authenticated-user
-- shape. It hard-refuses instead of destroying consumer identity, guest
-- authorship, or a new source value that the old schema cannot represent.

begin;
set local statement_timeout = '120s';
set local lock_timeout = '10s';

do $guard$
begin
  if exists (select 1 from public.couranr_delivery_requests where requester_kind <> 'business') then
    raise exception 'unsafe rollback: consumer requester history exists; use a forward repair';
  end if;
  if exists (select 1 from public.couranr_delivery_requests where business_account_id is null or created_by is null) then
    raise exception 'unsafe rollback: nullable tenancy/authorship is in use; use a forward repair';
  end if;
  if exists (select 1 from public.couranr_delivery_requests where source in ('consumer_send','api','import')) then
    raise exception 'unsafe rollback: post-Gate-A source identities exist; use a forward repair';
  end if;
  if exists (select 1 from public.couranr_delivery_request_events where actor_type = 'customer' and actor_user_id is null) then
    raise exception 'unsafe rollback: guest consumer audit history exists; use a forward repair';
  end if;
end
$guard$;

drop trigger if exists couranr_dr_requester_scope_trg on public.couranr_delivery_requests;
drop function if exists private.couranr_derive_requester_scope();

alter table public.couranr_delivery_request_events drop constraint if exists couranr_dre_actor_present_chk;
alter table public.couranr_delivery_request_events
  add constraint couranr_dre_actor_present_chk check (
    (actor_type = 'system' and actor_user_id is null)
    or (actor_type <> 'system' and actor_user_id is not null)
  );

alter table public.couranr_delivery_requests drop constraint if exists couranr_dr_source_chk;
alter table public.couranr_delivery_requests
  add constraint couranr_dr_source_chk check (source in (
    'merchant_portal','smart_intake','hosted_request','operations'
  ));

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_delivery_requests_scope_idempotency_uniq,
  drop constraint if exists couranr_dr_idempotency_key_nonempty_chk,
  drop constraint if exists couranr_dr_idempotency_scope_shape_chk,
  drop constraint if exists couranr_dr_consumer_submitted_contact_chk,
  drop constraint if exists couranr_dr_consumer_contact_object_chk,
  drop constraint if exists couranr_dr_requester_tenancy_chk,
  drop constraint if exists couranr_dr_requester_kind_chk;

alter table public.couranr_delivery_requests
  alter column business_account_id set not null,
  alter column created_by set not null,
  drop column if exists idempotency_scope,
  drop column if exists consumer_contact_snapshot,
  drop column if exists requester_kind;

commit;
