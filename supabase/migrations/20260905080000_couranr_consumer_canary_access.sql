-- Consumer Same Day production canary access.
--
-- Production /send remains globally disabled unless the existing two-key live
-- switch is armed. Even then, this table limits SESSION CREATION to one
-- explicitly issued, one-time canary access credential. The raw access token,
-- raw cookie secret and raw guest token are never stored.
--
-- This is a release-control object, not product tenancy. RLS is deny-all and
-- every function is service_role only.

begin;

create table if not exists public.couranr_consumer_canary_access (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null,
  cookie_hash text,
  guest_session_id uuid,
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  session_created_at timestamptz,
  revoked_at timestamptz,

  -- Production spend containment. These counters belong to the ONE canary
  -- relationship, not to browser input and not to provider billing state.
  places_window_started_at timestamptz,
  places_request_count integer not null default 0,
  estimates_window_started_at timestamptz,
  estimate_request_count integer not null default 0,

  constraint couranr_cca_token_hash_uniq unique (token_hash),
  constraint couranr_cca_token_hash_shape_chk
    check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint couranr_cca_cookie_hash_uniq unique (cookie_hash),
  constraint couranr_cca_cookie_hash_shape_chk
    check (cookie_hash is null or cookie_hash ~ '^[0-9a-f]{64}$'),
  constraint couranr_cca_guest_session_uniq unique (guest_session_id),
  constraint couranr_cca_guest_session_fk foreign key (guest_session_id)
    references public.couranr_consumer_guest_sessions(id)
    on update cascade on delete restrict,
  constraint couranr_cca_expiry_chk check (expires_at > created_at),
  constraint couranr_cca_redeem_shape_chk check (
    (redeemed_at is null and cookie_hash is null)
    or (redeemed_at is not null and cookie_hash is not null)
  ),
  constraint couranr_cca_session_shape_chk check (
    (guest_session_id is null and session_created_at is null)
    or (guest_session_id is not null and session_created_at is not null)
  ),
  constraint couranr_cca_places_count_chk check (places_request_count >= 0),
  constraint couranr_cca_estimate_count_chk check (estimate_request_count >= 0)
);

comment on table public.couranr_consumer_canary_access is
  'One-time production /send canary access. Hash-only. Redeems to an HttpOnly cookie and may mint one guest session. Does not change request tenancy or commercial authority.';

alter table public.couranr_consumer_canary_access enable row level security;
revoke all on public.couranr_consumer_canary_access from public,anon,authenticated,service_role;
grant select,insert,update on public.couranr_consumer_canary_access to service_role;

create or replace function public.couranr_issue_consumer_canary_access(
  p_token_hash text,
  p_ttl_minutes integer,
  p_label text default null
)
returns public.couranr_consumer_canary_access
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_row public.couranr_consumer_canary_access;
  v_ttl integer:=least(greatest(coalesce(p_ttl_minutes,120),5),1440);
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}
    token_hash,label,expires_at
  ) values (
    p_token_hash,
    nullif(left(btrim(coalesce(p_label,'')),120),''),
    now()+make_interval(mins=>v_ttl)
  )
  returning * into v_row;

  return v_row;
end
$fn$;

create or replace function public.couranr_redeem_consumer_canary_access(
  p_token_hash text,
  p_cookie_hash text
)
returns public.couranr_consumer_canary_access
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_row public.couranr_consumer_canary_access;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  select * into v_row
    from public.couranr_consumer_canary_access
   where token_hash=p_token_hash
   for update;

  if not found
     or v_row.revoked_at is not null
     or v_row.expires_at<=now()
     or v_row.redeemed_at is not null then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  update public.couranr_consumer_canary_access
     set cookie_hash=p_cookie_hash,
         redeemed_at=now()
   where id=v_row.id
  returning * into v_row;

  return v_row;
end
$fn$;

create or replace function public.couranr_resolve_consumer_canary_cookie(
  p_cookie_hash text
)
returns public.couranr_consumer_canary_access
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_row public.couranr_consumer_canary_access;
begin
  if p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  select * into v_row
    from public.couranr_consumer_canary_access
   where cookie_hash=p_cookie_hash;

  if not found
     or v_row.redeemed_at is null
     or v_row.revoked_at is not null
     or v_row.expires_at<=now() then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  return v_row;
end
$fn$;

create or replace function public.couranr_create_consumer_canary_guest_session(
  p_cookie_hash text,
  p_guest_token_hash text,
  p_ttl_minutes integer
)
returns public.couranr_consumer_guest_sessions
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_access public.couranr_consumer_canary_access;
  v_session public.couranr_consumer_guest_sessions;
  v_ttl integer:=least(greatest(coalesce(p_ttl_minutes,1440),5),4320);
