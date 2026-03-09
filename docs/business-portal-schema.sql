-- Business portal additive schema (safe for current customer portal)
-- Apply in Supabase SQL editor.

begin;

create extension if not exists pgcrypto;

create table if not exists public.business_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  billing_email text,
  status text not null default 'active' check (status in ('active','paused','cancelled','trial')),
  timezone text not null default 'America/New_York',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_members (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','manager','dispatcher','viewer','billing')),
  status text not null default 'active' check (status in ('active','invited','disabled')),
  invited_email text,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_account_id, user_id)
);

create table if not exists public.business_packages (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  monthly_price_cents integer not null default 0,
  included_delivery_routes integer not null default 0,
  included_docs_jobs integer not null default 0,
  overage_delivery_route_cents integer not null default 0,
  overage_docs_job_cents integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_account_packages (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  business_package_id uuid not null references public.business_packages(id) on delete restrict,
  status text not null default 'active' check (status in ('active','trialing','past_due','cancelled','expired')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  renews_at timestamptz,
  stripe_subscription_id text,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);


create table if not exists public.business_pricing_profiles (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  status text not null default 'active' check (status in ('active','draft','archived')),
  delivery_discount_pct numeric(5,2),
  delivery_flat_fee_cents integer,
  docs_discount_pct numeric(5,2),
  docs_flat_fee_cents integer,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_route_templates (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  pickup_address_id uuid references public.addresses(id) on delete set null,
  dropoff_address_id uuid references public.addresses(id) on delete set null,
  default_weight_lbs numeric(10,2),
  default_stops integer default 0,
  default_rush boolean not null default false,
  default_signature_required boolean not null default false,
  default_notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_route_schedules (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  route_template_id uuid not null references public.business_route_templates(id) on delete cascade,
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  recurrence_type text not null check (recurrence_type in ('daily','weekly','monthly','cron')),
  weekdays int[],
  day_of_month integer,
  cron_expr text,
  timezone text not null default 'America/New_York',
  window_start_local time not null default '09:00',
  window_end_local time not null default '17:00',
  start_date date not null default current_date,
  end_date date,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_jobs (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  job_type text not null check (job_type in ('delivery','docs','combined')),
  source text not null default 'manual' check (source in ('manual','scheduled','api','import')),
  route_template_id uuid references public.business_route_templates(id) on delete set null,
  schedule_id uuid references public.business_route_schedules(id) on delete set null,
  status text not null default 'queued' check (status in ('queued','scheduled','in_progress','completed','cancelled','failed')),
  scheduled_for timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  title text,
  description text,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_usage_events (
  id uuid primary key default gen_random_uuid(),
  business_account_id uuid not null references public.business_accounts(id) on delete cascade,
  business_job_id uuid references public.business_jobs(id) on delete set null,
  usage_type text not null check (usage_type in ('delivery_route','docs_job')),
  quantity integer not null default 1 check (quantity > 0),
  unit_price_cents integer not null default 0,
  reference_table text,
  reference_id uuid,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- Additive linkage columns on existing tables
alter table public.orders add column if not exists business_account_id uuid references public.business_accounts(id) on delete set null;
alter table public.deliveries add column if not exists business_account_id uuid references public.business_accounts(id) on delete set null;
alter table public.doc_requests add column if not exists business_account_id uuid references public.business_accounts(id) on delete set null;
alter table public.addresses add column if not exists business_account_id uuid references public.business_accounts(id) on delete set null;

create index if not exists idx_business_members_lookup on public.business_members(business_account_id, user_id, status);
create index if not exists idx_orders_business_account_id on public.orders(business_account_id);
create index if not exists idx_deliveries_business_account_id on public.deliveries(business_account_id);
create index if not exists idx_doc_requests_business_account_id on public.doc_requests(business_account_id);
create index if not exists idx_addresses_business_account_id on public.addresses(business_account_id);
create index if not exists idx_business_pricing_profiles_account_status on public.business_pricing_profiles(business_account_id, status);

commit;
