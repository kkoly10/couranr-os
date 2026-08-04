-- SEC-001 verification. Read-only: every statement is a catalog read or a
-- has_*_privilege call. Nothing here writes a row, and nothing here attempts
-- the escalation it checks for — proving the hole is closed by reading the
-- privilege system is both sufficient and the only option against live data.
--
-- Run against the project AFTER applying
-- 20260804120000_sec001_profiles_role_privilege.sql. Every row must report
-- PASS. Any FAIL means the escalation is open.

with checks as (

  -- 1. The privilege boundary. This is the fix; the rest is defence in depth.
  --    has_column_privilege is used rather than an information_schema grantee
  --    read because grantee rows do not show privileges inherited through
  --    PUBLIC, and this project's pg_default_acl grants broadly.
  select 1 as ord,
         'authenticated cannot UPDATE profiles at all' as check_name,
         not has_table_privilege('authenticated','public.profiles','update') as ok,
         has_table_privilege('authenticated','public.profiles','update')::text as observed

  union all
  select 2,
         'authenticated cannot UPDATE profiles.role specifically',
         not has_column_privilege('authenticated','public.profiles','role','update'),
         has_column_privilege('authenticated','public.profiles','role','update')::text

  union all
  select 3,
         'anon cannot UPDATE profiles at all',
         not has_table_privilege('anon','public.profiles','update'),
         has_table_privilege('anon','public.profiles','update')::text

  union all
  select 4,
         'anon cannot UPDATE profiles.role specifically',
         not has_column_privilege('anon','public.profiles','role','update'),
         has_column_privilege('anon','public.profiles','role','update')::text

  union all
  select 5,
         'PUBLIC holds no UPDATE on profiles.role (inherited-privilege check)',
         not has_column_privilege('public','public.profiles','role','update'),
         has_column_privilege('public','public.profiles','role','update')::text

  -- 2. The policy now states its WITH CHECK instead of relying on PostgreSQL
  --    substituting USING for it.
  union all
  select 6,
         'profiles_update_own has an explicit WITH CHECK',
         (select pol.polwithcheck is not null
            from pg_policy pol
           where pol.polrelid = 'public.profiles'::regclass
             and pol.polname  = 'profiles_update_own'),
         (select coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '<NULL>')
            from pg_policy pol
           where pol.polrelid = 'public.profiles'::regclass
             and pol.polname  = 'profiles_update_own')

  -- 3. Nothing legitimate was taken away.
  union all
  select 7,
         'service_role retains UPDATE, so admin role changes remain possible',
         has_table_privilege('service_role','public.profiles','update'),
         has_table_privilege('service_role','public.profiles','update')::text

  union all
  select 8,
         'reads are untouched: authenticated still holds SELECT',
         has_table_privilege('authenticated','public.profiles','select'),
         has_table_privilege('authenticated','public.profiles','select')::text

  -- 4. Signup still works. handle_new_user is SECURITY DEFINER owned by
  --    postgres, so it does not run with the caller's privileges, and it only
  --    INSERTs — a privilege this migration does not touch.
  union all
  select 9,
         'signup trigger is SECURITY DEFINER owned by postgres (revoke cannot affect it)',
         (select p.prosecdef and pg_get_userbyid(p.proowner) = 'postgres'
            from pg_proc p
           where p.proname = 'handle_new_user'
             and p.pronamespace = 'public'::regnamespace
           limit 1),
         (select p.prosecdef::text || ' / owner=' || pg_get_userbyid(p.proowner)
            from pg_proc p
           where p.proname = 'handle_new_user'
             and p.pronamespace = 'public'::regnamespace
           limit 1)

  union all
  select 10,
         'INSERT on profiles is untouched, so profile creation still works',
         has_table_privilege('authenticated','public.profiles','insert'),
         has_table_privilege('authenticated','public.profiles','insert')::text

  -- 5. The admin predicate still resolves. is_admin() only reads, so removing
  --    an UPDATE privilege cannot change its answer — but assert the real
  --    admin row still exists and the function is still SECURITY DEFINER,
  --    because that is what every server-side admin gate depends on.
  union all
  select 11,
         'the existing real admin still resolves through profiles.role',
         (select count(*) = 1 from public.profiles where role = 'admin'),
         (select count(*)::text || ' admin row(s) of ' ||
                 (select count(*)::text from public.profiles) || ' profiles'
            from public.profiles where role = 'admin')

  union all
  select 12,
         'is_admin() is still SECURITY DEFINER and reads profiles.role',
         (select p.prosecdef and pg_get_functiondef(p.oid) ilike '%role%=%admin%'
            from pg_proc p
           where p.proname = 'is_admin'
             and p.pronamespace = 'public'::regnamespace
           limit 1),
         (select p.prosecdef::text
            from pg_proc p
           where p.proname = 'is_admin'
             and p.pronamespace = 'public'::regnamespace
           limit 1)
)
select ord,
       check_name,
       case when ok then 'PASS' else 'FAIL' end as result,
       observed
from checks
order by ord;
