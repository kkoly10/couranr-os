/**
 * Couranr transactional email system.
 *
 * Pure, self-contained render functions: plain data in → bulletproof,
 * on-brand HTML out. No app/database imports, so the whole subsystem previews
 * and unit-tests in isolation.
 *
 *  - templates/business.ts     Couranr → merchant
 *  - templates/customer.ts     merchant → recipient (sent by Couranr)
 *  - templates/supabaseAuth.ts Supabase Auth emails, for the dashboard
 *
 * THE SENDER IS DELIBERATELY NOT RE-EXPORTED HERE. `./send` holds
 * RESEND_API_KEY and calls `assertServerOnly`, so re-exporting it through this
 * barrel would make every consumer of a template — including a client
 * component that only wants to render one — import a server-only module and
 * throw. Import it directly: `@/lib/couranr/email/send`.
 *
 * This header used to end "and can be wired to a sender (Resend) later". It
 * never was, for weeks: nothing outside this folder imported the module at all,
 * so all 13 templates were unsendable while 11 tests stayed green. `./send`
 * closes that, and tests/couranr-email-send.test.ts drives the real send path
 * rather than mocking it away.
 */

export * from "./theme";
export * from "./types";
export * from "./primitives";
export * from "./templates/business";
export * from "./templates/customer";
export * from "./templates/supabaseAuth";
