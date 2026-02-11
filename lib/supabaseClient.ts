// lib/supabaseClient.ts
"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

/**
 * Client-side Supabase (cookie-synced).
 * Use this everywhere in client components.
 */
export const supabase = createClientComponentClient();