"use client";

import { supabase } from "@/lib/supabaseClient";

/**
 * Browser data access for onboarding.
 *
 * Same rule as the delivery-request screens: every write goes through an
 * authenticated API route. `couranr_merchant_workspaces` grants nothing to
 * `authenticated`, and `business_accounts` has no INSERT policy, so a direct
 * browser write is impossible by design rather than by convention.
 */

export type { ApiFailure, ApiResult } from "@/components/couranr/requests/client";
export {
  isApiFailure,
  newIdempotencyKey,
  withReference,
  fetchMyBusinessAccounts,
} from "@/components/couranr/requests/client";

import type { ApiResult } from "@/components/couranr/requests/client";

export type CreatedWorkspace = {
  businessAccountId: string;
  workspaceId: string;
  businessCategory: string;
  payerDefault: string;
};

export async function createWorkspace(input: {
  idempotencyKey: string;
  workspace: unknown;
}): Promise<ApiResult<{ workspace: CreatedWorkspace }>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { ok: false, status: 401, error: "Sign in to continue." };

  let res: Response;
  try {
    res = await fetch("/api/couranr/me/workspace", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({ workspace: input.workspace }),
    });
  } catch {
    return { ok: false, status: 0, error: "You appear to be offline." };
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: payload?.error || "Something went wrong.",
      code: payload?.code,
      correlationId: payload?.correlationId,
      details: payload?.details,
    };
  }
  return { ok: true, value: payload };
}
