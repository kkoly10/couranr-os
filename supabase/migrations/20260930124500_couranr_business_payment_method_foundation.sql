-- RR-003a: a reusable Business card belongs to the Business tenant, not to a
-- Route child or a browser-selected Stripe object. This migration moves no
-- money and makes no Route executable. It is safe to apply before the app
-- cutover; after a real profile/setup exists, rollback is forward repair.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if to_regclass('public.business_accounts') is null
     or to_regclass('public.business_members') is null
     or to_regclass('public.couranr_route_runs') is null then
    raise exception 'business_payment_foundation_requires_business_and_rr001';
  end if;
  if to_regclass('public.couranr_business_payment_profiles') is not null
     or to_regclass('public.couranr_business_payment_setup_attempts') is not null then
    raise exception 'business_payment_foundation_already_present';
  end if;
end $$;

create table public.couranr_business_payment_profiles (
  business_account_id uuid primary key references public.business_accounts(id),
  customer_create_key uuid not null unique default gen_random_uuid(),
  stripe_customer_id text unique check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_customer_livemode boolean,
  current_generation integer not null default 0 check (current_generation >= 0),
  default_payment_method_id text check (default_payment_method_id ~ '^pm_[A-Za-z0-9]+$'),
  default_setup_intent_id text check (default_setup_intent_id ~ '^seti_[A-Za-z0-9]+$'),
  card_brand text check (card_brand ~ '^[a-z0-9_]{1,30}$'),
  card_last4 text check (card_last4 ~ '^[0-9]{4}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint couranr_business_payment_customer_before_method check (
    default_payment_method_id is null or stripe_customer_id is not null
  ),
  constraint couranr_business_payment_customer_mode check (
    (stripe_customer_id is null) = (stripe_customer_livemode is null)
  ),
  constraint couranr_business_payment_method_evidence check (
    (default_payment_method_id is null and default_setup_intent_id is null
      and card_brand is null and card_last4 is null)
    or (default_payment_method_id is not null and default_setup_intent_id is not null
      and card_brand is not null and card_last4 is not null)
  )
);

