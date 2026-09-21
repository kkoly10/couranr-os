-- Same Day lifecycle closure: a handoff code may only be minted while its
-- physical handoff is possible. Forward repair for prematurely issued codes
-- preserves their rows, generations, and audit history; it only supersedes
-- still-active credentials outside their valid stage.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if to_regclass('public.couranr_handoff_codes') is null
     or to_regclass('public.couranr_deliveries') is null then
    raise exception 'handoff_stage_authority_unknown_schema';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='couranr_handoff_codes'
                   and column_name='code_kind')
     or not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='couranr_deliveries'
                      and column_name='fulfillment_state') then
    raise exception 'handoff_stage_authority_unknown_columns';
  end if;
end $$;

create or replace function private.couranr_handoff_issue_stage_guard()
returns trigger language plpgsql security invoker set search_path=''
as $fn$
declare v_state text;
begin
  select d.fulfillment_state into v_state
    from public.couranr_deliveries d where d.id=new.delivery_id for update;
  if not found then raise exception 'delivery_not_found' using errcode='CR404'; end if;
  if new.code_kind='merchant_pickup'
     and v_state not in ('scheduled','assigned','en_route_to_pickup','at_pickup') then
    raise exception 'pickup_code_not_available_at_this_stage' using errcode='CR409';
  elsif new.code_kind='recipient_dropoff'
     and v_state not in ('picked_up','in_transit','at_dropoff') then
    raise exception 'recipient_code_not_available_before_custody' using errcode='CR409';
  elsif new.code_kind='merchant_return'
     and v_state not in ('return_required','returning') then
    raise exception 'return_code_not_available_at_this_stage' using errcode='CR409';
  end if;
  return new;
end
$fn$;

drop trigger if exists couranr_handoff_issue_stage_guard on public.couranr_handoff_codes;
create trigger couranr_handoff_issue_stage_guard
  before insert on public.couranr_handoff_codes
  for each row execute function private.couranr_handoff_issue_stage_guard();

create or replace function private.couranr_handoff_retire_on_stage_change()
returns trigger language plpgsql security invoker set search_path=''
as $fn$
begin
  if new.fulfillment_state is distinct from old.fulfillment_state then
    update public.couranr_handoff_codes c
       set code_state='superseded', superseded_at=now(),
           version=version+1, updated_at=now()
     where c.delivery_id=new.id and c.code_state in ('active','locked')
       and ((c.code_kind='merchant_pickup' and new.fulfillment_state not in
              ('scheduled','assigned','en_route_to_pickup','at_pickup'))
         or (c.code_kind='recipient_dropoff' and new.fulfillment_state not in
              ('picked_up','in_transit','at_dropoff'))
         or (c.code_kind='merchant_return' and new.fulfillment_state not in
              ('return_required','returning')));
  end if;
  return new;
end
$fn$;

drop trigger if exists couranr_handoff_retire_on_stage_change on public.couranr_deliveries;
create trigger couranr_handoff_retire_on_stage_change
  after update of fulfillment_state on public.couranr_deliveries
  for each row execute function private.couranr_handoff_retire_on_stage_change();

-- Already-minted, out-of-window codes cannot be left active across cutover.
update public.couranr_handoff_codes c
   set code_state='superseded', superseded_at=now(), version=c.version+1,
       updated_at=now()
  from public.couranr_deliveries d
 where d.id=c.delivery_id and c.code_state in ('active','locked')
   and ((c.code_kind='merchant_pickup' and d.fulfillment_state not in
           ('scheduled','assigned','en_route_to_pickup','at_pickup'))
     or (c.code_kind='recipient_dropoff' and d.fulfillment_state not in
           ('picked_up','in_transit','at_dropoff'))
     or (c.code_kind='merchant_return' and d.fulfillment_state not in
           ('return_required','returning')));

revoke all on function private.couranr_handoff_issue_stage_guard() from public,anon,authenticated;
revoke all on function private.couranr_handoff_retire_on_stage_change() from public,anon,authenticated;
commit;
