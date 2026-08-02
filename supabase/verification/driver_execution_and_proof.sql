/*
 * Re-runnable, READ-ONLY verification of the driver-execution boundary.
 *
 * These are the guarantees that live in grants, CHECK constraints and function
 * declarations rather than in TypeScript — the ones green unit tests never
 * touch. Every row carries an `ok` column; all must be true.
 *
 * Structural only, and deliberately so: it writes nothing, so it can be run
 * against the live project at any time. The BEHAVIOURAL proofs (wrong driver
 * refused, state skipping refused, five attempts lock, truncated object
 * refused, delivered completes exactly once) require synthetic fixtures and
 * live in browser Group Q, which creates and marks its own rows.
 *
 *   psql "$DATABASE_URL" -f supabase/verification/driver_execution_and_proof.sql
 * or paste into the SQL editor.
 */

with fns(name) as (values
  ('couranr_driver_assignment_for'),
  ('couranr_release_assignment_resources'),
  ('couranr_start_route_to_pickup'),
  ('couranr_arrive_at_pickup'),
  ('couranr_start_route_to_dropoff'),
  ('couranr_arrive_at_dropoff'),
  ('couranr_complete_pickup'),
  ('couranr_finish_delivered'),
  ('couranr_assert_dropoff_ready'),
  ('couranr_complete_direct_handoff_delivery'),
  ('couranr_complete_signature_delivery'),
  ('couranr_complete_leave_at_door_delivery'),
  ('couranr_unassign_delivery_before_pickup'),
  ('couranr_issue_handoff_code'),
  ('couranr_verify_handoff_code'),
  ('couranr_create_proof_upload'),
  ('couranr_finalize_proof_upload'),
  ('couranr_report_pickup_discrepancy'),
  ('couranr_resolve_pickup_discrepancy_safe_to_continue'),
  ('couranr_driver_completion_receipt')
),
p as (
  select f.name, pr.oid, pr.prosecdef, pr.proconfig,
         pg_get_function_identity_arguments(pr.oid) as args
    from fns f
    join pg_proc pr on pr.proname = f.name
    join pg_namespace n on n.oid = pr.pronamespace and n.nspname = 'public'
),
tbls(name, expect_update) as (values
  ('couranr_handoff_codes', true),
  ('couranr_proof_uploads', true),
  ('couranr_pickup_discrepancies', true),
  ('couranr_delivery_proofs', false),
  ('couranr_handoff_records', false)
)

/* 1. Every command exists. A missing one would make later checks vacuous. */
select '01 all commands exist' as check,
       (select count(*) from p) = (select count(*) from fns) as ok,
       (select count(*) from p)::text || ' of ' || (select count(*) from fns)::text as detail

/* 2. service_role only. `pg_default_acl` grants EXECUTE to anon and
      authenticated on every new function in public, so this is the check that
      the REVOKE actually happened — a bare GRANT would be a silent no-op.
      has_function_privilege, never information_schema: grantee rows miss
      privileges inherited through PUBLIC. */
union all
select '02 execute is service_role only',
       bool_and(has_function_privilege('service_role', oid, 'EXECUTE'))
         and not bool_or(has_function_privilege('anon', oid, 'EXECUTE'))
         and not bool_or(has_function_privilege('authenticated', oid, 'EXECUTE')),
       'anon=' || count(*) filter (where has_function_privilege('anon', oid, 'EXECUTE'))::text ||
       ' authenticated=' || count(*) filter (where has_function_privilege('authenticated', oid, 'EXECUTE'))::text
from p

/* 3. SECURITY INVOKER. A DEFINER function would run as its owner and silently
      bypass the per-query scoping the commands rely on. */
union all
select '03 security invoker, never definer', not bool_or(prosecdef),
       'definer=' || count(*) filter (where prosecdef)::text
from p

/* 4. Fixed empty search path. Stored as search_path="" — the quoted form.
      Without it a schema-qualified name could be shadowed at call time. */
