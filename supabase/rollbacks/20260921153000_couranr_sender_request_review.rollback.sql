-- Request-review events are immutable customer evidence. A destructive
-- rollback would erase the sender's request for Operations attention.
do $$ begin
  raise exception 'sender_request_review_rollback_refused_use_forward_repair';
end $$;
