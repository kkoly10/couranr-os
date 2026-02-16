// lib/supabaseClient.ts
"use client";

import { supabaseBrowser } from "@/lib/supabaseBrowser";

// Compatibility alias so older imports keep working.
// Prefer importing supabaseBrowser in new code.
export const supabase = supabaseBrowser;