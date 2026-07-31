import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { logServerFailure, newCorrelationId } from "@/lib/couranr/errors";
import {
  DRIVER_DELIVERY_SELECT,
  toDriverDelivery,
  type DriverDeliveriesPayload,
} from "@/lib/couranr/driver/deliveries";

export const dynamic = "force-dynamic";

/**
 * GET /api/driver/my-deliveries — the ONE read both driver screens use.
 *
 * Previously this selected `*` with no join and returned `{ data }`, while the
 * deliveries screen read `data.deliveries` — so the list was permanently empty
 * and nobody noticed, because an empty list is indistinguishable from "no
 * assignments". It also returned `error.message` straight from PostgREST,
 * publishing schema detail to the browser.
 *
 * Authorization lives HERE, not in the page. `SurfaceGuard` decides where a
 * person is sent; this decides what they may read. The two are independent on
 * purpose — bypassing the guard yields an empty screen, not a leaked row.
 */
export async function GET() {
  const correlationId = newCorrelationId();
  const supabase = createRouteHandlerClient({ cookies });

  // 1. A valid session. getUser() revalidates the JWT with Supabase rather than
  //    decoding the cookie, so a forged or stale cookie fails here.
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return NextResponse.json(
      { error: "Sign in to continue.", code: "unauthenticated", correlationId },
      { status: 401 }
    );
  }

  // 2. A driver, confirmed against profiles. A customer with a valid session is
  //    authenticated but not authorized for this read.
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr) {
    // Fail closed: a failed role lookup is NOT evidence of a permitted role,
    // and it is not evidence of a denied one either.
    logServerFailure({
      correlationId,
      operation: "driver.my-deliveries.profile",
      code: "internal",
      detail: profileErr,
    });
    return NextResponse.json(
      { error: "Something went wrong.", code: "internal", correlationId },
      { status: 500 }
    );
  }

  if (profile?.role !== "driver") {
    return NextResponse.json(
      { error: "This area is for Couranr drivers.", code: "forbidden", correlationId },
      { status: 403 }
    );
  }

  // 3. Read with the SERVICE-ROLE client, scoped by hand to this driver.
  //
  //    Not for convenience. `authenticated` deliberately has no SELECT on
  //    `addresses` — that grant was revoked when the addresses P0 was closed
  //    (94 real addresses previously carried full `anon` DML), and the join
  //    fails with 42501 "permission denied for table addresses" on the caller's
  //    own client. Granting SELECT back to `authenticated` would reopen part of
  //    that P0 to every signed-in user, so the read runs as service_role
  //    instead, exactly as the other 62 routes do.
  //
  //    service_role bypasses RLS, so `driver_id = user.id` IS the entire
  //    boundary here. `user.id` comes from getUser() above — a revalidated JWT,
  //    never anything the client sent — and no identifier is read off the
  //    request.
  const { data, error } = await supabaseAdmin
    .from("deliveries")
    .select(DRIVER_DELIVERY_SELECT)
    .eq("driver_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    // Never forward a Supabase or PostgreSQL message. The previous version
    // returned error.message verbatim, which is how a missing column became a
    // schema disclosure rendered on the driver's own dashboard.
    logServerFailure({
      correlationId,
      operation: "driver.my-deliveries.select",
      code: "internal",
      detail: error,
    });
    return NextResponse.json(
      { error: "Something went wrong.", code: "internal", correlationId },
      { status: 500 }
    );
  }

  const payload: DriverDeliveriesPayload = {
    deliveries: (data ?? []).map(toDriverDelivery),
  };

  // `deliveries`, never `data` — the client contract, stated in one place.
  return NextResponse.json(payload);
}
