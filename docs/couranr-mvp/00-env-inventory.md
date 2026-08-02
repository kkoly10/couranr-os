# 00 — Environment inventory (names only, no values)

Variables referenced in code. **No value is recorded here.** `.env.example` at the repo root carries the NAMES only.

## Client-exposed (8)
`NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `NEXT_PUBLIC_SITE_URL` · `NEXT_PUBLIC_APP_URL` · `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` · `NEXT_PUBLIC_TEST_MODE` · `NEXT_PUBLIC_AUTO_TEST_MODE` · `NEXT_PUBLIC_DOCS_TEST_MODE`

## Server-only (12)
`SUPABASE_SERVICE_ROLE_KEY` · `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` · `RESEND_API_KEY` · `RESEND_FROM_EMAIL` · `RESEND_TO_EMAIL` · `GOOGLE_MAPS_SERVER_API_KEY` · `RENTAL_PHOTOS_BUCKET` · `RENTER_LICENSES_BUCKET` · `RENTER_VERIFICATIONS_BUCKET` · `DOCS_TEST_MODE` · `NODE_ENV`

## Required by the platform baseline but absent
`GUEST_TOKEN_SIGNING_SECRET` · `AI_PROVIDER_API_KEY` · `ADMIN_CRON_SECRET`

## Observations
- `NEXT_PUBLIC_SUPABASE_URL` is used as the URL for **service-role** clients throughout (e.g. `app/api/stripe/webhook/route.ts:19`, `lib/supabaseAdmin.ts:23`). Correct, but the baseline calls for a clean server/client split.
- **None of these variables is set in the build container**, which is why `npm run build` fails — see `00-gap-report.md` §1.


## Prelaunch environment register — `COURANR_HANDOFF_CODE_SECRET`

Signs the merchant pickup PIN and the recipient drop-off PIN (HMAC-SHA256,
domain-separated per credential kind and generation).

| Fact | Value |
|---|---|
| Required before | any PIN issuance or verification runs at all |
| Fallback | **none** — no default, no development value, nothing generated at runtime |
| Minimum | 32 bytes of real entropy; empty, short, placeholder and low-entropy values are rejected |
| Client exposure | never; not `NEXT_PUBLIC_*`, and the accessor is `assertServerOnly` |
| Read timing | at command execution, never at module scope, so the build needs no secret |

**Per-environment values are separate and stable.**

- **Local** — set in `.env.local` (gitignored, mode 600).
- **Preview** — **must be set in Vercel before Group Q or any browser PIN testing.** Preview will otherwise fail closed on every PIN route, which is correct behaviour and not a bug to chase. Do not reuse the local value.
- **Production** — a third, different value. Do not configure it until the production prelaunch environment is being prepared.

**Rotation invalidates credentials.** The generation and the code are both
inside the signed input, so changing the secret makes every *existing* pickup
and recipient digest unverifiable. Any delivery holding an active credential at
rotation time must have both codes **regenerated**; a driver presenting a
pre-rotation code will be told `invalid`, and after five attempts the
credential locks. Rotate only with no in-flight handoffs, or regenerate
immediately afterwards.

A build with no secret present must still compile — verified in the Commit 5
gate — and a PIN request without it must return a sanitized internal error
rather than a degraded digest.
