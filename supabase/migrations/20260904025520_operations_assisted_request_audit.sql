-- Operations-assisted delivery entry audit identity.
--
-- The existing routed request RPCs are shared with the Merchant portal and
-- historically insert actor_type='merchant' for create/estimate, while submit
-- derives merchant from requester_kind. Assisted entry deliberately reuses
-- those RPCs, so source='operations' is the server-owned evidence that the
-- actor was Couranr Operations rather than the merchant.
--
-- This BEFORE INSERT guard changes only the three assisted-entry event types.
-- It does not widen DML grants, request permissions, or RPC signatures.

create or replace function private.couranr_normalize_operations_request_event_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_source text;
begin
  if new.actor_user_id is null then
    return new;
  end if;

  if new.actor_type = 'merchant'
     and new.command in (
       'create_delivery_request_draft',
       'calculate_delivery_request_estimate',
       'submit_delivery_request'
     ) then
    select r.source
      into v_source
      from public.couranr_delivery_requests r
     where r.id = new.request_id;

    if v_source = 'operations' then
      new.actor_type := 'operations';
    end if;
  end if;

  return new;
end
$$;

revoke all on function private.couranr_normalize_operations_request_event_actor() from public;

drop trigger if exists couranr_dre_operations_actor_normalize_trg
  on public.couranr_delivery_request_events;

create trigger couranr_dre_operations_actor_normalize_trg
before insert on public.couranr_delivery_request_events
for each row
execute function private.couranr_normalize_operations_request_event_actor();

comment on function private.couranr_normalize_operations_request_event_actor() is
  'Audit guard: operations-assisted business requests retain operations actor identity for create/estimate/submit events.';
