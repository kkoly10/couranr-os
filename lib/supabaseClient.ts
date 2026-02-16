"use client";

import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";

// Keep this file ONLY as a compatibility alias.
// All client components should prefer importing from "@/lib/supabaseBrowser".
// But this prevents older imports from breaking.
export const supabase = createClientComponentClient();