create table public.couranr_business_payment_setup_attempts (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.couranr_business_payment_profiles(business_account_id),
  generation integer not null check (generation > 0),
  actor_user_id uuid not null references auth.users(id),
  consent_version text not null check (consent_version = 'business-saved-card-v1-2026-09-29'),
  consent_text text not null check (consent_text =
    'Save this card for future Couranr for Business delivery charges. Saving it does not book or charge a Route Run. Before Route checkout confirmation, Couranr shows the separate delivery quotes; an authorized Business member must confirm that checkout. Couranr may then authorize and capture those delivery charges under the displayed terms. You can replace the saved card. Couranr does not store the card number.'),
  stripe_setup_intent_id text unique check (stripe_setup_intent_id ~ '^seti_[A-Za-z0-9]+$'),
  payment_method_id text check (payment_method_id ~ '^pm_[A-Za-z0-9]+$'),
  attempt_state text not null default 'started' check (attempt_state in ('started','intent_created','succeeded')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour'),
  completed_at timestamptz,
  completed_by_user_id uuid references auth.users(id),
  unique (business_account_id,generation),
  constraint couranr_business_setup_state_evidence check (
    (attempt_state='started' and stripe_setup_intent_id is null and payment_method_id is null
      and completed_at is null and completed_by_user_id is null)
    or (attempt_state='intent_created' and stripe_setup_intent_id is not null and payment_method_id is null
      and completed_at is null and completed_by_user_id is null)
    or (attempt_state='succeeded' and stripe_setup_intent_id is not null and payment_method_id is not null
      and completed_at is not null and completed_by_user_id is not null)
  ),
  constraint couranr_business_setup_expiry check (expires_at > created_at)
);
create index couranr_business_setup_business_idx
  on public.couranr_business_payment_setup_attempts(business_account_id,created_at desc);

alter table public.couranr_business_payment_profiles enable row level security;
alter table public.couranr_business_payment_setup_attempts enable row level security;
revoke all on public.couranr_business_payment_profiles,
  public.couranr_business_payment_setup_attempts from public,anon,authenticated,service_role;
grant select on public.couranr_business_payment_profiles,
  public.couranr_business_payment_setup_attempts to service_role;

create function private.couranr_assert_business_payment_manager(p_business uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $fn$
begin
  if p_business is null or p_actor is null then
    raise exception 'business_payment_access_denied' using errcode='CR403';
  end if;
  perform 1 from public.business_members
   where business_account_id=p_business and user_id=p_actor
     and status='active' and role in ('owner','manager') for share;
  if not found then
    raise exception 'business_payment_access_denied' using errcode='CR403';
  end if;
end $fn$;
revoke all on function private.couranr_assert_business_payment_manager(uuid,uuid)
  from public,anon,authenticated,service_role;

-- The durable idempotency key is committed BEFORE any Stripe Customer call.
-- If Stripe's idempotency horizon is exceeded without an attached customer,
-- the server must stop for provider reconciliation rather than mint another.
create function public.couranr_begin_business_payment_customer(
  p_business_account_id uuid,p_actor_user_id uuid
) returns public.couranr_business_payment_profiles
language plpgsql security definer set search_path='' as $fn$
declare v_profile public.couranr_business_payment_profiles;
begin
  perform private.couranr_assert_business_payment_manager(p_business_account_id,p_actor_user_id);
  insert into public.couranr_business_payment_profiles(business_account_id)
    values(p_business_account_id) on conflict(business_account_id) do nothing;
  select * into strict v_profile from public.couranr_business_payment_profiles
   where business_account_id=p_business_account_id for update;
  return v_profile;
end $fn$;

create function public.couranr_attach_business_payment_customer(
  p_business_account_id uuid,p_actor_user_id uuid,p_customer_id text,p_livemode boolean
) returns public.couranr_business_payment_profiles
language plpgsql security definer set search_path='' as $fn$
declare v_profile public.couranr_business_payment_profiles;
begin
  perform private.couranr_assert_business_payment_manager(p_business_account_id,p_actor_user_id);
  if p_customer_id is null or p_customer_id !~ '^cus_[A-Za-z0-9]+$' or p_livemode is null then
    raise exception 'business_payment_customer_invalid' using errcode='CR422';
  end if;
  select * into v_profile from public.couranr_business_payment_profiles
   where business_account_id=p_business_account_id for update;
  if not found then raise exception 'business_payment_profile_missing' using errcode='CR409'; end if;
  if v_profile.stripe_customer_id is not null and
     (v_profile.stripe_customer_id<>p_customer_id or
      v_profile.stripe_customer_livemode is distinct from p_livemode) then
    raise exception 'business_payment_customer_conflict' using errcode='CR409';
  end if;
  update public.couranr_business_payment_profiles
     set stripe_customer_id=p_customer_id,stripe_customer_livemode=p_livemode,updated_at=now()
   where business_account_id=p_business_account_id returning * into v_profile;
  return v_profile;
end $fn$;

create function public.couranr_begin_business_payment_setup(
  p_business_account_id uuid,p_actor_user_id uuid,p_consent_version text,p_consent_text text
) returns public.couranr_business_payment_setup_attempts
language plpgsql security definer set search_path='' as $fn$
declare
  v_profile public.couranr_business_payment_profiles;
  v_attempt public.couranr_business_payment_setup_attempts;
begin
  perform private.couranr_assert_business_payment_manager(p_business_account_id,p_actor_user_id);
  if p_consent_version is distinct from 'business-saved-card-v1-2026-09-29'
     or p_consent_text is distinct from
       'Save this card for future Couranr for Business delivery charges. Saving it does not book or charge a Route Run. Before Route checkout confirmation, Couranr shows the separate delivery quotes; an authorized Business member must confirm that checkout. Couranr may then authorize and capture those delivery charges under the displayed terms. You can replace the saved card. Couranr does not store the card number.' then
    raise exception 'business_payment_consent_required' using errcode='CR422';
  end if;
  select * into v_profile from public.couranr_business_payment_profiles
   where business_account_id=p_business_account_id for update;
  if not found or v_profile.stripe_customer_id is null then
    raise exception 'business_payment_customer_missing' using errcode='CR409';
  end if;
  select * into v_attempt from public.couranr_business_payment_setup_attempts
   where business_account_id=p_business_account_id
     and generation=v_profile.current_generation
     and attempt_state<>'succeeded';
  -- Never silently supersede a Stripe intent: an issued client secret could
  -- otherwise still attach an invisible card to the shared Customer.
  if found then return v_attempt; end if;
  insert into public.couranr_business_payment_setup_attempts(
    business_account_id,generation,actor_user_id,consent_version,consent_text
  ) values (
    p_business_account_id,v_profile.current_generation+1,p_actor_user_id,p_consent_version,p_consent_text
  ) returning * into v_attempt;
  update public.couranr_business_payment_profiles
     set current_generation=v_attempt.generation,updated_at=now()
   where business_account_id=p_business_account_id;
  return v_attempt;
end $fn$;

-- Server calls this only after verifying that the old Stripe intent is
-- canceled, or when no intent was ever attached and its lease expired.
-- Provider cancellation must precede this transaction; a canceled intent
-- cannot later attach a card. There is deliberately no browser EXECUTE.
create function public.couranr_rotate_business_payment_setup(
  p_business_account_id uuid,p_actor_user_id uuid,p_old_attempt_id uuid,
  p_old_setup_intent_id text,p_consent_version text,p_consent_text text
) returns public.couranr_business_payment_setup_attempts
language plpgsql security definer set search_path='' as $fn$
declare
  v_profile public.couranr_business_payment_profiles;
  v_old public.couranr_business_payment_setup_attempts;
  v_new public.couranr_business_payment_setup_attempts;
begin
  perform private.couranr_assert_business_payment_manager(p_business_account_id,p_actor_user_id);
  if p_consent_version is distinct from 'business-saved-card-v1-2026-09-29'
     or p_consent_text is distinct from
       'Save this card for future Couranr for Business delivery charges. Saving it does not book or charge a Route Run. Before Route checkout confirmation, Couranr shows the separate delivery quotes; an authorized Business member must confirm that checkout. Couranr may then authorize and capture those delivery charges under the displayed terms. You can replace the saved card. Couranr does not store the card number.' then
    raise exception 'business_payment_consent_required' using errcode='CR422';
  end if;
  select * into v_profile from public.couranr_business_payment_profiles
   where business_account_id=p_business_account_id for update;
  select * into v_old from public.couranr_business_payment_setup_attempts
   where id=p_old_attempt_id and business_account_id=p_business_account_id for update;
  if not found or v_old.generation<>v_profile.current_generation
     or v_old.attempt_state='succeeded'
     or v_old.stripe_setup_intent_id is distinct from p_old_setup_intent_id
     or (v_old.stripe_setup_intent_id is null and v_old.expires_at>now()) then
    raise exception 'business_payment_setup_stale' using errcode='CR409';
  end if;
  insert into public.couranr_business_payment_setup_attempts(
    business_account_id,generation,actor_user_id,consent_version,consent_text
  ) values (
    p_business_account_id,v_profile.current_generation+1,p_actor_user_id,p_consent_version,p_consent_text
  ) returning * into v_new;
  update public.couranr_business_payment_profiles
     set current_generation=v_new.generation,updated_at=now()
   where business_account_id=p_business_account_id;
  return v_new;
end $fn$;

create function public.couranr_attach_business_payment_setup(
  p_business_account_id uuid,p_actor_user_id uuid,p_attempt_id uuid,p_setup_intent_id text
) returns public.couranr_business_payment_setup_attempts
language plpgsql security definer set search_path='' as $fn$
declare
  v_profile public.couranr_business_payment_profiles;
  v_attempt public.couranr_business_payment_setup_attempts;
begin
  perform private.couranr_assert_business_payment_manager(p_business_account_id,p_actor_user_id);
  if p_setup_intent_id is null or p_setup_intent_id !~ '^seti_[A-Za-z0-9]+$' then
    raise exception 'business_payment_setup_invalid' using errcode='CR422';
  end if;
  select * into v_profile from public.couranr_business_payment_profiles
   where business_account_id=p_business_account_id for update;
  select * into v_attempt from public.couranr_business_payment_setup_attempts
   where id=p_attempt_id and business_account_id=p_business_account_id for update;
  if not found or v_attempt.generation<>v_profile.current_generation
     or v_attempt.actor_user_id<>p_actor_user_id or v_attempt.expires_at<=now() then
    raise exception 'business_payment_setup_stale' using errcode='CR409';
  end if;
  if v_attempt.stripe_setup_intent_id is not null then
    if v_attempt.stripe_setup_intent_id=p_setup_intent_id then return v_attempt; end if;
    raise exception 'business_payment_setup_conflict' using errcode='CR409';
  end if;
  update public.couranr_business_payment_setup_attempts
     set stripe_setup_intent_id=p_setup_intent_id,attempt_state='intent_created'
   where id=p_attempt_id returning * into v_attempt;
  return v_attempt;
end $fn$;

-- The caller must first retrieve BOTH the SetupIntent and PaymentMethod from
-- Stripe; this command accepts their verified facts, never a browser claim.
create function public.couranr_complete_business_payment_setup(
  p_business_account_id uuid,p_actor_user_id uuid,p_attempt_id uuid,
  p_setup_intent_id text,p_payment_method_id text,p_card_brand text,p_card_last4 text
) returns public.couranr_business_payment_profiles
language plpgsql security definer set search_path='' as $fn$
declare
  v_profile public.couranr_business_payment_profiles;
  v_attempt public.couranr_business_payment_setup_attempts;
begin
  perform private.couranr_assert_business_payment_manager(p_business_account_id,p_actor_user_id);
  if p_setup_intent_id is null or p_setup_intent_id !~ '^seti_[A-Za-z0-9]+$'
     or p_payment_method_id is null or p_payment_method_id !~ '^pm_[A-Za-z0-9]+$'
     or p_card_brand is null or p_card_brand !~ '^[a-z0-9_]{1,30}$'
     or p_card_last4 is null or p_card_last4 !~ '^[0-9]{4}$' then
    raise exception 'business_payment_setup_invalid' using errcode='CR422';
  end if;
  select * into v_profile from public.couranr_business_payment_profiles
   where business_account_id=p_business_account_id for update;
  if not found then raise exception 'business_payment_profile_missing' using errcode='CR409'; end if;
  select * into v_attempt from public.couranr_business_payment_setup_attempts
   where id=p_attempt_id and business_account_id=p_business_account_id for update;
  if not found or v_attempt.generation<>v_profile.current_generation
     or v_attempt.stripe_setup_intent_id is distinct from p_setup_intent_id
     or v_attempt.attempt_state='started' then
    raise exception 'business_payment_setup_stale' using errcode='CR409';
  end if;
  if v_attempt.attempt_state='succeeded' then
    if v_attempt.payment_method_id=p_payment_method_id
       and v_profile.default_payment_method_id=p_payment_method_id then return v_profile; end if;
    raise exception 'business_payment_setup_conflict' using errcode='CR409';
  end if;
  update public.couranr_business_payment_setup_attempts
     set attempt_state='succeeded',payment_method_id=p_payment_method_id,
         completed_at=now(),completed_by_user_id=p_actor_user_id
   where id=p_attempt_id;
  update public.couranr_business_payment_profiles
     set default_payment_method_id=p_payment_method_id,
         default_setup_intent_id=p_setup_intent_id,
         card_brand=p_card_brand,card_last4=p_card_last4,updated_at=now()
   where business_account_id=p_business_account_id returning * into v_profile;
  return v_profile;
end $fn$;

revoke all on function public.couranr_begin_business_payment_customer(uuid,uuid),
  public.couranr_attach_business_payment_customer(uuid,uuid,text,boolean),
  public.couranr_begin_business_payment_setup(uuid,uuid,text,text),
  public.couranr_rotate_business_payment_setup(uuid,uuid,uuid,text,text,text),
  public.couranr_attach_business_payment_setup(uuid,uuid,uuid,text),
  public.couranr_complete_business_payment_setup(uuid,uuid,uuid,text,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.couranr_begin_business_payment_customer(uuid,uuid),
  public.couranr_attach_business_payment_customer(uuid,uuid,text,boolean),
  public.couranr_begin_business_payment_setup(uuid,uuid,text,text),
  public.couranr_rotate_business_payment_setup(uuid,uuid,uuid,text,text,text),
  public.couranr_attach_business_payment_setup(uuid,uuid,uuid,text),
  public.couranr_complete_business_payment_setup(uuid,uuid,uuid,text,text,text,text)
  to service_role;

comment on table public.couranr_business_payment_profiles is
  'RR-003 server-only Stripe Customer and verified default card reference. No card numbers, Route capture, or browser DML.';
comment on table public.couranr_business_payment_setup_attempts is
  'RR-003 durable SetupIntent idempotency and affirmative off-session consent evidence; provider verification is required before completion.';
commit;