union all
select '04 fixed empty search path', bool_and(proconfig @> array['search_path=""']),
       coalesce(string_agg(name, ', ') filter (where not (proconfig @> array['search_path=""'])), 'all fixed')
from p

/* 5. No command takes a target state. The command name IS the transition; a
      state parameter would put the destination back in the caller's hands. */
union all
select '05 no target-state parameter',
       not bool_or(args ~* '(p_target|p_new_state|p_to_state|p_status|p_fulfillment)'),
       coalesce(string_agg(name, ', ') filter (where args ~* '(p_target|p_new_state|p_to_state|p_status|p_fulfillment)'), 'none')
from p

/* 6. No DELETE anywhere on the five tables, for any role. Proof, handoff
      records and attempt history are evidence about real goods. */
union all
select '06 no DELETE granted to anyone', bool_and(not d), 'tables=' || count(*)::text
from (
  select has_table_privilege(r, 'public.' || t.name, 'DELETE') as d
  from tbls t cross join (values ('anon'),('authenticated'),('service_role')) as x(r)
) z

/* 7. anon and authenticated hold nothing at all. */
union all
select '07 anon and authenticated hold nothing', bool_and(not any_priv), 'grants=' || count(*) filter (where any_priv)::text
from (
  select has_table_privilege(r, 'public.' || t.name, 'SELECT')
      or has_table_privilege(r, 'public.' || t.name, 'INSERT')
      or has_table_privilege(r, 'public.' || t.name, 'UPDATE')
      or has_table_privilege(r, 'public.' || t.name, 'DELETE') as any_priv
  from tbls t cross join (values ('anon'),('authenticated')) as x(r)
) z

/* 8. The append-only tables really are append-only: no UPDATE for anyone. */
union all
select '08 evidence tables have no UPDATE', bool_and(not u), 'updatable=' || count(*) filter (where u)::text
from (
  select has_table_privilege('service_role', 'public.' || t.name, 'UPDATE') as u
  from tbls t where not t.expect_update
) z

/* 9. RLS enabled on all five. service_role bypasses it, so this is defence for
      any future non-service caller rather than the boundary itself. */
union all
select '09 RLS enabled on all five', bool_and(c.relrowsecurity), 'without=' || count(*) filter (where not c.relrowsecurity)::text
from tbls t join pg_class c on c.relname = t.name
join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'

/* 10. A raw six-digit PIN cannot be stored: the digest column requires 64 hex. */
union all
select '10 digest shape forbids a raw PIN',
       pg_get_constraintdef(oid) like '%[0-9a-f]{64}%',
       pg_get_constraintdef(oid)
from pg_constraint where conname = 'couranr_hc_digest_shape_chk'

/* 11. The object path cannot carry a name, a number or a filename: the only
       free segment is 32 hex characters under the versioned prefix. */
union all
select '11 proof paths are canonical and opaque',
       pg_get_constraintdef(oid) like '%canonical-proof/v1%'
         and pg_get_constraintdef(oid) like '%[0-9a-f]{32}%',
       pg_get_constraintdef(oid)
from pg_constraint where conname = 'couranr_pu_path_shape_chk'

/* 12. Lockout is bounded in the schema, not only in code — an off-by-one that
       kept counting past five would violate the constraint.
       Matched against the NORMALIZED form: Postgres rewrites `between 0 and 5`
       as `>= 0 AND <= 5`, so a probe looking for the source text reports a
       false failure on a perfectly correct constraint. */
union all
select '12 attempts are bounded at five',
       pg_get_constraintdef(oid) ~ 'failed_attempts >= 0'
         and pg_get_constraintdef(oid) ~ 'failed_attempts <= 5',
       pg_get_constraintdef(oid)
from pg_constraint where conname = 'couranr_hc_attempts_chk'

/* 13. Every stamp CHECK is ONE-DIRECTIONAL. The biconditional form makes a
       legal transition impossible; this repo has shipped that twice. A
       definition containing '=' between two predicates would be biconditional. */
