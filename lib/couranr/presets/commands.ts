import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import type { ActorMembership } from "@/lib/couranr/settings/commands";
import {
  removedFieldsMessage,
  stripForbiddenFields,
  type PresetBody,
} from "@/lib/couranr/presets/fields";
import { presetState, type PresetState } from "@/lib/couranr/presets/states";

assertServerOnly("lib/couranr/presets/commands.ts");

/**
 * ACP-025 command layer.
 *
 * Every write goes through a named SQL command. This layer adds exactly two
 * things the SQL cannot: it STRIPS forbidden fields before they reach the
 * database, and it tells the merchant which ones were dropped. The CHECK would
 * refuse them anyway — but as a constraint violation, which is a sentence
 * nobody can act on. Stripping first turns a refusal into an explanation.
 */

export type PresetFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type PresetResult<T> = { ok: true; value: T } | PresetFailure;

export function isPresetFailure(r: { ok: boolean }): r is PresetFailure {
  return r.ok === false;
}

function fail(p: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): PresetFailure {
  const correlationId = newCorrelationId();
  logServerFailure({ correlationId, operation: p.operation, code: p.code, detail: p.detail });
  const out: PresetFailure = { ok: false, code: p.code, correlationId };
  if (p.message) out.message = p.message;
  return out;
}

export const PRESET_RPC = {
  create: "couranr_create_merchant_preset",
  update: "couranr_update_merchant_preset",
  adopt: "couranr_adopt_preset_recommendation",
  duplicate: "couranr_duplicate_merchant_preset",
  setArchived: "couranr_set_merchant_preset_archived",
} as const;

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<PresetResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: { fn, code: error.code, message: error.message },
      // The one database refusal a merchant can act on, so it gets words.
      message:
        error.message && /preset_version_conflict/.test(String(error.message))
          ? "Someone else saved this preset while you were editing it. Reload to see their version before saving yours."
          : undefined,
    });
  }
  if (data === null || data === undefined) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data as T };
}

export type PresetView = {
  id: string;
  name: string;
  body: PresetBody;
  version: number;
  state: PresetState;
  archivedAt: string | null;
  /** Null for a merchant-created preset. */
  sourcePresetId: string | null;
  sourceVersion: number | null;
  currentSourceVersion: number | null;
  updatedAt: string;
};

export type GlobalPresetView = {
  id: string;
  name: string;
  body: PresetBody;
  version: number;
  businessCategory: string;
};

export type PresetsView = {
  businessAccountId: string;
  presets: PresetView[];
  /**
   * Couranr's suggestions for this merchant's categories that they have not
   * customized yet. MER-010's "global recommendation" state.
   */
  suggestions: GlobalPresetView[];
};

/**
 * Everything MER-010 lists.
 *
 * The merchant's own presets, plus the Couranr suggestions for their
 * categories that they have NOT already taken — a suggestion they customized
 * is already in the first list, and showing it twice would read as two
 * presets.
 */
export async function listPresets(params: {
  businessAccountId: string;
  /** Primary plus secondary, so suggestions follow the whole business. */
  categories: readonly string[];
  includeArchived?: boolean;
}): Promise<PresetResult<PresetsView>> {
  const op = "listPresets";

  let q = supabaseAdmin
    .from("couranr_merchant_presets")
    .select(
      "id,name,body,version,archived_at,source_category_preset_id,source_version,updated_at"
    )
    .eq("business_account_id", params.businessAccountId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (!params.includeArchived) q = q.is("archived_at", null);

  const mine = await q;
  if (mine.error || !Array.isArray(mine.data)) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_merchant_presets", error: mine.error },
    });
  }

  // Every global preset that is either a source of theirs or a suggestion for
  // one of their categories — one query, not one per row.
  const sourceIds = Array.from(
    new Set(
      mine.data
        .map((r: any) => r.source_category_preset_id)
        .filter((v: unknown): v is string => typeof v === "string")
    )
  );
  const cats = params.categories.filter((c) => typeof c === "string" && c);

  const globals = await supabaseAdmin
    .from("couranr_category_presets")
    .select("id,name,body,version,business_category,archived_at")
    .is("archived_at", null)
    .or(
      [
        cats.length > 0 ? `business_category.in.(${cats.join(",")})` : null,
        sourceIds.length > 0 ? `id.in.(${sourceIds.join(",")})` : null,
      ]
        .filter(Boolean)
        .join(",") || "id.is.null"
    );

  if (globals.error || !Array.isArray(globals.data)) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_category_presets", error: globals.error },
    });
  }

  const globalById = new Map<string, any>();
  for (const g of globals.data as any[]) globalById.set(String(g.id), g);

  const presets: PresetView[] = mine.data.map((row: any) => {
    const sourceId = row.source_category_preset_id ? String(row.source_category_preset_id) : null;
    const current = sourceId ? globalById.get(sourceId) : null;
    // Null, not 0, when the source could not be read: `presetState` treats an
    // unknown current version as "no update", which is the answer that claims
    // the least. A 0 would make every customization look stale.
    const currentSourceVersion =
      current && typeof current.version === "number" ? current.version : null;

    return {
      id: String(row.id),
      name: String(row.name),
      body: (row.body ?? {}) as PresetBody,
      version: Number(row.version),
      archivedAt: row.archived_at ?? null,
      sourcePresetId: sourceId,
      sourceVersion: row.source_version === null ? null : Number(row.source_version),
      currentSourceVersion,
      updatedAt: String(row.updated_at),
      state: presetState({
        archivedAt: row.archived_at ?? null,
        sourcePresetId: sourceId,
        sourceVersion: row.source_version === null ? null : Number(row.source_version),
        currentSourceVersion,
      }),
    };
  });

  const alreadyTaken = new Set(presets.map((p) => p.sourcePresetId).filter(Boolean));
  const suggestions: GlobalPresetView[] = (globals.data as any[])
    .filter((g) => cats.includes(String(g.business_category)) && !alreadyTaken.has(String(g.id)))
    .map((g) => ({
      id: String(g.id),
      name: String(g.name),
      body: (g.body ?? {}) as PresetBody,
      version: Number(g.version),
      businessCategory: String(g.business_category),
    }));

  return {
    ok: true,
    value: { businessAccountId: params.businessAccountId, presets, suggestions },
  };
}

