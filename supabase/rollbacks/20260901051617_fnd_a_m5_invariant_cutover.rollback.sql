-- ROLLBACK for Gate A M5.
-- Removing these guards after runtime quote use would reopen mutable commercial
-- authority, so the rollback hard-refuses once a runtime quote exists.

begin;
set local statement_timeout='120s';
set local lock_timeout='10s';

do $guard$
begin
  if exists(select 1 from public.couranr_quote_versions where record_origin='runtime') then
    raise exception 'unsafe rollback: runtime immutable quote history exists; use a forward repair';
  end if;
end
$guard$;

drop trigger if exists couranr_dlv_quote_invariant_trg on public.couranr_deliveries;
drop trigger if exists couranr_sp_quote_invariant_trg on public.couranr_service_plans;
drop trigger if exists couranr_po_quote_invariant_trg on public.couranr_payment_obligations;
drop trigger if exists couranr_dr_quote_projection_trg on public.couranr_delivery_requests;
drop trigger if exists couranr_qv_append_only_trg on public.couranr_quote_versions;
drop function if exists public.couranr_foundation_integrity();
drop function if exists private.couranr_enforce_delivery_quote();
drop function if exists private.couranr_enforce_plan_quote();
drop function if exists private.couranr_enforce_obligation_quote();
drop function if exists private.couranr_protect_request_quote_projection();
drop function if exists private.couranr_quote_versions_are_append_only();

alter table public.couranr_delivery_requests
  drop constraint if exists couranr_dr_quote_identity_completeness_chk;
alter table public.couranr_payment_obligations alter column quote_version_id drop not null;
alter table public.couranr_service_plans alter column quote_version_id drop not null;
alter table public.couranr_deliveries alter column quote_version_id drop not null;

commit;
