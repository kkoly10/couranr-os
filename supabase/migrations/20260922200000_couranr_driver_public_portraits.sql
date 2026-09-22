-- Driver portrait V0: an Operations-approved, consent-recorded public identity.
-- A private Storage object is exposed only through a server-owned portrait
-- endpoint. Assignment-time name/portrait snapshots make dispatch mail stable
-- across retries and subsequent profile edits.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

do $$ begin
  if to_regclass('public.couranr_drivers') is null
     or to_regclass('public.couranr_delivery_assignments') is null
     or to_regclass('storage.buckets') is null
     or not exists(select 1 from information_schema.columns
                   where table_schema='public' and table_name='couranr_drivers'
                     and column_name='version') then
    raise exception 'driver_portrait_unknown_schema';
  end if;
end $$;

do $$ begin
  if exists(select 1 from storage.buckets where id='couranr-driver-portraits')
     and not exists(select 1 from storage.buckets
       where id='couranr-driver-portraits' and name='couranr-driver-portraits'
         and public=false and file_size_limit=1048576
         and allowed_mime_types=array['image/jpeg']::text[]) then
    raise exception 'driver_portrait_bucket_conflict';
  end if;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('couranr-driver-portraits','couranr-driver-portraits',false,1048576,array['image/jpeg'])
on conflict (id) do nothing;

create table public.couranr_driver_portraits (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.couranr_drivers(id) on delete restrict,
  public_id uuid not null unique default gen_random_uuid(),
  object_path text not null unique,
  consent_recorded_at timestamptz not null,
  approved_by uuid not null references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint couranr_driver_portrait_path_chk check (
    object_path ~ '^drivers/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
  ),
  constraint couranr_driver_portrait_driver_id_uniq unique(driver_id,id)
);
create index couranr_driver_portraits_driver_idx
  on public.couranr_driver_portraits(driver_id,created_at desc);
alter table public.couranr_driver_portraits enable row level security;
revoke all on public.couranr_driver_portraits from public,anon,authenticated,service_role;
grant select on public.couranr_driver_portraits to service_role;

alter table public.couranr_drivers
  add column current_portrait_id uuid references public.couranr_driver_portraits(id) on delete restrict;
alter table public.couranr_drivers add constraint couranr_driver_current_portrait_owner_fk
  foreign key(id,current_portrait_id) references public.couranr_driver_portraits(driver_id,id)
  on delete restrict;
alter table public.couranr_delivery_assignments
  add column driver_display_name_snapshot text,
  add column driver_portrait_id uuid references public.couranr_driver_portraits(id) on delete restrict;
alter table public.couranr_delivery_assignments add constraint couranr_assignment_portrait_owner_fk
  foreign key(driver_id,driver_portrait_id) references public.couranr_driver_portraits(driver_id,id)
  on delete restrict;

create function public.couranr_publish_driver_portrait(
  p_driver_id uuid,p_expected_version integer,p_actor_user_id uuid,
  p_object_path text,p_public_id uuid,p_consent_confirmed boolean
) returns public.couranr_driver_portraits
language plpgsql security definer set search_path=''
as $fn$
declare v_driver public.couranr_drivers; v_portrait public.couranr_driver_portraits;
begin
  if not exists(select 1 from public.profiles
                where id=p_actor_user_id and role='admin') then
    raise exception 'operations_actor_required' using errcode='CR403';
  end if;
  if p_consent_confirmed is distinct from true then
    raise exception 'driver_portrait_consent_required' using errcode='CR412';
  end if;
  if p_public_id is null or p_object_path is null
     or p_object_path !~ '^drivers/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'
     or split_part(p_object_path,'/',2) <> p_driver_id::text then
    raise exception 'driver_portrait_path_invalid' using errcode='CR422';
  end if;
  select * into v_driver from public.couranr_drivers
   where id=p_driver_id for update;
  if not found then raise exception 'driver_not_found' using errcode='CR404'; end if;
  if v_driver.version<>p_expected_version then
    raise exception 'version_conflict' using errcode='CR409';
  end if;
  insert into public.couranr_driver_portraits(
    driver_id,public_id,object_path,consent_recorded_at,approved_by
  ) values (p_driver_id,p_public_id,p_object_path,now(),p_actor_user_id)
  returning * into v_portrait;
  -- A replacement is also a revocation boundary. The old bytes remain in the
  -- private bucket as audit evidence, but every previously shared opaque URL
  -- must stop redeeming immediately.
  if v_driver.current_portrait_id is not null then
    update public.couranr_driver_portraits
       set revoked_at=coalesce(revoked_at,now())
     where id=v_driver.current_portrait_id;
  end if;
  update public.couranr_drivers
     set current_portrait_id=v_portrait.id,version=version+1,updated_at=now()
   where id=p_driver_id and version=p_expected_version;
  return v_portrait;
end $fn$;

create function public.couranr_revoke_driver_portrait(
  p_driver_id uuid,p_expected_version integer,p_actor_user_id uuid
) returns boolean
language plpgsql security definer set search_path=''
as $fn$
declare v_portrait_id uuid;
begin
  if not exists(select 1 from public.profiles
                where id=p_actor_user_id and role='admin') then
    raise exception 'operations_actor_required' using errcode='CR403';
  end if;
  select current_portrait_id into v_portrait_id from public.couranr_drivers
   where id=p_driver_id and version=p_expected_version for update;
  if not found then raise exception 'version_conflict' using errcode='CR409'; end if;
  if v_portrait_id is null then return false; end if;
  update public.couranr_driver_portraits set revoked_at=now()
   where id=v_portrait_id and revoked_at is null;
  update public.couranr_drivers
     set current_portrait_id=null,version=version+1,updated_at=now()
   where id=p_driver_id and version=p_expected_version;
  return true;
end $fn$;

create function public.couranr_snapshot_assigned_driver_identity()
returns trigger language plpgsql security definer set search_path=''
as $fn$
declare v_driver public.couranr_drivers; v_portrait_id uuid;
begin
  select * into v_driver from public.couranr_drivers where id=new.driver_id;
  if not found then raise exception 'driver_not_found' using errcode='CR404'; end if;
  select p.id into v_portrait_id from public.couranr_driver_portraits p
   where p.id=v_driver.current_portrait_id and p.revoked_at is null;
  new.driver_display_name_snapshot := v_driver.display_name;
  new.driver_portrait_id := v_portrait_id;
  return new;
end $fn$;
create trigger couranr_assignment_driver_identity_snapshot
  before insert on public.couranr_delivery_assignments
  for each row execute function public.couranr_snapshot_assigned_driver_identity();

revoke all on function public.couranr_publish_driver_portrait(uuid,integer,uuid,text,uuid,boolean)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_publish_driver_portrait(uuid,integer,uuid,text,uuid,boolean)
  to service_role;
revoke all on function public.couranr_revoke_driver_portrait(uuid,integer,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_revoke_driver_portrait(uuid,integer,uuid)
  to service_role;
revoke all on function public.couranr_snapshot_assigned_driver_identity()
  from public,anon,authenticated,service_role;

-- Forward repair: after a live portrait is published or a new assignment is
-- snapshotted, preserve both the bytes and the assignment's identity evidence.
commit;
