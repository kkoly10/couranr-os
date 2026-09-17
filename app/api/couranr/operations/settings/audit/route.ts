import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  AUDIT_SOURCES,
  isSettingsFailure,
  readOperationsAuditLog,
  type AuditSource,
} from "@/lib/couranr/operations/settings";

export const dynamic = "force-dynamic";

/**
 * OPS-020 — the activity and audit log.
 *
 * **GET IS THE ONLY EXPORT, AND THAT IS THE FEATURE.** OPS-020's constraint is
 * "Append-only; no edit/delete." A route file that exports no POST, PUT, PATCH
 * or DELETE cannot be made to edit an audit record by a body, a query
 * parameter or a mistake — Next answers 405 for every other method because
 * there is nothing to call. The second half of the same guarantee is in the
 * database: the eleven event tables grant service_role SELECT and INSERT and
 * no UPDATE or DELETE, so even a route that tried would be refused.
 *
 * AUTHORIZATION is the Operations-only gate: `resolveRequestActor(req, null)`
 * revalidates the Bearer token with `auth.getUser(token)` and refuses any
 * caller without an Operations profile role.
 *
 * REDACTION happens in `lib/couranr/operations/settings.ts` before anything
 * reaches this file — column allow-lists, key-name denial and value-shape
 * scrubbing — so no secret, token, digest, proof URL, gate code, phone number
 * or address is ever in the object this route serializes.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const url = new URL(req.url);
  const rawSource = url.searchParams.get("source");
  const rawLimit = url.searchParams.get("limit");

  let sources: readonly AuditSource[] | undefined;
  if (rawSource && rawSource !== "all") {
    if (!(AUDIT_SOURCES as readonly string[]).includes(rawSource)) {
      return routeFailure("invalid_input", "That is not an audit source Couranr records.");
    }
    sources = [rawSource as AuditSource];
  }

  const result = await readOperationsAuditLog({
    sources,
    limit: rawLimit === null ? undefined : Number(rawLimit),
  });
  if (isSettingsFailure(result)) return failureResponse(result);

  return NextResponse.json({ audit: result.value });
}
