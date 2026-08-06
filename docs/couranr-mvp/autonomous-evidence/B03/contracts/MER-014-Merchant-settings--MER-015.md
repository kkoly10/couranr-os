BUILD CONTRACT — MER-014 Merchant settings & MER-015 Team and permissions
All claims verified by commands run in this session; citations are file:line in /home/user/couranr-os.

=====================================================================
0. CURRENT STATE (measured)
=====================================================================
- Both pages are placeholders: `app/(couranr)/business/settings/page.tsx:10-14` and `app/(couranr)/business/settings/team/page.tsx:10-14` render only `ScreenPlaceholder`. Ledger confirms `placeholder_only` for both (`docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv:33-34`).
- Sub-nav already exists and links General/Team/Billing: `lib/couranr/navigation.ts:139-144`. Screen registry entries exist with `implemented: false`: `lib/couranr/screens.ts:73-74`.
- Layout/shell: `app/(couranr)/business/layout.tsx:17-22` — `MerchantShell` + `SurfaceGuard surface="business"`; guard is UX-only, authorization lives in server routes (comment at :14-15).
- Canonical mocks: registry paths `canonical-mvp-images/merchant/MER-014_merchant-settings.png` / `MER-015_team-and-permissions.png` DO NOT exist on disk (`canonical-mvp-images/merchant/` holds only MER-008 and MER-010). Raw sources DO exist at repo root per `docs/couranr-mvp/ui-reference/CANONICAL_SCREEN_SOURCE_MAP.tsv:4,43,54,75` — MER-014: `031480FD-EE0D-4371-9A71-DACFD0DF926F.png` (desktop) + `6C50B445-2B6B-4544-B84A-74E722F2B51C.png` (variant B); MER-015: `838119C6-6DE5-4381-A4FC-A3AFE9839164.png` (desktop) + `CFC37EF0-ECF0-41FE-A7B4-BA35FC9DFC89.png` (variant B). Never delete root PNGs; the source-map WORKFLOW in platform-dependency-baseline must not be run (CLAUDE.md).

=====================================================================
1. AUTHORITY ROWS
=====================================================================
MER-014 (`UI_SCREEN_REGISTRY.md:409-418`): route `/business/settings`, Core, Phase 4–8, desktop-first. Purpose: business profile, pickup defaults, categories, payer defaults, notifications, security, delivery policies. Allowed actions: edit business; update defaults; manage policies; configure operational notifications. REQUIRED STATES: **Saved; unsaved; verification required; permission denied**. Constraint: **"Locked policy registry wins over any mock values. No subscription controls in pilot."** (`:417`).

MER-015 (`UI_SCREEN_REGISTRY.md:420-429`): route `/business/settings/team`, Core, Phase 4, desktop-first. Purpose: invite staff and manage owner, manager/dispatcher, billing, counter-staff, view-only access. Allowed actions: invite; resend; change role; disable/remove; review activity. REQUIRED STATES: **Pending invitation; active; disabled; last-owner protection**. Constraint: least privilege + tenant isolation; driver access is assignment-scoped (`:428`). NOTE: the registry's role WORDING ("counter-staff", "view-only") does not match the schema roles; the binding vocabulary is the five DB roles `owner|manager|dispatcher|viewer|billing` (`docs/business-portal-schema.sql:24`, TRM-002 `declared_roles`, `lib/couranr/requests/permissions.ts:11`). Do not invent a sixth role.

Decision registry (rank 1):
- **TRM-002 (decided 2026-08-06)** — five roles, but its `scope` field says "conversations and messaging only. This decision does not define any other permission for these roles." Acceptance criterion: "Each of the five roles has an explicit permission set before MER-015 ships." Affected: `/business/settings/team`, MER-015, `public.business_members`, `lib/businessAccount.ts`. Code must cite TRM-002, never DRP-001.
- **DRP-001 (decided)** — bounds request create/submit to owner/manager/dispatcher; invited/disabled denied everything; explicitly "not the complete team-role matrix".
- **PAY-001 (decided)** — "Either the merchant or the customer may pay; onboarding captures a default only" → payer default on MER-014 is a default, never a lock.
- **TRM-001** — Couranr-institutional copy only; support target 15 min during operating hours; no 24/7 claims.
- **HRS-002** — all hours language in America/New_York.
- No registry record lists MER-014 in `affected_screen_ids` (verified by script over all 43 records; only TRM-002 touches these routes). **The team-role permission matrix beyond conversations (TRM-002) and request create/submit (DRP-001) is UNDEFINED — this is the gating open decision for both screens** (see §5).

