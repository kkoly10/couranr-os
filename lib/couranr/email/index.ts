/**
 * Couranr transactional email system.
 *
 * Pure, self-contained render functions: plain data in → bulletproof,
 * on-brand HTML out. No app/database imports, so the whole subsystem previews
 * and unit-tests in isolation and can be wired to a sender (Resend) later.
 *
 *  - templates/business.ts     Couranr → merchant
 *  - templates/customer.ts     merchant → recipient (sent by Couranr)
 *  - templates/supabaseAuth.ts Supabase Auth emails, for the dashboard
 */

export * from "./theme";
export * from "./types";
export * from "./primitives";
export * from "./templates/business";
export * from "./templates/customer";
export * from "./templates/supabaseAuth";
