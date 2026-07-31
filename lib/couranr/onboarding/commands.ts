import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import type { CommandFailure, CommandResult } from "@/lib/couranr/requests/commands";
import { isCommandFailure } from "@/lib/couranr/requests/commands";
import { isWorkspaceFailure, normalizeWorkspaceInput } from "./workspace";

assertServerOnly("lib/couranr/onboarding/commands.ts");

/**
 * The named server command that creates a merchant workspace.
 *
 * ONE `.rpc()` call. The business account, the active owner membership and the
 * workspace profile are created in a single transaction, so a merchant can
 * never hold an account they are not a member of — the failure mode that makes
 * a half-finished signup unrecoverable without manual database surgery.
 */

export const CREATE_WORKSPACE_RPC = "couranr_create_merchant_workspace";

/**
 * Profile roles that run Couranr, and therefore must not own a merchant.
 *
 * Only `admin` exists: `profiles_role_check` permits customer, driver and admin.
 * The SQL function also checks for 'operations' — harmless, since the constraint
 * makes that value unreachable — and removing it would cost a migration for no
 * behavioural change.
 */
const OPERATIONS_PROFILE_ROLES = ["admin"];

function fail(params: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
  details?: Array<{ code: string; field?: string }>;
}): CommandFailure {
  const correlationId = newCorrelationId();
  logServerFailure({
    correlationId,
    operation: params.operation,
    code: params.code,
    detail: params.detail,
  });
  const out: CommandFailure = { ok: false, code: params.code, correlationId };
  if (params.message) out.message = params.message;
  if (params.details) out.details = params.details;
  return out;
}

export type WorkspaceSummary = {
  businessAccountId: string;
  workspaceId: string;
  businessCategory: string;
  payerDefault: string;
};

/**
 * Creates the caller's merchant workspace.
 *
 * `ownerUserId` is the AUTHENTICATED caller, resolved server-side from
 * `auth.getUser()`. There is no parameter — here or in the SQL function — for a
 * client to name a different owner.
 */
export async function createMerchantWorkspace(params: {
  ownerUserId: string;
  idempotencyKey: string;
  rawInput: unknown;
}): Promise<CommandResult<WorkspaceSummary>> {
  const op = "createMerchantWorkspace";

  const normalized = normalizeWorkspaceInput(params.rawInput);
  if (isWorkspaceFailure(normalized)) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: normalized.errors,
      details: normalized.errors,
      message: "Some details need attention before your workspace can be created.",
    });
  }
  const draft = normalized.value;

  // A Couranr Operations user walking through onboarding must not become a
  // merchant owner. Checked here AND in the SQL function (CR403) — two
  // enforcement points, because this one is bypassable by any future caller
  // that forgets it.
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("role")
    .eq("id", params.ownerUserId)
    .maybeSingle();

  if (profileError) {
    return fail({ operation: op, code: "internal", detail: profileError.message });
  }
  if (OPERATIONS_PROFILE_ROLES.includes(String(profile?.role ?? ""))) {
    return fail({
      operation: op,
      code: "not_permitted",
      detail: { role: profile?.role },
      message:
        "This account runs Couranr Operations and cannot own a merchant workspace. Use a separate merchant sign-in.",
    });
  }

  const { data, error } = (await supabaseAdmin.rpc(CREATE_WORKSPACE_RPC, {
    p_owner_user_id: params.ownerUserId,
    p_idempotency_key: params.idempotencyKey,
    p_name: draft.name,
    p_slug_base: draft.slugBase,
    p_business_category: draft.businessCategory,
    p_pickup_address: draft.pickupAddress,
    p_contact_phone: draft.contactPhone,
    p_payer_default: draft.payerDefault,
    p_policies_version: draft.policiesVersion,
  })) as { data: any; error: any };

  if (error) {
    // CR403 is the database's own refusal of an Operations owner.
    const code: PublicErrorCode =
      error.code === "CR403" ? "not_permitted" : classifyDatabaseError(error);
    return fail({
      operation: op,
      code,
      detail: { code: error.code, message: error.message },
      message:
        code === "not_permitted"
          ? "This account cannot own a merchant workspace."
          : undefined,
    });
  }
  if (!data) {
    return fail({ operation: op, code: "internal", detail: { reason: "no row returned" } });
  }

  return {
    ok: true,
    value: {
      businessAccountId: String(data.business_account_id),
      workspaceId: String(data.id),
      businessCategory: String(data.business_category),
      payerDefault: String(data.payer_default),
    },
  };
}

export { isCommandFailure };