=====================================================================
2. WHAT ALREADY EXISTS (call it, don't rebuild it)
=====================================================================
Data layer:
- `public.business_members` — pre-exists in the live DB (no repo migration creates it; only `couranr_merchant_workspace.sql:208-210` inserts into it). Documented shape `docs/business-portal-schema.sql:19-31`: `role check in ('owner','manager','dispatcher','viewer','billing')`, `status check in ('active','invited','disabled')`, `invited_email text`, `joined_at`, `unique(business_account_id,user_id)`. Live-shape verification is an obligation (docs cover ~21% of DB).
- `public.couranr_merchant_workspaces` — `supabase/migrations/20260731061356_couranr_merchant_workspace.sql:62-111`: `business_category` (11-value check :94-105), `pickup_address jsonb`, `contact_phone`, `payer_default check ('merchant','customer')` (:107), `policies_version`. service_role already has SELECT, INSERT, **UPDATE** (:122) — a MER-014 profile-update command needs no new grant on this table. RLS enabled, zero policies, deny-all to anon/authenticated (:118-120).
- `public.business_accounts` — has `name`, `timezone` (default America/New_York), `status`, `billing_email` (`docs/business-portal-schema.sql:8-17`).

Server/auth plumbing (reuse verbatim):
- Actor resolution: `lib/couranr/requests/actor.ts` — `resolveUserId` (:56-71, Bearer→`auth.getUser`, never `getSession`), `resolveRequestActor` (:79-144, loads membership row incl. `role`,`status`), `listActiveMemberships` (:174-194, fails closed). Ops = profile role `admin` only (:29).
- Permission matrices to imitate: `lib/couranr/requests/permissions.ts:54-95` (pure, unit-tested in `tests/couranr-request-permissions.test.ts`); `lib/couranr/conversations/states.ts:276-315` — `MERCHANT_CONVERSATION_PERMISSIONS` + fail-closed `memberMayRead/memberMayPost`, pinned to the registry by `tests/decision-registry-provenance.test.ts`.
- Route shape: `app/api/couranr/me/workspace/route.ts` (POST, Idempotency-Key required :35-38, actor resolved before command); error mapping via `lib/couranr/requests/respond.ts`; tenant listing `app/api/couranr/me/business-accounts/route.ts` (server decides tenant; client never states it, :13-22).
- Named-command precedent with tenant/role check + SQL function + CR-class errcodes: `couranr_create_merchant_workspace` (`20260731061356:127-236`) and `lib/couranr/onboarding/commands.ts`.
- Client fetch pattern: `"use client"` per-domain `client.ts` reading `supabase.auth.getSession().access_token` into a Bearer header — `components/couranr/onboarding/client.ts:35-36`, `components/couranr/requests/client.ts:40-41`.
- Onboarding vocabulary to re-display on MER-014: `BUSINESS_CATEGORIES` and `POLICIES_VERSION` (`lib/couranr/onboarding/workspace.ts:22-45`), address normalizer (:154-236) — reuse for pickup-address edits; it already refuses client-supplied amounts (:118-146).

What is NET-NEW (verified absent):
- No GET endpoint returns the workspace profile (only `lib/couranr/dispatch/commands.ts:565` reads `couranr_merchant_workspaces`; grep over lib+app).
- No workspace-update command or SQL function.
- **Zero invite/team-management code anywhere** — `grep -rni invite lib app` finds only comments/`"invited"` status literal. No membership-mutation command, no last-owner guard, no member-list endpoint.
- No notification-preference or security-settings storage exists anywhere (no table, no decision record).

=====================================================================
3. MER-014 — /business/settings (General)
=====================================================================
File: `app/(couranr)/business/settings/page.tsx` (keep server component thin like `business/onboarding/page.tsx:6-18`; new `"use client"` `components/couranr/settings/MerchantSettings.tsx` + `components/couranr/settings/client.ts`).

Sections and REAL data sources:
1. **Business profile** — `business_accounts.name`, `slug` (read-only), `timezone` (read-only display, HRS-002); source: net-new `GET /api/couranr/me/settings?businessAccountId=…` joining `business_accounts` + `couranr_merchant_workspaces` via service_role, gated by `resolveRequestActor`.
2. **Pickup defaults** — `couranr_merchant_workspaces.pickup_address`, `contact_phone`. Edit via net-new named command `updateMerchantWorkspaceProfile` reusing `normalizeWorkspaceInput` field validators; UPDATE grant already present (`20260731061356:122`).
3. **Category** — `business_category`, options from `BUSINESS_CATEGORIES` (`workspace.ts:22-34`); DB check constraint enforces the same list (:94-105).
4. **Payer default** — `payer_default` merchant|customer (PAY-001: it is a default only; copy must say the payer can still be chosen per delivery — `lib/couranr/requests/view.ts:60` shows this release makes no payment decision).
5. **Delivery policies** — READ-ONLY display of the locked policy registry (`policies_version` accepted at `policies_accepted_at`; current `POLICIES_VERSION = "couranr-policies-2026-07"`, `workspace.ts:45`). Registry constraint `UI_SCREEN_REGISTRY.md:417`: locked registry wins over mock values; mock pricing/policy numbers in `031480FD…png` must NOT be transcribed.
6. **Notifications** — NO storage and NO decision record exists. Ship as an empty state with a next action ("Operational notifications are configured with Couranr Support") — never a fake toggle that persists nowhere.
7. **Security** — no decision record; safe minimum is read-only session/account info (email from token) + link to password reset. No net-new auth surface without a registry record.
8. **NO subscription/billing controls** (`:417`) — billing belongs to MER-016.

Required states → reachability:
- **Saved / unsaved**: client dirty-tracking + PATCH result; drive both in browser.
- **Verification required**: no verification mechanism exists in code or registry → render as the workspace-missing state (member of an account with no `couranr_merchant_workspaces` row — reachable for pre-Couranr `business_accounts` rows) plus mark deeper meaning UNRESOLVED in the ledger note.
- **Permission denied**: role gate below; also non-member (403 from route). Reachable by seeding a `viewer` member.

Role gate (bounded, cite the bound): TRM-002 does not cover settings. Safe least-privilege behavior consistent with DRP-001/TRM-002 pattern: **owner and manager may write; dispatcher/viewer/billing read-only or denied; invited/disabled denied everything; fail closed on unknown role** (mirror `memberMayRead` fail-closed shape, `conversations/states.ts:302-315`). Record this as a bounded implementation decision citing "TRM-002 scope gap", and keep the matrix in ONE pure module (`lib/couranr/settings/permissions.ts`) so the eventual registry record replaces one file. Do not cite DRP-001 for it (TRM-002 acceptance criteria pattern).

=====================================================================
4. MER-015 — /business/settings/team
=====================================================================
File: `app/(couranr)/business/settings/team/page.tsx` + `components/couranr/settings/TeamMembers.tsx`.

All server capability is NET-NEW:
- `GET /api/couranr/me/team?businessAccountId=…` — list `business_members` rows (user email via `supabaseAdmin.auth.admin.getUserById` or `invited_email` for pending) for the caller's account only; actor via `resolveRequestActor`; every active member may read (mirrors DRP-001 read rule).
- Named commands (new migration, same posture as `20260731061356`: RLS-on/no-policy table if an events/audit table is added, revoke-then-grant to service_role, SECURITY INVOKER, `search_path=''`, CR403/CR404/CR409/CR422 errcodes, advisory-lock + idempotency where a double-click would double-write):
  - `couranr_invite_member(business_account_id, invited_email, role)` → row status `'invited'`, `joined_at` null. Unique `(business_account_id,user_id)` exists (`docs/business-portal-schema.sql:30`); an email-based invite needs uniqueness on `(business_account_id, lower(invited_email))` where status='invited' — additive partial index in the migration. Invite acceptance/email delivery has NO spec — pilot-safe version: invite an EXISTING signed-up user by email (resolve via auth admin lookup); "resend" is a no-op stub until a delivery mechanism is decided (empty state with next action, never a fake "sent" toast).
  - `couranr_change_member_role(...)`, `couranr_disable_member(...)`, `couranr_remove_member(...)` (soft: status→'disabled'; hard delete only if the live table has no FK dependents — verify), each with actor-role check, cannot-act-on-self-for-demote/disable-if-last-owner.
  - **Last-owner protection is a REQUIRED STATE** (`UI_SCREEN_REGISTRY.md:427`) and must be enforced IN SQL under `FOR UPDATE`/advisory lock (count of active owners > 1 before demote/disable/remove of an owner), raising e.g. `CR409 last_owner_protected` — not only in TypeScript, since two concurrent demotes would otherwise race.
- Mutation authority (bounded decision, same caveat as §3): **only owner and manager mutate membership; only owner may grant/revoke the owner role**; dispatcher/viewer/billing see read-only; invited/disabled denied (DRP-001 `membership_status` rule). Pure matrix in `lib/couranr/settings/permissions.ts` citing the TRM-002 gap.
- TRM-002 consequences to SURFACE in the UI: role descriptions must state that viewer and billing have no conversation access at all (read AND send refused) — the decided permission set (`conversations/states.ts:276-285`).
- "Review activity" action: no member-activity store exists. Empty state with next action; do not fabricate an activity feed.

Required states → reachability: pending invitation (seed status='invited'), active (seed), disabled (run disable command), last-owner protection (attempt demote of sole owner → CR409 rendered inline). All four seedable on the disposable stack.

=====================================================================
5. GATING OPEN DECISIONS AND SAFE BEHAVIOR
=====================================================================
1. **Full team-role matrix beyond conversations + request create/submit: UNRESOLVED.** TRM-002 `scope` says so explicitly; DRP-001 `note` says "TRM-002 remains unresolved" for everything else. Safe behavior: fail-closed pure matrix, one module, cited to the gap; TRM-002 acceptance criterion "explicit permission set per role before MER-015 ships" is satisfied by making the bounded matrix explicit and tested.
2. **Invite delivery/acceptance mechanism: unspecified anywhere.** Safe: existing-user invites only; no email send (cf. `/api/test-email` counter-example in CLAUDE.md).
3. **"Verification required" state (MER-014): no mechanism defined.** Safe: treat as workspace-profile-missing; record as unresolved.
4. **Notifications & security storage: no table, no decision.** Safe: honest empty states.
5. Registry role names ("counter-staff", "view-only") vs schema roles: use schema roles; labels may read "Counter staff (dispatcher)" / "View only (viewer)" only if you record the mapping; do not add columns.

=====================================================================
6. VERIFICATION OBLIGATIONS
=====================================================================
Per CLAUDE.md protocol, all seven steps, plus:
- **Live-shape check before the migration**: `execute_sql` on project `zrdxlrlqxdslqpnoqmus` — confirm `business_members` columns/checks match `docs/business-portal-schema.sql:19-31`, and `has_table_privilege` for service_role/anon/authenticated on `business_members` and `business_accounts` (pg_default_acl grants ALL to all three — a narrow grant is a no-op; anon may currently have DML on these hand-applied tables: check and, if so, flag, don't silently rely).
- **Unit**: extend the pinned-provenance pattern — new `tests/couranr-settings-permissions.test.ts` asserting the full 5-role × capability matrix and fail-closed unknown role; migration text assertions in `tests/couranr-migrations.test.ts` style.
- **Disposable-stack browser run (MANDATORY)**: `e2e/disposable/up.mjs` (bare PG16 + PostgREST; no Docker daemon) with `gateway.mjs`/`authGateway.mjs` signing in real users; `bootstrap.sql:143-176` already creates `business_accounts`, `business_members`, `profiles` and reproduces production's `pg_default_acl` + BYPASSRLS. Drive with Playwright from `/opt/pw-browsers` (no `playwright install`). Screenshot-per-assertion:
  - owner sees and saves settings (saved/unsaved states); viewer gets read-only/denied; non-member 403.
  - invite → row appears status='invited' (row assertion via psql); change role; disable; **sole-owner demote refused with CR409 and the UI renders the refusal**; concurrent double-demote race (two parallel requests) leaves ≥1 active owner — row assertion.
  - fault injection via `page.route()` 500 on the settings GET → fail-closed render (never "no team members" on error, per the `listActiveMemberships` lesson, `actor.ts:167-173`).
- Update `docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv` rows 33-34 and `lib/couranr/screens.ts:73-74` `implemented` flags (ledger test `tests/couranr-implementation-ledger.test.ts` will otherwise fail/lie).
- Report gap: the disposable stack bypasses production network path and GoTrue; say so in the deliverable report.

Unverified in this session: live-DB shape of `business_members`/`business_accounts` (no Supabase query run); everything else above is backed by the cited reads/greps.