begin
  if p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$'
     or p_guest_token_hash is null or p_guest_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  select * into v_access
    from public.couranr_consumer_canary_access
   where cookie_hash=p_cookie_hash
   for update;

  if not found
     or v_access.redeemed_at is null
     or v_access.revoked_at is not null
     or v_access.expires_at<=now() then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  if v_access.guest_session_id is not null then
    raise exception 'canary_guest_session_already_created' using errcode='CR409';
  end if;

  -- Reuse the canonical guest-session issuer rather than duplicating its
  -- token/TTL authority. The canary may only SHORTEN that session to its own
  -- access expiry; it can never extend the canonical session TTL.
  select * into v_session
    from public.couranr_create_consumer_guest_session(
      p_guest_token_hash,
      v_ttl
    );

  update public.couranr_consumer_guest_sessions
     set expires_at=least(expires_at,v_access.expires_at)
   where id=v_session.id
  returning * into v_session;

  update public.couranr_consumer_canary_access
     set guest_session_id=v_session.id,
         session_created_at=now()
   where id=v_access.id;

  return v_session;
end
$fn$;

create or replace function public.couranr_claim_consumer_canary_place_search(
  p_guest_session_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_access public.couranr_consumer_canary_access;
  c_places_per_hour constant integer:=12;
begin
  select * into v_access
    from public.couranr_consumer_canary_access
   where guest_session_id=p_guest_session_id
   for update;

  if not found
     or v_access.revoked_at is not null
     or v_access.expires_at<=now()
     or v_access.redeemed_at is null then
    return false;
  end if;

  if v_access.places_window_started_at is null
     or v_access.places_window_started_at<=now()-interval '1 hour' then
    update public.couranr_consumer_canary_access
       set places_window_started_at=now(),
           places_request_count=1
     where id=v_access.id;
    return true;
  end if;

  if v_access.places_request_count>=c_places_per_hour then
    return false;
  end if;

  update public.couranr_consumer_canary_access
     set places_request_count=places_request_count+1
   where id=v_access.id;
  return true;
end
$fn$;

create or replace function public.couranr_claim_consumer_canary_estimate(
  p_guest_session_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_access public.couranr_consumer_canary_access;
  c_estimates_per_hour constant integer:=6;
begin
  select * into v_access
    from public.couranr_consumer_canary_access
   where guest_session_id=p_guest_session_id
   for update;

  if not found
     or v_access.revoked_at is not null
     or v_access.expires_at<=now()
     or v_access.redeemed_at is null then
    return false;
  end if;

  if v_access.estimates_window_started_at is null
     or v_access.estimates_window_started_at<=now()-interval '1 hour' then
    update public.couranr_consumer_canary_access
       set estimates_window_started_at=now(),
           estimate_request_count=1
     where id=v_access.id;
    return true;
  end if;

  if v_access.estimate_request_count>=c_estimates_per_hour then
    return false;
  end if;

  update public.couranr_consumer_canary_access
     set estimate_request_count=estimate_request_count+1
   where id=v_access.id;
  return true;
end
$fn$;

create or replace function public.couranr_revoke_consumer_canary_access(
  p_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_session_id uuid;
begin
  update public.couranr_consumer_canary_access
     set revoked_at=coalesce(revoked_at,now())
   where id=p_id
   returning guest_session_id into v_session_id;

  if not found then
    return false;
  end if;

  if v_session_id is not null then
    update public.couranr_consumer_guest_sessions
       set revoked_at=coalesce(revoked_at,now())
     where id=v_session_id;
  end if;

  return true;
end
$fn$;

revoke all on function public.couranr_issue_consumer_canary_access(text,integer,text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_redeem_consumer_canary_access(text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_resolve_consumer_canary_cookie(text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_create_consumer_canary_guest_session(text,text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_claim_consumer_canary_place_search(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_claim_consumer_canary_estimate(uuid)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_revoke_consumer_canary_access(uuid)
  from public,anon,authenticated,service_role;

grant execute on function public.couranr_issue_consumer_canary_access(text,integer,text)
  to service_role;
grant execute on function public.couranr_redeem_consumer_canary_access(text,text)
  to service_role;
grant execute on function public.couranr_resolve_consumer_canary_cookie(text)
  to service_role;
grant execute on function public.couranr_create_consumer_canary_guest_session(text,text,integer)
  to service_role;
grant execute on function public.couranr_claim_consumer_canary_place_search(uuid)
  to service_role;
grant execute on function public.couranr_claim_consumer_canary_estimate(uuid)
  to service_role;
grant execute on function public.couranr_revoke_consumer_canary_access(uuid)
  to service_role;

commit;
 then
    raise exception 'canary_token_invalid' using errcode='CR422';
  end if;

  -- One production canary at a time. The lock closes the concurrent issuance
  -- race; an active redeemed row is still a live canary until revoked/expired.
  perform pg_advisory_xact_lock(hashtext('couranr-consumer-send-canary'));
  if exists (
    select 1
      from public.couranr_consumer_canary_access
     where revoked_at is null
       and expires_at>now()
  ) then
    raise exception 'consumer_canary_already_active' using errcode='CR409';
  end if;

  insert into public.couranr_consumer_canary_access(
    token_hash,label,expires_at
  ) values (
    p_token_hash,
    nullif(left(btrim(coalesce(p_label,'')),120),''),
    now()+make_interval(mins=>v_ttl)
  )
  returning * into v_row;

  return v_row;
end
$fn$;

create or replace function public.couranr_redeem_consumer_canary_access(
  p_token_hash text,
  p_cookie_hash text
)
returns public.couranr_consumer_canary_access
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_row public.couranr_consumer_canary_access;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  select * into v_row
    from public.couranr_consumer_canary_access
   where token_hash=p_token_hash
   for update;

  if not found
     or v_row.revoked_at is not null
     or v_row.expires_at<=now()
     or v_row.redeemed_at is not null then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  update public.couranr_consumer_canary_access
     set cookie_hash=p_cookie_hash,
         redeemed_at=now()
   where id=v_row.id
  returning * into v_row;

  return v_row;
end
$fn$;

create or replace function public.couranr_resolve_consumer_canary_cookie(
  p_cookie_hash text
)
returns public.couranr_consumer_canary_access
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_row public.couranr_consumer_canary_access;
begin
  if p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  select * into v_row
    from public.couranr_consumer_canary_access
   where cookie_hash=p_cookie_hash;

  if not found
     or v_row.redeemed_at is null
     or v_row.revoked_at is not null
     or v_row.expires_at<=now() then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  return v_row;
end
$fn$;

create or replace function public.couranr_create_consumer_canary_guest_session(
  p_cookie_hash text,
  p_guest_token_hash text,
  p_ttl_minutes integer
)
returns public.couranr_consumer_guest_sessions
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_access public.couranr_consumer_canary_access;
  v_session public.couranr_consumer_guest_sessions;
  v_ttl integer:=least(greatest(coalesce(p_ttl_minutes,1440),5),4320);
begin
  if p_cookie_hash is null or p_cookie_hash !~ '^[0-9a-f]{64}$'
     or p_guest_token_hash is null or p_guest_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  select * into v_access
    from public.couranr_consumer_canary_access
   where cookie_hash=p_cookie_hash
   for update;

  if not found
     or v_access.redeemed_at is null
     or v_access.revoked_at is not null
     or v_access.expires_at<=now() then
    raise exception 'canary_access_not_available' using errcode='CR404';
  end if;

  if v_access.guest_session_id is not null then
    raise exception 'canary_guest_session_already_created' using errcode='CR409';
  end if;

  insert into public.couranr_consumer_guest_sessions(token_hash,expires_at)
  values (
    p_guest_token_hash,
    least(
      now()+make_interval(mins=>v_ttl),
      v_access.expires_at
    )
  )
  returning * into v_session;

  update public.couranr_consumer_canary_access
     set guest_session_id=v_session.id,
         session_created_at=now()
   where id=v_access.id;

  return v_session;
end
$fn$;

create or replace function public.couranr_revoke_consumer_canary_access(
  p_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path=''
as $fn$
declare
  v_session_id uuid;
begin
  update public.couranr_consumer_canary_access
     set revoked_at=coalesce(revoked_at,now())
   where id=p_id
   returning guest_session_id into v_session_id;

  if not found then
    return false;
  end if;

  if v_session_id is not null then
    update public.couranr_consumer_guest_sessions
       set revoked_at=coalesce(revoked_at,now())
     where id=v_session_id;
  end if;

  return true;
end
$fn$;

revoke all on function public.couranr_issue_consumer_canary_access(text,integer,text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_redeem_consumer_canary_access(text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_resolve_consumer_canary_cookie(text)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_create_consumer_canary_guest_session(text,text,integer)
  from public,anon,authenticated,service_role;
revoke all on function public.couranr_revoke_consumer_canary_access(uuid)
  from public,anon,authenticated,service_role;

grant execute on function public.couranr_issue_consumer_canary_access(text,integer,text)
  to service_role;
grant execute on function public.couranr_redeem_consumer_canary_access(text,text)
  to service_role;
grant execute on function public.couranr_resolve_consumer_canary_cookie(text)
  to service_role;
grant execute on function public.couranr_create_consumer_canary_guest_session(text,text,integer)
  to service_role;
grant execute on function public.couranr_revoke_consumer_canary_access(uuid)
  to service_role;

commit;
