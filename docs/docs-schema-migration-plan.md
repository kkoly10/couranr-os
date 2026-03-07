# Docs schema migration plan

## Goal
Remove long-lived runtime fallback behavior in Docs APIs by converging on a single canonical schema for `doc_requests` and related tables.

## Current fallback behavior
- `app/api/docs/submit-request/route.ts` can strip unknown columns during updates.
- Submitted-request read path can downgrade select columns when optional columns are missing.
- Telemetry now logs fallback usage (`docs schema fallback used`) and writes `schema_fallback_used` events to `doc_request_events`.
- Strict guard is supported via `DOCS_SCHEMA_FALLBACK_STRICT=1` to block submissions when fallback is triggered.

## Canonical target columns
`doc_requests` should consistently include:
- status + core fields: `id`, `user_id`, `status`, `service_type`, `title`, `description`
- timing fields: `created_at`, `updated_at`, `submitted_at`
- payment fields: `amount_subtotal_cents`, `delivery_fee_cents`, `rush_fee_cents`, `tax_cents`, `total_cents`, `paid`, `paid_at`
- stripe fields: `stripe_checkout_session_id`, `stripe_payment_intent_id`
- terms fields: `docs_terms_accepted_at`, `docs_terms_version`

## Migration phases
1. **Observe**
   - Track fallback logs for 2 weeks in staging/prod.
   - Confirm fallback frequency by missing column name.
2. **Migrate**
   - Apply SQL migrations for missing canonical columns.
   - Backfill values from legacy equivalents where possible.
3. **Gate**
   - Enable `DOCS_SCHEMA_FALLBACK_STRICT=1` in staging to fail fast when fallback triggers.
4. **Remove**
   - Remove runtime column-strip and select-downgrade logic after fallback rate reaches 0.

## Exit criteria
- 0 fallback events for 14 consecutive days.
- All environments on canonical schema migration version.
- Dashboards and admin screens validated against canonical columns only.
