import { NextRequest, NextResponse } from "next/server";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { settingsActorFrom } from "@/lib/couranr/settings/commands";
import {
  createCustomer,
  getCustomer,
  isCustomersFailure,
  listCustomers,
  setCustomerArchived,
} from "@/lib/couranr/customers/commands";
import { failureResponse, routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * MER-008 / MER-009 — the merchant's customer book.
 *
 * One route serves both screens because they are one page: MER-009 is
 * MER-008 at `?customer=`, exactly as the registry declares the route.
 *
 * Tenancy: the caller names a business, `resolveRequestActor` loads their
 * membership in THAT business, and every query is scoped by it. A `customer`
 * key belonging to another tenant resolves to nothing rather than to someone
 * else's record.
 */
export async function GET(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  const actor = settingsActorFrom(resolved);
  if (!actor) {
    return routeFailure("not_permitted", "You do not have access to this business.");
  }

  const key = req.nextUrl.searchParams.get("customer");
  if (key) {
    const detail = await getCustomer({ actor, businessAccountId, key });
    if (isCustomersFailure(detail)) return failureResponse(detail);
    return NextResponse.json(detail.value);
  }

  const list = await listCustomers({ actor, businessAccountId });
  if (isCustomersFailure(list)) return failureResponse(list);
  return NextResponse.json(list.value);
}

/**
 * POST — create a customer, or archive/restore one.
 *
 * Names an ACTION rather than a target column, the same rule every other
 * Couranr route follows: `archive` and `restore` are separate actions, and the
 * command stamps or clears the timestamp itself.
 */
export async function POST(req: NextRequest) {
  const businessAccountId = req.nextUrl.searchParams.get("businessAccountId") ?? "";
  if (!UUID_RE.test(businessAccountId)) {
    return routeFailure("invalid_input", "A business account is required.");
  }

  const resolved = await resolveRequestActor(req, businessAccountId);
  if (isActorDenied(resolved)) return routeFailure(resolved.code, resolved.error);

  const actor = settingsActorFrom(resolved);
  if (!actor) {
    return routeFailure("not_permitted", "You do not have access to this business.");
  }

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return routeFailure("invalid_input", "Send a JSON body.");
  }

  const action = String(body?.action ?? "");

  if (action === "create") {
    const result = await createCustomer({
      actor,
      businessAccountId,
      displayName: String(body?.displayName ?? ""),
      email: String(body?.email ?? ""),
      phone: String(body?.phone ?? ""),
      payerPreference:
        body?.payerPreference === "merchant" || body?.payerPreference === "customer"
          ? body.payerPreference
          : null,
      notes: String(body?.notes ?? ""),
    });
    if (isCustomersFailure(result)) return failureResponse(result);
    return NextResponse.json({ customer: result.value.customer }, { status: 201 });
  }

  if (action === "archive" || action === "restore") {
    const customerId = String(body?.customerId ?? "");
    if (!UUID_RE.test(customerId)) {
      return routeFailure("not_found", "That customer was not found.");
    }
    const result = await setCustomerArchived({
      actor,
      businessAccountId,
      customerId,
      archived: action === "archive",
    });
    if (isCustomersFailure(result)) return failureResponse(result);
    return NextResponse.json({ customer: result.value.customer });
  }

  return routeFailure("invalid_input", "That is not an action Couranr recognises.");
}