/** What a write returns: the row, plus anything the merchant should be told. */
export type PresetWriteResult = {
  presetId: string;
  version: number;
  /** Set when a forbidden field was dropped. Never silent. */
  notice: string | null;
};

function writeResult(row: any, removed: readonly string[]): PresetWriteResult {
  return {
    presetId: String(row.id),
    version: Number(row.version),
    notice: removedFieldsMessage(removed),
  };
}

export async function createPreset(params: {
  actor: ActorMembership;
  businessAccountId: string;
  name: string;
  body: unknown;
  sourcePresetId?: string | null;
}): Promise<PresetResult<PresetWriteResult>> {
  const op = "createPreset";
  const { body, removed } = stripForbiddenFields(params.body);

  const r = await callRpc<Record<string, any>>(op, PRESET_RPC.create, {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_name: params.name,
    p_body: body,
    p_source_preset_id: params.sourcePresetId ?? null,
  });
  if (isPresetFailure(r)) return r;
  return { ok: true, value: writeResult(r.value, removed) };
}

export async function updatePreset(params: {
  actor: ActorMembership;
  businessAccountId: string;
  presetId: string;
  name: string;
  body: unknown;
  /** The version the editor LOADED. Never the current one. */
  expectedVersion: number;
}): Promise<PresetResult<PresetWriteResult>> {
  const op = "updatePreset";
  const { body, removed } = stripForbiddenFields(params.body);

  const r = await callRpc<Record<string, any>>(op, PRESET_RPC.update, {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_preset_id: params.presetId,
    p_name: params.name,
    p_body: body,
    p_expected_version: params.expectedVersion,
  });
  if (isPresetFailure(r)) return r;
  return { ok: true, value: writeResult(r.value, removed) };
}

/**
 * Take a Couranr update — the only path a global body reaches a merchant row,
 * and only because the merchant asked.
 */
export async function adoptRecommendation(params: {
  actor: ActorMembership;
  businessAccountId: string;
  presetId: string;
  expectedVersion: number;
}): Promise<PresetResult<PresetWriteResult>> {
  const op = "adoptRecommendation";
  const r = await callRpc<Record<string, any>>(op, PRESET_RPC.adopt, {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_preset_id: params.presetId,
    p_expected_version: params.expectedVersion,
  });
  if (isPresetFailure(r)) return r;
  return { ok: true, value: writeResult(r.value, []) };
}

export async function duplicatePreset(params: {
  actor: ActorMembership;
  businessAccountId: string;
  presetId: string;
  newName: string;
}): Promise<PresetResult<PresetWriteResult>> {
  const op = "duplicatePreset";
  const r = await callRpc<Record<string, any>>(op, PRESET_RPC.duplicate, {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_preset_id: params.presetId,
    p_new_name: params.newName,
  });
  if (isPresetFailure(r)) return r;
  return { ok: true, value: writeResult(r.value, []) };
}

export async function setPresetArchived(params: {
  actor: ActorMembership;
  businessAccountId: string;
  presetId: string;
  archived: boolean;
}): Promise<PresetResult<PresetWriteResult>> {
  const op = "setPresetArchived";
  const r = await callRpc<Record<string, any>>(op, PRESET_RPC.setArchived, {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_preset_id: params.presetId,
    p_archived: params.archived,
  });
  if (isPresetFailure(r)) return r;
  return { ok: true, value: writeResult(r.value, []) };
}
