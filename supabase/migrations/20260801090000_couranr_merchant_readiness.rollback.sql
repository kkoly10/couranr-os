-- Rollback for 20260801090000_couranr_merchant_readiness.
--
-- Drops the functions this migration created. They did not exist before it,
-- so dropping is the true inverse. Any route or command that calls one will
-- fail after this runs — that is what reverting the migration means.

begin;

-- Dropped by catalog lookup rather than by a hardcoded signature: this handles
-- overloads and cannot drift from what was actually created.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any (array['couranr_assert_readiness_mutable', 'couranr_apply_readiness', 'couranr_begin_delivery_preparation', 'couranr_mark_delivery_ready', 'couranr_mark_delivery_not_ready', 'couranr_mark_delivery_unavailable'])
  loop
    -- No CASCADE. DROP FUNCTION ... CASCADE silently removes CHECK
    -- constraints and triggers that depend on the function; RESTRICT (the
    -- default) fails loudly instead, which is the same reason every table
    -- drop in these rollbacks is RESTRICT. The generator was inconsistent
    -- with itself here.
    execute 'drop function if exists ' || r.sig;
  end loop;
end $$;

commit;
