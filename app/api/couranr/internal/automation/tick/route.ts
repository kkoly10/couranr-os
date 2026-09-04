import { NextRequest, NextResponse } from "next/server";
import { runAutomaticFulfillmentTick } from "@/lib/couranr/automation/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Vercel Cron entrypoint. The schedule header is informative only; the bearer
 * secret is the authentication boundary. Missing configuration fails closed.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, reason: "automation_not_configured" },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  const result = await runAutomaticFulfillmentTick();
  return NextResponse.json({
    ok: true,
    advanced: result.advanced.length,
    dispatched: result.dispatched.length,
  });
}
