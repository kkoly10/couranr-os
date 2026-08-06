// lib/supabaseClient.ts
"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedBrowserClient } from "@/lib/supabase/client";

/**
 * COMPATIBILITY SHIM — the ~50 existing importers keep working unchanged.
 *
 * The real client now lives in `lib/supabase/client.ts` (@supabase/ssr,
 * cookie-stored sessions, typed with the generated Database). This re-export
 * WIDENS it back to an untyped `SupabaseClient` because several legacy queries
 * name tables the live database does not have (`business_pricing_profiles`
 * among them) and the typed client would fail the build on them — they are
 * B12 quarantine targets, not tonight's fixes.
 *
 * New canonical code imports from `lib/supabase/client` and gets the types.
 *
 * The warning below survives the rewrite because the hazard survives it:
 * this is the BROWSER client. Imported from a server context it carries no
 * session and authenticates as `anon`. Six legacy server files still do this
 * (recorded in AUTONOMOUS_RUN_STATE.json); do not add a seventh.
 */
export const supabase: SupabaseClient = typedBrowserClient as unknown as SupabaseClient;
