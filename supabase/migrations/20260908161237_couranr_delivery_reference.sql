-- A customer-facing delivery reference: CR-4K7M-2P9X.
--
-- WHY THIS EXISTS. Ten of the thirteen transactional email templates require a
-- `reference` field (lib/couranr/email/types.ts:66, 80, 92, 107, 123, 149, 158,
-- 171, 181, 189) and no such value exists anywhere in the schema. Zero columns
-- on couranr_delivery_requests match reference|short_code|order_number|number.
-- The only CR-style strings in the tree are sample data and two style-guide
-- cells. Until this lands, ten templates cannot be wired at all.
--
-- WHY IT IS ASSIGNED HERE AND NOT IN A COMMAND. FOUR functions insert into
-- couranr_delivery_requests, verified by catalog query against the live
-- database (pg_get_functiondef ~ 'insert into public.couranr_delivery_requests'):
--   couranr_create_delivery_request_draft
--   couranr_create_consumer_delivery_request_draft
--   couranr_create_routed_delivery_request_draft
--   couranr_create_hosted_delivery_request
-- Assigning the reference inside any one of them leaves the other three
-- producing rows with a null reference, and a fifth insert path added later
-- would do the same silently. A BEFORE INSERT trigger is the only placement
-- that cannot be bypassed by adding a caller.
--
-- FORMAT, and why each part.
--   Alphabet: Crockford Base32 — 0123456789ABCDEFGHJKMNPQRSTVWXYZ. I and L are
--   omitted because they are confusable with 1, O because it is confusable with
--   0, and U to avoid accidental obscenity (crockford.com/base32.html). The
--   decisive property is not the alphabet but the DECODING rule: i/l normalise
--   to 1 and o to 0, so a customer who reads "O" where the code has "0" is
--   still found. That normalisation lives in TypeScript at
--   lib/couranr/references.ts and is what every lookup must call.
--
--   Length: 8 symbols = 32^8 = 1,099,511,627,776. With the unique index below,
--   the number that matters is not the birthday probability but the per-insert
--   retry cost: at one million existing deliveries, one insert in ~1.1 million
--   needs a single retry. A collision is a non-event, not a failure.
--
--   RANDOM, never sequential and never time-sortable. A sequential or
--   ULID-style reference publishes delivery volume and growth rate to anyone
--   who places two orders and diffs them. Internal ids stay uuid; this is the
--   only public one.
--
--   Uniform, with no modulo bias: each symbol is one byte reduced mod 32, and
--   256 is exactly divisible by 32.

begin;

-- The generator. Produces ONE candidate and makes no uniqueness claim — the
-- trigger below and the unique index are what guarantee that.
--
-- gen_random_uuid() rather than gen_random_bytes(): it is core PostgreSQL from
-- 13 onward and carries no pgcrypto dependency. Its 32 hex characters supply
-- far more entropy than the 8 bytes consumed here.
create or replace function public.couranr_generate_delivery_reference()
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  raw      text := replace(gen_random_uuid()::text, '-', '');
  code     text := '';
  i        integer;
  byte     integer;
begin
  for i in 0..7 loop
    byte := ('x' || substr(raw, i * 2 + 1, 2))::bit(8)::integer;
    code := code || substr(alphabet, (byte % 32) + 1, 1);
  end loop;
  return 'CR-' || substr(code, 1, 4) || '-' || substr(code, 5, 4);
end
$fn$;

comment on function public.couranr_generate_delivery_reference() is
  'One candidate customer-facing delivery reference, CR-XXXX-XXXX in Crockford Base32. Uniqueness is enforced by the caller and the unique index, not here.';

alter table public.couranr_delivery_requests
  add column if not exists reference text;

-- Backfill BEFORE the not-null and unique constraints, so this migration is
-- safe on a table that already holds rows.
do $$
declare
  r         record;
  candidate text;
begin
  for r in
    select id from public.couranr_delivery_requests where reference is null
  loop
    loop
      candidate := public.couranr_generate_delivery_reference();
      exit when not exists (
        select 1 from public.couranr_delivery_requests where reference = candidate
      );
    end loop;
    update public.couranr_delivery_requests
       set reference = candidate
     where id = r.id;
  end loop;
end
$$;

-- The real uniqueness guarantee. Everything else is an optimisation that keeps
-- this index from being hit.
create unique index if not exists couranr_delivery_requests_reference_uidx
  on public.couranr_delivery_requests (reference);

-- Shape is constrained so a malformed reference cannot be written by any path,
-- including a future one. The character class is the Crockford alphabet with
-- I, L, O and U absent by construction — a reference containing one of them is
-- a bug, not a value to normalise after the fact.
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_reference_shape_chk;

alter table public.couranr_delivery_requests
  add constraint couranr_dr_reference_shape_chk
  check (
    reference is null
    or reference ~ '^CR-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{4}$'
  );

-- Assignment. Runs for every insert path that exists and every one added later.
--
-- The bounded loop re-checks before returning, so the unique index is reached
-- only by a genuine concurrent race between two sessions that generated the
-- same candidate in the same instant. At the volumes above that is around one
-- insert in a million, and the correct outcome is the insert failing so the
-- caller retries — never a duplicate reference.
--
-- An explicit reference is respected rather than overwritten, so a restore or a
-- deliberate backfill can carry its own values.
create or replace function public.couranr_assign_delivery_reference()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  candidate text;
  attempt   integer := 0;
begin
  if new.reference is not null then
    return new;
  end if;

  loop
    attempt   := attempt + 1;
    candidate := public.couranr_generate_delivery_reference();

    exit when not exists (
      select 1 from public.couranr_delivery_requests where reference = candidate
    );

    if attempt >= 10 then
      -- Ten consecutive collisions against a 1.1e12 space is not bad luck, it
      -- is a broken generator. Fail loudly rather than insert a null the email
      -- layer would later render as an empty subject line.
      raise exception
        'couranr_assign_delivery_reference: no unique reference after % attempts', attempt
        using errcode = 'CR409';
    end if;
  end loop;

  new.reference := candidate;
  return new;
end
$fn$;

drop trigger if exists couranr_dr_assign_reference_trg
  on public.couranr_delivery_requests;

create trigger couranr_dr_assign_reference_trg
  before insert on public.couranr_delivery_requests
  for each row
  execute function public.couranr_assign_delivery_reference();

-- Now that every existing row is backfilled and every future row is assigned by
-- the trigger, the column can carry the guarantee the email layer depends on.
alter table public.couranr_delivery_requests
  alter column reference set not null;

-- This project's pg_default_acl grants EXECUTE on every new public function to
-- anon, authenticated AND service_role, so a narrow grant is only real after an
-- explicit revoke. Neither function is callable by a browser role.
revoke all on function public.couranr_generate_delivery_reference() from public, anon, authenticated;
revoke all on function public.couranr_assign_delivery_reference()   from public, anon, authenticated;
grant execute on function public.couranr_generate_delivery_reference() to service_role;
grant execute on function public.couranr_assign_delivery_reference()   to service_role;

commit;
