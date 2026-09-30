-- RR-003a pre-use rollback only. Never erase a real Customer/SetupIntent
-- reference or consent record; use an application compatibility rollback and
-- forward repair once either table has data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Hold the write gate BEFORE checking emptiness. Without this, a concurrent
-- setup could insert between the existence check and DROP, losing real consent.
lock table public.couranr_business_payment_setup_attempts,
  public.couranr_business_payment_profiles in access exclusive mode;

do $$
begin
  if to_regclass('public.couranr_business_payment_profiles') is null
     or to_regclass('public.couranr_business_payment_setup_attempts') is null then
    raise exception 'business_payment_rollback_unknown_schema';
  end if;
  if exists (select 1 from public.couranr_business_payment_profiles)
     or exists (select 1 from public.couranr_business_payment_setup_attempts) then
    raise exception 'business_payment_rollback_refuses_semantic_history';
  end if;
end $$;

drop function public.couranr_complete_business_payment_setup(uuid,uuid,uuid,text,text,text,text);
drop function public.couranr_attach_business_payment_setup(uuid,uuid,uuid,text);
drop function public.couranr_rotate_business_payment_setup(uuid,uuid,uuid,text,text,text);
drop function public.couranr_begin_business_payment_setup(uuid,uuid,text,text);
drop function public.couranr_attach_business_payment_customer(uuid,uuid,text,boolean);
drop function public.couranr_begin_business_payment_customer(uuid,uuid);
drop function private.couranr_assert_business_payment_manager(uuid,uuid);
drop table public.couranr_business_payment_setup_attempts restrict;
drop table public.couranr_business_payment_profiles restrict;
commit;
