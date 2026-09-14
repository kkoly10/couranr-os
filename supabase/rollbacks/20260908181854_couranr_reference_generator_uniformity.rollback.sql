-- Paired rollback for 20260908181854_couranr_reference_generator_uniformity.sql.
--
-- Reverting restores a generator whose seventh symbol draws from 16 of 32
-- symbols, halving the keyspace. That is a defect, not a design, so this
-- rollback removes only the column DEFAULT — which is genuinely additive and
-- genuinely reversible — and REFUSES to reinstate the biased generator.
--
-- If the generator itself must be rolled back, do it deliberately by applying
-- the prior definition from 20260908161237, understanding that references
-- minted afterwards carry half the intended entropy.

begin;

alter table public.couranr_delivery_requests
  alter column reference drop default;

do $$
begin
  raise notice
    'couranr_generate_delivery_reference was NOT reverted: the prior definition consumed the RFC 9562 version nibble and emitted 16 of 32 symbols at position 7. Reapply 20260908161237 explicitly if that is genuinely intended.';
end
$$;

commit;
