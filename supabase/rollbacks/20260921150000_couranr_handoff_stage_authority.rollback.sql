-- Forward-only safety boundary. Existing code rows may have been superseded
-- and later credentials issued under the new stage rule. Dropping the guard
-- would silently restore premature PIN issuance; use a reviewed forward repair.
do $$ begin
  raise exception 'handoff_stage_authority_rollback_refused_use_forward_repair';
end $$;
