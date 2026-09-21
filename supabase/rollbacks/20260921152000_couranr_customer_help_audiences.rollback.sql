-- Sender/recipient Help threads are durable customer communications. Merging
-- or dropping them during rollback would disclose or erase history.
do $$ begin
  raise exception 'customer_help_audiences_rollback_refused_use_forward_repair';
end $$;
