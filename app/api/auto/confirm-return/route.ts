// app/api/auto/confirm-return/route.ts
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function asSingle<T>(x: any): T | null {
  if (!x) return null;
  if (Array.isArray(x)) return (x[0] as T) ?? null;
  return x as T;
}

async function getUserFromRequest(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("Missing authorization token");
  const token = auth.replace("Bearer ", "");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) throw new Error("Invalid or expired token");
  return data.user;
}

async function getEmailForUserId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();

  return (data as any)?.email ?? null;
}

async function tryPatchRental(rentalId: string, patch: Record<string, any>) {
  const { error } = await supabaseAdmin
    .from("rentals")
    .update(patch)
    .eq("id", rentalId);

  return { error };
}

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const rentalId = body?.rentalId as string | undefined;

    if (!rentalId) {
      return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    }

    const { data: rental, error: rentalErr } = await supabaseAdmin
      .from("rentals")
      .select(`
        id,
        user_id,
        renter_id,
        status,
        paid,
        pickup_confirmed_at,
        return_confirmed_at,
        condition_photos_status,
        vehicle_id,
        vehicles:vehicles(id, year, make, model)
      `)
      .eq("id", rentalId)
      .maybeSingle();

    if (rentalErr || !rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    const ownerId = (rental as any).user_id || (rental as any).renter_id;
    if (ownerId !== user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Must have pickup confirmed before return
    if (!rental.pickup_confirmed_at) {
      return NextResponse.json(
        { error: "Pickup not confirmed yet" },
        { status: 400 }
      );
    }

    // Idempotent behavior
    if (rental.return_confirmed_at) {
      return NextResponse.json(
        { ok: true, message: "Return already confirmed" },
        { status: 200 }
      );
    }

    // Prefer checking the actual photo records (more reliable than only status strings)
    const { data: returnPhotos, error: photoErr } = await supabaseAdmin
      .from("rental_condition_photos")
      .select("phase")
      .eq("rental_id", rentalId)
      .in("phase", ["return_exterior", "return_interior"]);

    if (photoErr) {
      return NextResponse.json(
        { error: `Failed to verify return photos: ${photoErr.message}` },
        { status: 500 }
      );
    }

    const phaseSet = new Set((returnPhotos || []).map((p: any) => p.phase));
    const hasReturnExterior = phaseSet.has("return_exterior");
    const hasReturnInterior = phaseSet.has("return_interior");

    // Fallback compatibility with existing status field
    const cps = String(rental.condition_photos_status || "");
    const statusSuggestsReturnDone =
      cps === "return_exterior_done" ||
      cps === "return_interior_done" ||
      cps === "complete";

    // Require both return photo sets, OR allow known good status from older logic
    const okReturnPhotos =
      (hasReturnExterior && hasReturnInterior) || statusSuggestsReturnDone;

    if (!okReturnPhotos) {
      return NextResponse.json(
        {
          error:
            "Return photos not complete yet. Please upload exterior and interior return photos.",
        },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();

    // CORE UPDATE: this is the only thing required to advance the renter flow
    const core = await tryPatchRental(rentalId, {
      return_confirmed_at: now,
    });

    if (core.error) {
      return NextResponse.json(
        { error: `Failed to confirm return: ${core.error.message}` },
        { status: 500 }
      );
    }

    // BEST-EFFORT PATCHES: don't block renter flow if enum values differ in DB
    const warnings: string[] = [];

    const statusAndDeposit = await tryPatchRental(rentalId, {
      status: "returned",
      deposit_refund_status: "pending", // may fail if enum uses a different label
    });

    if (statusAndDeposit.error) {
      warnings.push(`status/deposit patch skipped: ${statusAndDeposit.error.message}`);

      // Try status only
      const statusOnly = await tryPatchRental(rentalId, { status: "returned" });
      if (statusOnly.error) {
        warnings.push(`status patch skipped: ${statusOnly.error.message}`);
      }

      // Try deposit only
      const depositOnly = await tryPatchRental(rentalId, { deposit_refund_status: "pending" });
      if (depositOnly.error) {
        warnings.push(`deposit patch skipped: ${depositOnly.error.message}`);
      }
    }

    // Event log (best effort)
    const { error: eventErr } = await supabaseAdmin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: user.id,
      actor_role: "renter",
      event_type: "return_confirmed",
      event_payload: { at: now },
    });

    if (eventErr) {
      warnings.push(`event log skipped: ${eventErr.message}`);
    }

    // Email renter (best effort)
    if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) {
      try {
        const renterEmail = await getEmailForUserId(ownerId);
        if (renterEmail) {
          const resend = new Resend(process.env.RESEND_API_KEY);
          const v = asSingle<{ year?: any; make?: any; model?: any }>((rental as any).vehicles);
          const carLabel =
            v?.year && v?.make && v?.model
              ? `${v.year} ${v.make} ${v.model}`
              : "your rental vehicle";

          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL,
            to: renterEmail,
            subject: "Return confirmed — deposit under review (Couranr Auto)",
            text:
              `Your return has been confirmed for ${carLabel}.\n\n` +
              `Damage review (if any) and deposit decision is now pending.\n\n` +
              `— Couranr Auto`,
          });
        }
      } catch (emailErr: any) {
        warnings.push(`email skipped: ${emailErr?.message || "Unknown email error"}`);
      }
    }

    return NextResponse.json({
      ok: true,
      return_confirmed_at: now,
      warnings: warnings.length ? warnings : undefined,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}