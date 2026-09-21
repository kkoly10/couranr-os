-- Pre-arrival exception rows are physical evidence. Reverting their command
-- while they remain open would strand drivers; use reviewed forward repair.
do $$ begin
  raise exception 'prearrival_driver_exception_rollback_refused_use_forward_repair';
end $$;
