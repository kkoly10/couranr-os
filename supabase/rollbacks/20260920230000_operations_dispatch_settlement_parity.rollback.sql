begin;

drop function if exists public.couranr_commit_operations_dispatch_assignment(
  uuid,uuid,integer,uuid,text
);
drop function if exists public.couranr_reserve_operations_dispatch_candidate(
  uuid,uuid,timestamptz
);

commit;
