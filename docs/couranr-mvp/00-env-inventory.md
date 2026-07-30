# 00 — Environment inventory (names only, no values)

20 variables referenced in code. **No value is recorded here.** No `.env.example` exists.

## Client-exposed (8)
`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_APP_URL` · `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` · `NEXT_PUBLIC_TEST_MODE` · `NEXT_PUBLIC_AUTO_TEST_MODE` · `NEXT_PUBLIC_DOCS_TEST_MODE`

## Server-only (12)
`SUPABASE_SERVICE_ROLE_KEY` · `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `RESEND_API_KEY` · `RESEND_FROM_EMAIL` · `RESEND_TO_EMAIL` · `GOOGLE_MAPS_SERVER_API_KEY` · `RENTAL_PHOTOS_BUCKET` · `RENTER_LICENSES_BUCKET` · `RENTER_VERIFICATIONS_BUCKET` · `DOCS_TEST_MODE` · `NODE_ENV`

## Required by the platform baseline but absent
`GUEST_TOKEN_SIGNING_SECRET` · `AI_PROVIDER_API_KEY` · `ADMIN_CRON_SECRET`

## Observations
- `NEXT_PUBLIC_SUPABASE_URL` is used as the URL for **service-role** clients throughout (e.g. `app/api/stripe/webhook/route.ts:19`, `lib/supabaseAdmin.ts:23`). Correct, but the baseline calls for a clean server/client split.
- **None of these variables is set in the build container**, which is why `npm run build` fails — see `00-gap-report.md` §1.
