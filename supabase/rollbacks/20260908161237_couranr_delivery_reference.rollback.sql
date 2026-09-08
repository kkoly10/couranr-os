-- Paired rollback for 20260908161237_couranr_delivery_reference.sql.
--
-- A delivery reference is printed on customer email, quoted to support and
-- shown to merchants and Operations. Once one has been sent to a person it is
-- a fact about the world that this database does not get to retract: dropping
-- the column would orphan every email already delivered and leave a customer
-- holding a code nothing can resolve.
--
-- So this rollback REFUSES to drop the column once any reference could have
-- left the building, and instead unwinds only the machinery. That matches the
-- posture of 20260907220000's rollback, which refuses once resolution-request
-- evidence exists.
--
-- The refusal test is deliberately conservative: it fires when any delivery
-- request has advanced beyond `draft`, because that is the earliest point at
-- which a reference can appear in a merchant surface or a notification. It is
-- not "has an email been sent" — nothing records that yet, and guessing would
-- be the same mistake as assuming an unverified fact.

begin;

do $$
begin
  if exists (
    select 1
      from public.couranr_delivery_requests
     where request_state is distinct from 'draft'
  ) then
    raise exception
      'refusing to remove couranr_delivery_requests.reference: % request(s) have left draft, so a reference may already be in a customer''s hands. Unwind the trigger and generator only, and keep the column.',
      (select count(*) from public.couranr_delivery_requests where request_state is distinct from 'draft')
      using errcode = 'CR409';
  end if;
end
$$;

-- Machinery first, so a re-apply of the forward migration is clean.
drop trigger if exists couranr_dr_assign_reference_trg
  on public.couranr_delivery_requests;

drop function if exists public.couranr_assign_delivery_reference();
drop function if exists public.couranr_generate_delivery_reference();

-- Only reached when every request is still a draft, i.e. no reference can have
-- been shown to anyone.
alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_reference_shape_chk;

drop index if exists public.couranr_delivery_requests_reference_uidx;

alter table public.couranr_delivery_requests
  alter column reference drop not null;

alter table public.couranr_delivery_requests
  drop column if exists reference;

commit;
