-- Once a sender email carries a live capability, dropping its audience would
-- strand the customer. This is a forward-repair-only security cutover.
do $$ begin
  raise exception 'sender_lifecycle_access_rollback_refused_use_forward_repair';
end $$;
