-- Fix a HALVED keyspace in the delivery-reference generator.
--
-- THE DEFECT, measured on production before this change. Sampling 4,000 draws
-- from couranr_generate_delivery_reference and counting distinct symbols per
-- position returned 32 at every position EXCEPT the seventh, which returned 16:
--
--   p1..p6 = 32,  p7 = 16,  p8 = 32
--   p7 symbols = 0123456789ABCDEF     (the first half of the alphabet only)
--
-- CAUSE. A version-4 UUID is not 32 uniformly random hex characters. Two are
-- fixed by RFC 9562: the VERSION nibble is always '4' at character 13, and the
-- VARIANT nibble at character 17 is one of 8/9/A/B. The original loop read
-- characters (2i+1, 2i+2), so its seventh byte was characters 13-14 — always
-- 0x40..0x4F. Reduced mod 32 that yields 0..15, so the seventh symbol could
-- never be one of the upper sixteen.
--
-- The keyspace was therefore 32^7 * 16 = 2^39, exactly HALF the 32^8 = 2^40 the
-- migration header claimed. Uniformity was asserted from the arithmetic (256 is
-- divisible by 32, so a byte reduced mod 32 is unbiased) which is true of a
-- uniform byte and says nothing about a byte that is half constant.
--
-- WHY THE ORIGINAL VERIFICATION MISSED IT. 2,000 draws were checked for
-- DISTINCTNESS and all 2,000 were distinct — a property that still holds
-- comfortably at half the keyspace. Uniqueness was measured; uniformity was
-- claimed. This migration ships with the per-position check that would have
-- caught it.
--
-- THE FIX. Build the working string from the characters that are actually
-- random: 1-12, then 14-16, then 18-32. That drops the two RFC-fixed nibbles
-- and leaves 30 uniformly random hex characters, of which 16 are consumed.
--
-- Old references stay valid: this changes only which values can be MINTED, and
-- every previously minted value is still inside the alphabet and the CHECK.
-- Safe to run now — production holds 2 rows.

begin;

create or replace function public.couranr_generate_delivery_reference()
returns text
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  alphabet constant text := '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  u        text := replace(gen_random_uuid()::text, '-', '');
  /* Characters 13 (version, always '4') and 17 (variant, 8/9/A/B) are fixed by
     RFC 9562 and carry no entropy. Skipping them leaves 30 uniformly random hex
     characters; the loop below consumes the first 16. */
  raw      text := substr(u, 1, 12) || substr(u, 14, 3) || substr(u, 18);
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
  'One candidate customer-facing delivery reference, CR-XXXX-XXXX in Crockford Base32. Consumes only the non-fixed nibbles of a v4 UUID, so every position draws from all 32 symbols. Uniqueness is enforced by the caller and the unique index, not here.';

-- Belt and braces for any INSERT path that bypasses the trigger — COPY, a
-- restore, or a session running with session_replication_role='replica'. The
-- trigger stays the primary assignment because only it can retry on collision;
-- this stops a bypassing path from hitting the NOT NULL instead.
alter table public.couranr_delivery_requests
  alter column reference set default public.couranr_generate_delivery_reference();

commit;
