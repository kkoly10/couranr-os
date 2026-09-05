import { NextRequest, NextResponse } from "next/server";
import { getOperationsFinanceOverview } from "@/lib/couranr/finance/ledger";
import { isActorDenied, resolveRequestActor } from "@/lib/couranr/requests/actor";
import { routeFailure } from "@/lib/couranr/requests/respond";

export const dynamic = "force-dynamic";

/** Operations-only, privacy-safe financial overview. No provider call occurs. */
export async function GET(req: NextRequest) {
  const actor = await resolveRequestActor(req, null);
  if (isActorDenied(actor)) return routeFailure(actor.code, actor.error);

  const result = await getOperationsFinanceOverview();
  if (!result.ok) {
    return NextResponse.json(
      { error: "Could not load payment reconciliation.", code: "internal" },
      { status: 500 },
    );
  }
  return NextResponse.json(result.value);
}