union all
select '13 stamp checks are one-directional',
       bool_and(pg_get_constraintdef(oid) !~ '\)\s*=\s*\('),
       coalesce(string_agg(conname, ', ') filter (where pg_get_constraintdef(oid) ~ '\)\s*=\s*\('), 'all one-directional')
from pg_constraint
where conname in ('couranr_hc_consumed_stamp_chk','couranr_hc_locked_stamp_chk',
                  'couranr_hc_superseded_stamp_chk','couranr_pu_consumed_stamp_chk',
                  'couranr_pu_finalized_stamp_chk','couranr_pd_resolved_stamp_chk',
                  'couranr_asg_ended_stamp_chk')

/* 14. One active credential per delivery PER KIND, so the two are independent
       and regenerating one cannot disturb the other. */
union all
select '14 one active credential per kind',
       exists (select 1 from pg_indexes
                where indexname = 'couranr_hc_one_active_per_kind'
                  and indexdef like '%delivery_id, code_kind%'
                  and indexdef like '%active%'),
       'partial unique on (delivery_id, code_kind) where active'

/* 15. At most one open discrepancy per delivery — the blocker is singular. */
union all
select '15 one open discrepancy per delivery',
       exists (select 1 from pg_indexes where indexname = 'couranr_pd_one_open_per_delivery'),
       'partial unique where open'

/* 16. The assignment vocabulary distinguishes a completed delivery from a
       cancelled one. Reusing 'cancelled' for success would make the fleet's
       own history unreadable. */
union all
select '16 completed is distinct from cancelled',
       pg_get_constraintdef(oid) like '%completed%' and pg_get_constraintdef(oid) like '%cancelled%',
       pg_get_constraintdef(oid)
from pg_constraint where conname = 'couranr_asg_state_chk'

/* 17. Both arrival states exist, or the chain cannot be walked. */
union all
select '17 the arrival states exist',
       pg_get_constraintdef(oid) like '%at_pickup%' and pg_get_constraintdef(oid) like '%at_dropoff%',
       pg_get_constraintdef(oid)
from pg_constraint where conname = 'couranr_dlv_fulfillment_chk'

/* 18. Every driver command can write its audit row. A command missing here
       raises 23514 AFTER the state update, rolling the whole thing back. */
union all
select '18 every driver command is audit-allowed',
       bool_and(pg_get_constraintdef(c.oid) like '%' || v.cmd || '%'),
       coalesce(string_agg(v.cmd, ', ') filter (where pg_get_constraintdef(c.oid) not like '%' || v.cmd || '%'), 'all present')
from pg_constraint c
cross join (values
  ('start_route_to_pickup'),('arrive_at_pickup'),('complete_pickup'),
  ('start_route_to_dropoff'),('arrive_at_dropoff'),
  ('complete_direct_handoff_delivery'),('complete_signature_delivery'),
  ('complete_leave_at_door_delivery'),('unassign_delivery_before_pickup'),
  ('report_pickup_discrepancy'),('resolve_pickup_discrepancy_safe_to_continue')
) as v(cmd)
where c.conname = 'couranr_dlve_command_chk'

/* 19. The renamed command is gone on the database side too, so an audit row
       can never again imply a photo could replace the recipient PIN. */
union all
select '19 photo_or_pin command is retired',
       pg_get_constraintdef(oid) not like '%complete_photo_or_pin_delivery%',
       'delivery-event allow-list'
from pg_constraint where conname = 'couranr_dlve_command_chk'

/* 20. The proof-type vocabulary contains no identity capture. A courier does
       not photograph a shop assistant's face or licence to prove a handover. */
union all
select '20 no identity-document proof type',
       pg_get_constraintdef(oid) !~* '(face|selfie|licen[cs]e|passport|id_document)',
       pg_get_constraintdef(oid)
from pg_constraint where conname = 'couranr_dp_type_chk'

order by 1;
