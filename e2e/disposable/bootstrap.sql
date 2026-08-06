-- Reproduces the parts of a Supabase project that no repository migration
-- creates, so a disposable cluster behaves like production rather than like a
-- bare PostgreSQL. Every item here was measured against the live project, not
-- assumed.
--
-- The two that matter most, and why:
--
--   pg_default_acl — the live project grants arwdDxtm on EVERY new table and
--   function in `public` to anon, authenticated AND service_role. Without
--   reproducing it, a narrow GRANT in a migration looks effective here and is a
--   silent no-op in production. Any privilege assertion run against a cluster
--   missing this proves nothing.
--
--   service_role BYPASSRLS — RLS constrains none of the server commands in
--   production. The GRANTs are the real boundary. A cluster where service_role
--   respects RLS would pass tests production would fail.

-- ── roles ───────────────────────────────────────────────────────────────────
-- Roles are CLUSTER-wide, not database-wide, so a second database in the same
-- cluster must not fail on "role already exists". Found by running this file
-- twice, which is exactly what a disposable harness does.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  -- PostgREST logs in as this role and SET ROLEs to one of the three above
  -- based on the verified JWT. It must not inherit their privileges implicitly.
  if not exists (select 1 from pg_roles where rolname='authenticator') then
    create role authenticator login noinherit password 'postgrest_local_only';
  end if;
end
$roles$;
grant anon, authenticated, service_role to authenticator;

-- ── schemas ─────────────────────────────────────────────────────────────────
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

-- Production installs pgcrypto INTO the `extensions` schema, and migration
-- 20260802040000 calls `extensions.gen_random_bytes(...)` by that qualified
-- name. Installing it into `public` instead makes that migration fail, which
-- is how this line was found rather than assumed.
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;

-- ── the default ACL trap, reproduced ────────────────────────────────────────
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;

-- ── auth schema: the surface migrations and policies actually reference ─────
create table if not exists auth.users (
  id            uuid primary key default gen_random_uuid(),
  email         text unique,
  -- REAL bcrypt, via pgcrypto. The disposable /auth/v1 verifies a password with
  -- `crypt(candidate, encrypted_password) = encrypted_password`, exactly as
  -- GoTrue does, so a wrong password genuinely fails rather than being waved
  -- through. Storing a plaintext column here would make every auth assertion
  -- in the harness meaningless.
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- auth.uid() / auth.jwt() / auth.role() read the request-scoped GUC that
-- PostgREST sets from the verified JWT. Same mechanism as production.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select auth.jwt() ->> 'role'
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role()
  to anon, authenticated, service_role;

-- ── storage: buckets and objects, matching the live shape ───────────────────
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets(id),
  name        text not null,
  owner       uuid,
  metadata    jsonb,
  created_at  timestamptz not null default now(),
  unique (bucket_id, name)
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('delivery-photos',  'delivery-photos',  false, 10485760,
     array['image/jpeg','image/png','image/webp','image/heic']),
  ('renter-licenses',  'renter-licenses',  false, null, null),
  ('vehicle-images',   'vehicle-images',   true,  null, null),
  ('docs-files',       'docs-files',       false, null, null)
on conflict (id) do nothing;

-- ── the migration ledger, same table the Supabase CLI reads ─────────────────
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  statements text[],
  name       text
);

