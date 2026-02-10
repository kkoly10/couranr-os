import { createClientComponentClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "./types"; // optional, safe if not present

// If you don't have lib/types.ts, remove "<Database>" below and it still works.
export const supabase = createClientComponentClient<Database>();