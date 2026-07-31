"use client";

import { supabase } from "@/lib/supabaseClient";

/**
 * Browser session helpers shared by the sign-in form, the sign-out button and
 * the surface guard.
 *
 * The landing destination is never computed here. `getSession()` can be read
 * from the browser, but the ROLE it implies cannot be trusted from the browser,
 * so the destination always comes from `/api/couranr/me/landing`, which
 * revalidates the token and reads `profiles` server-side.
 */

export type LandingResponse = {
  destination: string;
  surface: "operations" | "driver" | "business";
  usedNext: boolean;
  rejectedNextReason: string | null;
};

export async function currentAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export type LandingResult =
  | { ok: true; value: LandingResponse }
  | { ok: false; status: number };

/** Asks the server where this caller belongs. */
export async function fetchLanding(next?: string | null): Promise<LandingResult> {
  const token = await currentAccessToken();
  if (!token) return { ok: false, status: 401 };

  const qs = next ? `?next=${encodeURIComponent(next)}` : "";
  let res: Response;
  try {
    res = await fetch(`/api/couranr/me/landing${qs}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!res.ok) return { ok: false, status: res.status };

  try {
    return { ok: true, value: (await res.json()) as LandingResponse };
  } catch {
    return { ok: false, status: 0 };
  }
}

/**
 * Builds the `next` value for a sign-in redirect from the current location.
 *
 * Only ever a path — never an origin — so the value that ends up in the URL
 * cannot itself become an open redirect if it is echoed somewhere.
 */
export function currentPathAsNext(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.pathname}${window.location.search}`;
}