-- ── tables no forward migration creates ─────────────────────────────────────
-- Column shapes read from the live project's information_schema, not invented.
-- business_accounts.timezone already defaults to America/New_York there, which
-- is corroboration for HRS-002 rather than its authority.
create table if not exists public.business_accounts (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text,
  legal_name    text,
  billing_email text,
  phone         text,
  website       text,
  status        text not null default 'active',
  timezone      text not null default 'America/New_York',
  notes         text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.business_members (
  id                  uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  user_id             uuid not null,
  role                text not null,
  status              text not null default 'active',
  invited_email       text,
  invited_by          uuid,
  joined_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  role       text not null default 'customer',
  created_at timestamptz default now()
);

-- ── the `remote_schema` baseline's profiles surface ─────────────────────────
-- These objects predate every repository migration; they arrived in the
-- `remote_schema` baseline row, whose SQL the repository does not carry. They
-- are reproduced here because migration 20260804120000 (SEC-001) ALTERs one of
-- them and fails outright without it.
--
-- IMPORTANT: `profiles_update_own` is created here in its PRE-SEC-001 form —
-- USING only, WITH CHECK absent. That is the vulnerable shape: PostgreSQL
-- substitutes USING for a missing WITH CHECK, which constrains WHICH ROW is
-- written and never WHICH COLUMNS, so a signed-in user could rewrite their own
-- `role`. Creating it already-fixed would make the SEC-001 migration a no-op
-- here and the replay would prove nothing.
create or replace function public.is_admin(check_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.profiles p
     where p.id = check_user_id and p.role = 'admin'
  );
$$;

alter table public.profiles enable row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (auth.uid() = id);

-- deliberately no WITH CHECK — see the note above
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (auth.uid() = id);

drop policy if exists admin_all_profiles on public.profiles;
create policy admin_all_profiles on public.profiles
  for all to authenticated using (public.is_admin());

-- The baseline also grants `authenticated` DML on profiles. SEC-001 revokes
-- UPDATE; without the grant existing first, the revoke is untestable.
grant select, insert, update on public.profiles to authenticated;

-- ── the three functions the disposable /auth/v1 is built on ────────────────
--
-- These stand in for GoTrue's password store, and ONLY for that. They are
-- `security definer` because `auth.users` is granted to nobody here — which is
-- the point: `authenticated` must not be able to read the user table, exactly
-- as in production. The definer owner is `postgres`, so the function can read
-- it while its callers cannot.
--
-- Execute is REVOKED from anon and authenticated immediately below. Without
-- that revoke `pg_default_acl` would grant it to both, and the browser's own
-- anon key could call the password oracle directly — which would make every
-- refusal assertion in the harness worthless.
--
-- bcrypt at cost 6 rather than the usual 10: this is a throwaway database and
-- a run that signs in six times should not spend seconds on key stretching.
-- The ALGORITHM is real, and a wrong password genuinely fails.
create or replace function public.couranr_disposable_set_password(
  p_user_id uuid, p_password text
) returns void language sql security definer
set search_path = public, extensions, pg_temp
as $$
  update auth.users
     set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 6))
   where id = p_user_id;
$$;

create or replace function public.couranr_disposable_verify_password(
  p_email text, p_password text
) returns uuid language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select u.id from auth.users u
   where u.email = p_email
     and u.encrypted_password is not null
     and extensions.crypt(p_password, u.encrypted_password) = u.encrypted_password;
$$;

-- The body GoTrue returns from `GET /auth/v1/user`, built from the REAL row.
-- The gateway composes nothing: it verifies the token signature and then asks
-- this function who that `sub` actually is. A token for a deleted user
-- therefore yields no user, which is what production does too.
create or replace function public.couranr_disposable_auth_user(p_user_id uuid)
returns jsonb language sql stable security definer
set search_path = public, extensions, pg_temp
as $$
  select jsonb_build_object(
    'id',                 u.id,
    'aud',                'authenticated',
    'role',               'authenticated',
    'email',              u.email,
    'email_confirmed_at', u.created_at,
    'confirmed_at',       u.created_at,
    'last_sign_in_at',    u.created_at,
    'phone',              '',
    'app_metadata',       jsonb_build_object(
                            'provider', 'email',
                            'providers', jsonb_build_array('email')
                          ),
    'user_metadata',      coalesce(u.raw_user_meta_data, '{}'::jsonb),
    'identities',         '[]'::jsonb,
    'created_at',         u.created_at,
    'updated_at',         u.created_at,
    'is_anonymous',       false
  )
  from auth.users u
  where u.id = p_user_id;
$$;

-- `from public` is NOT redundant with `from anon, authenticated`, and leaving
-- it out was a real defect here: PostgreSQL grants EXECUTE on a new function to
-- PUBLIC by default, `alter default privileges` ADDS to that rather than
-- replacing it, and A14 measured `authenticated` calling the password oracle
-- through PostgREST with a 200 while the two named roles had been revoked. The
-- explicit service_role grant from pg_default_acl survives this.
revoke execute on function
  public.couranr_disposable_set_password(uuid, text),
  public.couranr_disposable_verify_password(text, text),
  public.couranr_disposable_auth_user(uuid)
from public, anon, authenticated;

-- A probe, not a fixture: reports the role PostgREST actually SET and the uid
-- it derived from the verified JWT. It is what turns "the token was accepted"
-- into "the token was accepted AS THIS USER, as `authenticated`". Defined here
-- rather than by a harness because PostgREST caches the schema at startup — a
-- function created afterwards answers PGRST202 until a reload.
create or replace function public.couranr_disposable_whoami()
returns jsonb language sql stable
as $$
  select jsonb_build_object(
    'db_role',  current_user,
    'jwt_role', auth.role(),
    'uid',      auth.uid()
  )
$$;
