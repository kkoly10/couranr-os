import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client (bypasses RLS).
 * IMPORTANT: Never use this in client components.
 */
export const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
