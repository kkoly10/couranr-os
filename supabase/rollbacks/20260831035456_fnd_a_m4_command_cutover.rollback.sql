-- ROLLBACK for Gate A M4 — AUTHORITY CUTOVER.
--
-- Refusing to restore mutable request columns as commercial authority is
-- deliberate. Even with zero runtime quote rows, the safe rollback is an
-- application compatibility deployment followed by a reviewed forward repair.
-- After runtime rows exist, restoring the old functions would let a request
-- silently diverge from money/plan/delivery truth.

begin;
do $refuse$
declare v_runtime_quotes bigint;
begin
  select count(*) into v_runtime_quotes
    from public.couranr_quote_versions where record_origin='runtime';
  raise exception
    'refusing destructive authority rollback: % runtime quote(s). Keep immutable history and deploy a forward repair/application compatibility rollback.',
    v_runtime_quotes;
end
$refuse$;
commit;
