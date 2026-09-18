import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";
import {
  applyAvailabilityCommand,
  isAvailabilityCommand,
  isLocalDate,
  isOperationalFlagKey,
  isSettingsFailure,
  readAvailability,
  type AvailabilityCommandInput,
} from "@/lib/couranr/operations/settings";

export const dynamic = "force-dynamic";

/**
 * OPS-016 — availability controls.
 *
 * AUTHORIZATION. `resolveRequestActor(req, null)` is the Operations-only gate:
 * a Bearer token revalidated with `auth.getUser(token)` (never `getSession`),
 * then a profile-role check that refuses anyone who is not Operations. Passing
 * `null` is what makes it Operations-only — a business id would open the
 * membership path.
 *
 * WHAT THIS ROUTE CANNOT CHANGE. Operating days, the 06:00–18:00 window, the
 * 16:00 same-day cutoff, the overnight window and the overnight surcharge are
 * HRS-001, HRS-002 and OVN-001. They are not columns, they are not accepted in
 * a body, and nothing here reads or writes them. OPS-015's constraint — "No
 * mock value overrides the Decision Registry" — is satisfied by their absence
 * from this file, not by a validation rule.
 */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await readAvailability();
  if (isSettingsFailure(result)) return failureResponse(result);

  return NextResponse.json({ availability: result.value });
}

/**
 * Apply ONE named command.
 *
 * NO TARGET STATE IS READ FROM THE BODY, AT ALL.
 *
 * The body carries a command name, a subject (`marketKey` or `flagKey`) and a
 * version. It never carries the state to move to, the switch position, or a
 * column name: each target has its OWN command, and the mapping from command
 * to target lives in `lib/couranr/operations/settings.ts`, out of a caller's
 * reach. This is the convention `/api/delivery/mark-in-transit` was hardened
 * to, and `tests/couranr-server-only.test.ts` and
 * `tests/couranr-driver-execution.test.ts` both fail any canonical route that
 * reads `body.*State` — which is how the first draft of this file, which took
 * `availabilityState`, was caught.
 *
 * `expectedVersion` is required for the two versioned subjects, and the write
 * behind it is a single conditional UPDATE, so a stale editor loses rather than
 * silently overwrites — which is what makes OPS-015's "policy version conflict"
 * state real rather than a label.
 */
export async function PUT(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Couranr could not read that request.");
  }
  if (!body || typeof body !== "object") {
    return routeFailure("invalid_input", "Couranr could not read that request.");
  }

  const command = String(body.command ?? "");
  if (!isAvailabilityCommand(command)) {
    return routeFailure("invalid_input", "That is not a command Couranr recognizes.");
  }

  const marketKey = typeof body.marketKey === "string" ? body.marketKey.trim() : "";
  const expectedVersion = Number(body.expectedVersion);
  let input: AvailabilityCommandInput;

  if (
    command === "set_market_standard" ||
    command === "set_market_scheduled_only" ||
    command === "set_market_temporarily_closed" ||
    command === "set_market_weather_limited"
  ) {
    if (marketKey === "") return routeFailure("invalid_input", "Name the market to change.");
    input = { command, marketKey, expectedVersion };
  } else if (command === "open_market" || command === "close_market") {
    if (marketKey === "") return routeFailure("invalid_input", "Name the market to change.");
    input = { command, marketKey };
  } else if (command === "open_operating_closure") {
    if (marketKey === "") return routeFailure("invalid_input", "Name the market to change.");
    if (!isLocalDate(body.localDate)) {
      return routeFailure("invalid_input", "A closure needs a real calendar date, as YYYY-MM-DD.");
    }
    if (typeof body.reason !== "string" || body.reason.trim() === "") {
      return routeFailure("invalid_input", "Say why the market is closed.");
    }
    input = { command, marketKey, localDate: body.localDate, reason: body.reason };
  } else if (command === "lift_operating_closure") {
    if (typeof body.closureId !== "string" || body.closureId.trim() === "") {
      return routeFailure("invalid_input", "Name the closure to lift.");
    }
    input = { command, closureId: body.closureId.trim() };
  } else if (
    command === "enable_operational_flag" ||
    command === "disable_operational_flag"
  ) {
    if (!isOperationalFlagKey(body.flagKey)) {
      return routeFailure("invalid_input", "That switch is not one Couranr recognizes.");
    }
    input = { command, flagKey: body.flagKey, expectedVersion };
  } else {
    /*
     * Unreachable today — `isAvailabilityCommand` above admits exactly the ten
     * names the branches cover. It is written out anyway because the failure
     * mode of an open `else` is silent: an eleventh command added to the
     * vocabulary would fall into whichever branch happened to be last and be
     * applied as something it is not.
     */
    return routeFailure("invalid_input", "That is not a command Couranr recognizes.");
  }

  const result = await applyAvailabilityCommand(actor.userId, input);
  if (isSettingsFailure(result)) return failureResponse(result);

  return NextResponse.json({
    availability: result.value.view,
    auditRecorded: result.value.auditRecorded,
  });
}
