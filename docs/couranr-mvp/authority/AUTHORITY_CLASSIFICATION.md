# Authority classification table — mechanical recon

Produced by the five `rg` sweeps in §6 of the Authority Consolidation Work Order, run
against branch HEAD `1b9eab2` — two commits ahead of the work order's stated baseline
`11a668b`; both unmerged commits are preserved and reconciled by this program.

Sweeps: **s1** authority claims · **s2** registry references · **s3** composition
contract · **s4** counts/fingerprints · **s5** implementation state.

**141 files** matched at least one sweep.

| Class | Files |
|---|---|
| DOC/DATA | 37 |
| RUNTIME CONSUMER | 37 |
| TEST/GATE | 19 |
| HISTORICAL | 15 |
| EVIDENCE | 14 |
| GENERATOR/GATE | 9 |
| MIRROR -> GENERATED | 6 |
| ACTIVE AUTHORITY | 4 |

## Full table

| Class | File | Hits | Sweeps |
|---|---|---|---|
| ACTIVE AUTHORITY | `02_DECISION_REGISTRY.json` | 27 | s1,s2,s3,s4 |
| ACTIVE AUTHORITY | `docs/couranr-mvp/IMPLEMENTATION_LEDGER.csv` | 4 | s1,s4 |
| ACTIVE AUTHORITY | `docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv` | 6 | s2,s4 |
| ACTIVE AUTHORITY | `ui_screen_registry.json` | 1 | s1 |
| DOC/DATA | `CLAUDE.md` | 14 | s1,s2,s4,s5 |
| DOC/DATA | `Couranr_Claude_Code_Master_Package.md` | 3 | s1 |
| DOC/DATA | `docs/couranr-mvp/AUTONOMOUS_COMPLETION_EXECUTION_SPEC.md` | 27 | s1,s2,s4,s5 |
| DOC/DATA | `docs/couranr-mvp/MARKETING_POSITIONING_AND_HOMEPAGE_BLUEPRINT.md` | 3 | s1,s2 |
| DOC/DATA | `docs/couranr-mvp/PRELAUNCH_LIVE_INTEGRATIONS.md` | 1 | s5 |
| DOC/DATA | `docs/couranr-mvp/PRODUCTION_MIGRATION_RUNBOOK.md` | 4 | s5 |
| DOC/DATA | `docs/couranr-mvp/brand/COURANR_VISUAL_FIDELITY_AMENDMENT.md` | 2 | s2 |
| DOC/DATA | `docs/couranr-mvp/brand/COURANR_VISUAL_SYSTEM_V2_2.md` | 47 | s1,s2,s3,s4,s5 |
| DOC/DATA | `docs/couranr-mvp/brand/PRODUCT_FAMILIES_V4_V6_REVIEW.md` | 1 | s2 |
| DOC/DATA | `docs/couranr-mvp/brand/PUB-001_GATE_A_REGION_REVIEW.md` | 1 | s1 |
| DOC/DATA | `docs/couranr-mvp/brand/PUB-001_PHOTOGRAPHY_BRIEF.md` | 2 | s2 |
| DOC/DATA | `docs/couranr-mvp/brand/PUB-FAMILY_V3_REVIEW.md` | 5 | s2 |
| DOC/DATA | `docs/couranr-mvp/platform-baseline-v1.1/01_PLATFORM_BASELINE_SPEC.md` | 4 | s1 |
| DOC/DATA | `docs/couranr-mvp/platform-baseline-v1.1/08_CLAUDE_CODE_IMPLEMENTATION_PROMPT.md` | 2 | s2,s4 |
| DOC/DATA | `docs/couranr-mvp/platform-baseline-v1.1/10_PHASE_0_READINESS_START_PROMPT.md` | 2 | s2,s4 |
| DOC/DATA | `docs/couranr-mvp/platform-baseline-v1.1/README.md` | 1 | s2 |
| DOC/DATA | `docs/couranr-mvp/security-db/SECURITY_DB_P0_AND_P1_PACKAGE.md` | 18 | s1,s4 |
| DOC/DATA | `docs/couranr-mvp/ui-reference/.upload-status` | 1 | s2 |
| DOC/DATA | `docs/couranr-mvp/ui-reference/CANONICAL_IMAGE_MANIFEST.md` | 1 | s2 |
| DOC/DATA | `docs/couranr-mvp/ui-reference/PUB_001_VISUAL_DRIFT_LEDGER.csv` | 6 | s2,s3,s5 |
| DOC/DATA | `docs/couranr-mvp/ui-reference/README.md` | 1 | s2 |
| DOC/DATA | `package-lock.json` | 53 | s4 |
| DOC/DATA | `supabase/migrations/20260731045417_couranr_delivery_requests.sql` | 2 | s1 |
| DOC/DATA | `supabase/migrations/20260731230000_couranr_payment_authorization.sql` | 1 | s4 |
| DOC/DATA | `supabase/migrations/20260731233000_couranr_payment_commands.sql` | 1 | s4 |
| DOC/DATA | `supabase/migrations/20260801121000_couranr_capture_pending_webhook_guard.sql` | 2 | s1 |
| DOC/DATA | `supabase/migrations/20260801190000_couranr_managed_dispatch.sql` | 1 | s1 |
| DOC/DATA | `supabase/migrations/20260804090000_couranr_delivery_access_tokens.sql` | 2 | s4 |
| DOC/DATA | `supabase/migrations/20260804150000_couranr_conversations.sql` | 2 | s2 |
| DOC/DATA | `supabase/migrations/20260804160000_couranr_delivery_help.sql` | 2 | s4 |
| DOC/DATA | `supabase/migrations/20260804170000_couranr_conversation_kind_and_tenure.sql` | 1 | s2 |
| DOC/DATA | `supabase/migrations/20260804200000_couranr_help_hardening.sql` | 1 | s4 |
| DOC/DATA | `supabase/migrations/20260806120000_couranr_team_management.sql` | 1 | s2 |
| DOC/DATA | `supabase/migrations/20260806210000_couranr_release_authorization.sql` | 1 | s2 |
| DOC/DATA | `supabase/migrations/20260806220000_couranr_idempotency_records.sql` | 1 | s1 |
| DOC/DATA | `supabase/rollbacks/20260804200000_couranr_help_hardening.rollback.sql` | 1 | s4 |
| DOC/DATA | `supabase/verification/terminal_capture_resolution.sql` | 3 | s1 |
| EVIDENCE | `docs/couranr-mvp/autonomous-evidence/B00/ACP-001/results.json` | 1 | s4 |
| EVIDENCE | `docs/couranr-mvp/autonomous-evidence/B03/contracts/MER-001.md` | 6 | s2,s4 |
| EVIDENCE | `docs/couranr-mvp/autonomous-evidence/B03/contracts/MER-001MER-016.md` | 6 | s2,s4 |
| EVIDENCE | `docs/couranr-mvp/autonomous-evidence/B03/contracts/MER-008-Customers-list---MER-009.md` | 6 | s2,s4 |
| EVIDENCE | `docs/couranr-mvp/autonomous-evidence/B03/contracts/MER-013.md` | 4 | s2 |
| EVIDENCE | `docs/couranr-mvp/autonomous-evidence/B03/contracts/MER-014-Merchant-settings--MER-015.md` | 8 | s1,s2,s5 |
| EVIDENCE | `docs/couranr-mvp/autonomous-evidence/B03/contracts/c2.md` | 3 | s2 |
| EVIDENCE | `docs/couranr-mvp/ui-reference/evidence/PUB-001/2026-08-29-notice-removed/README.md` | 2 | s2,s5 |
| EVIDENCE | `docs/couranr-mvp/ui-reference/evidence/PUB-001/2026-08-29-photo-placements/README.md` | 1 | s4 |
| EVIDENCE | `docs/couranr-mvp/ui-reference/evidence/PUB-001/intentional-deviations.md` | 4 | s2,s5 |
| EVIDENCE | `docs/couranr-mvp/ui-reference/evidence/PUB-001/native-mock-references.md` | 4 | s2,s4 |
| EVIDENCE | `docs/couranr-mvp/ui-reference/evidence/PUB-001/region-review.md` | 4 | s4 |
| EVIDENCE | `docs/couranr-mvp/ui-reference/evidence/PUB-001/responsive-proof.json` | 1 | s4 |
| EVIDENCE | `docs/couranr-mvp/ui-reference/evidence/PUB-001/typography-proof.json` | 1 | s4 |
| GENERATOR/GATE | `scripts/buildMarketingImages.mjs` | 3 | s4 |
| GENERATOR/GATE | `scripts/captureEvidence.mjs` | 1 | s3 |
| GENERATOR/GATE | `scripts/checkMockMap.mjs` | 12 | s2,s4 |
| GENERATOR/GATE | `scripts/checkRoutes.mjs` | 2 | s5 |
| GENERATOR/GATE | `scripts/checkVisualSystem.mjs` | 18 | s1,s2,s3 |
| GENERATOR/GATE | `scripts/ciLocal.mjs` | 1 | s4 |
| GENERATOR/GATE | `scripts/compositionContract.mjs` | 7 | s2,s3 |
| GENERATOR/GATE | `scripts/provisionPostgrest.mjs` | 1 | s4 |
| GENERATOR/GATE | `scripts/visualAuthorityRegistry.mjs` | 19 | s2,s3,s4 |
| HISTORICAL | `couranr_claude_code_package/00_PROVENANCE.md` | 1 | s1 |
| HISTORICAL | `couranr_claude_code_package/00_README.md` | 1 | s1 |
| HISTORICAL | `couranr_claude_code_package/01_MASTER_IMPLEMENTATION_SPEC.md` | 1 | s1 |
| HISTORICAL | `couranr_claude_code_package/02_DECISION_REGISTRY.json` | 1 | s1 |
| HISTORICAL | `couranr_claude_code_package/04_PHASED_EXECUTION_PLAN.md` | 1 | s1 |
| HISTORICAL | `docs/couranr-mvp/00-current-state-inventory.md` | 1 | s5 |
| HISTORICAL | `docs/couranr-mvp/00-env-inventory.md` | 1 | s5 |
| HISTORICAL | `docs/couranr-mvp/00-gap-report.md` | 1 | s5 |
| HISTORICAL | `docs/couranr-mvp/00-schema-inventory.md` | 1 | s5 |
| HISTORICAL | `docs/couranr-mvp/00-storage-inventory.md` | 1 | s5 |
| HISTORICAL | `docs/couranr-mvp/00-stripe-inventory.md` | 1 | s5 |
| HISTORICAL | `docs/couranr-mvp/ACTIVE_EXECUTION_SLICE.md` | 11 | s2,s4,s5 |
| HISTORICAL | `docs/couranr-mvp/AUTONOMOUS_RUN_STATE.json` | 3 | s1,s5 |
| HISTORICAL | `docs/couranr-mvp/COURANR_MVP_EXECUTION_CONTROL_RECONCILIATION.md` | 23 | s1,s4,s5 |
| HISTORICAL | `docs/couranr-mvp/PHASE8_RECONCILIATION.md` | 1 | s2 |
| MIRROR -> GENERATED | `UI_SCREEN_REGISTRY.md` | 4 | s1,s2 |
| MIRROR -> GENERATED | `docs/couranr-mvp/IMPLEMENTATION_STATUS.md` | 18 | s1,s2,s4,s5 |
| MIRROR -> GENERATED | `docs/couranr-mvp/MOCK_TO_SCREEN_MAP.md` | 4 | s2,s4 |
| MIRROR -> GENERATED | `docs/couranr-mvp/ui-reference/CANONICAL_SCREEN_SOURCE_MAP.md` | 3 | s2,s4 |
| MIRROR -> GENERATED | `docs/couranr-mvp/ui-reference/VISUAL_AUTHORITY_REGISTRY.json` | 22 | s2,s4 |
| MIRROR -> GENERATED | `ui_screen_registry.csv` | 1 | s1 |
| RUNTIME CONSUMER | `app/(couranr)/(public)/(business-public)/businesses/page.tsx` | 6 | s3 |
| RUNTIME CONSUMER | `app/(couranr)/(public)/(token-public)/help/[token]/page.tsx` | 1 | s2 |
| RUNTIME CONSUMER | `app/(couranr)/(public)/(business-public)/how-it-works/page.tsx` | 7 | s3 |
| RUNTIME CONSUMER | `app/(couranr)/(public)/(business-public)/business/page.tsx` | 16 | s2,s3 |
| RUNTIME CONSUMER | `app/(couranr)/(public)/(business-public)/pricing/page.tsx` | 9 | s2,s3 |
| RUNTIME CONSUMER | `app/(couranr)/(public)/(business-public)/service-areas/page.tsx` | 6 | s3 |
| RUNTIME CONSUMER | `app/(couranr)/business/page.tsx` | 1 | s2 |
| RUNTIME CONSUMER | `app/(couranr)/couranr.css` | 5 | s2,s3,s4 |
| RUNTIME CONSUMER | `app/(couranr)/driver/deliveries/[id]/page.tsx` | 1 | s2 |
| RUNTIME CONSUMER | `app/(couranr)/internal/ui/page.tsx` | 4 | s2 |
| RUNTIME CONSUMER | `app/(couranr)/shell.css` | 1 | s2 |
| RUNTIME CONSUMER | `app/api/couranr/help/[token]/route.ts` | 1 | s2 |
| RUNTIME CONSUMER | `app/api/couranr/operations/inbox/route.ts` | 1 | s2 |
| RUNTIME CONSUMER | `components/couranr/conversations/OperationsInbox.tsx` | 1 | s2 |
| RUNTIME CONSUMER | `components/couranr/dashboard/MerchantDashboard.tsx` | 1 | s2 |
| RUNTIME CONSUMER | `components/couranr/help/DeliveryHelpPage.tsx` | 1 | s2 |
| RUNTIME CONSUMER | `components/couranr/marketing/MarketingIcons.tsx` | 1 | s2 |
| RUNTIME CONSUMER | `components/couranr/primitives.tsx` | 1 | s2 |
| RUNTIME CONSUMER | `components/couranr/states.tsx` | 1 | s2 |
| RUNTIME CONSUMER | `lib/couranr/accessTokens.ts` | 1 | s4 |
| RUNTIME CONSUMER | `lib/couranr/billing/commands.ts` | 1 | s1 |
| RUNTIME CONSUMER | `lib/couranr/conversations/commands.ts` | 1 | s2 |
| RUNTIME CONSUMER | `lib/couranr/conversations/help.ts` | 1 | s4 |
| RUNTIME CONSUMER | `lib/couranr/conversations/projection.ts` | 1 | s2 |
| RUNTIME CONSUMER | `lib/couranr/conversations/states.ts` | 2 | s2 |
| RUNTIME CONSUMER | `lib/couranr/customers/commands.ts` | 2 | s4 |
| RUNTIME CONSUMER | `lib/couranr/customers/identity.ts` | 2 | s4 |
| RUNTIME CONSUMER | `lib/couranr/dashboard/attention.ts` | 1 | s2 |
| RUNTIME CONSUMER | `lib/couranr/driver/codes.ts` | 1 | s4 |
| RUNTIME CONSUMER | `lib/couranr/navigation.ts` | 4 | s2 |
| RUNTIME CONSUMER | `lib/couranr/presets/fields.ts` | 1 | s2 |
| RUNTIME CONSUMER | `lib/couranr/presets/states.ts` | 1 | s2 |
| RUNTIME CONSUMER | `lib/couranr/previewGate.ts` | 1 | s2 |
| RUNTIME CONSUMER | `lib/couranr/screens.ts` | 12 | s2,s4 |
| RUNTIME CONSUMER | `lib/couranr/settings/websiteTools.ts` | 1 | s2 |
| RUNTIME CONSUMER | `lib/delivery/pricing.ts` | 1 | s1 |
| RUNTIME CONSUMER | `lib/supabaseClient.ts` | 1 | s5 |
| TEST/GATE | `e2e/db.mjs` | 1 | s4 |
| TEST/GATE | `e2e/disposable/authenticatedMessaging.mjs` | 1 | s4 |
| TEST/GATE | `e2e/disposable/customerHelpFragments.mjs` | 3 | s4 |
| TEST/GATE | `e2e/disposable/dbTest.mjs` | 4 | s4 |
| TEST/GATE | `e2e/disposable/gateway.mjs` | 2 | s4 |
| TEST/GATE | `e2e/disposable/merchantDashboard.mjs` | 1 | s2 |
| TEST/GATE | `e2e/phase8Acceptance.mjs` | 1 | s4 |
| TEST/GATE | `e2e/pub001Gates.mjs` | 9 | s2,s3 |
| TEST/GATE | `e2e/publicFamilyGates.mjs` | 12 | s2,s3,s4 |
| TEST/GATE | `tests/couranr-conversations.test.ts` | 1 | s2 |
| TEST/GATE | `tests/couranr-foundation.test.ts` | 1 | s2 |
| TEST/GATE | `tests/couranr-implementation-ledger.test.ts` | 18 | s1,s2,s4,s5 |
| TEST/GATE | `tests/couranr-marketing-photos.test.ts` | 1 | s2 |
| TEST/GATE | `tests/couranr-navigation.test.ts` | 2 | s2 |
| TEST/GATE | `tests/couranr-public-composition.test.ts` | 10 | s2,s3 |
| TEST/GATE | `tests/couranr-screens.test.ts` | 12 | s2,s4 |
| TEST/GATE | `tests/couranr-visual-tokens.test.ts` | 2 | s2 |
| TEST/GATE | `tests/decision-registry-provenance.test.ts` | 6 | s1,s4 |
| TEST/GATE | `tests/decision-registry.test.ts` | 8 | s1,s2 |
