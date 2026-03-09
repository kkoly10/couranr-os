-- Manual setup for business account + owner membership
-- Target email: couranr.couranr@gmail.com

begin;

-- 1) Lookup auth user id by email
-- NOTE: requires service role privileges in SQL editor.
with target_user as (
  select id, email
  from auth.users
  where lower(email) = lower('couranr.couranr@gmail.com')
  limit 1
),
ins_account as (
  insert into public.business_accounts (name, billing_email, status, timezone, created_by)
  select
    'Couranr Business',
    'couranr.couranr@gmail.com',
    'active',
    'America/New_York',
    tu.id
  from target_user tu
  returning id
)
insert into public.business_members (business_account_id, user_id, role, status, invited_email, joined_at)
select
  a.id,
  tu.id,
  'owner',
  'active',
  tu.email,
  now()
from ins_account a
join target_user tu on true;

commit;

-- 2) Verify result
select
  ba.id as business_account_id,
  ba.name,
  ba.billing_email,
  bm.user_id,
  bm.role,
  bm.status
from public.business_accounts ba
join public.business_members bm on bm.business_account_id = ba.id
where lower(ba.billing_email) = lower('couranr.couranr@gmail.com')
order by ba.created_at desc;

-- 3) Optional: if you need the latest account ID for API calls
select id, name, created_at
from public.business_accounts
where lower(billing_email) = lower('couranr.couranr@gmail.com')
order by created_at desc
limit 1;
