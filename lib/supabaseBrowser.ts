// lib/supabaseBrowser.ts
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

/**
 * Browser-only Supabase client (safe for "use client" components).
 * Uses NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY automatically.
 */
export const supabaseBrowser = createClientComponentClient();