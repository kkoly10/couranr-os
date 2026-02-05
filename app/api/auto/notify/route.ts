export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { getUserFromRequest, requireAdmin } from "@/app/lib/auth";

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function getProfileEmail(admin: any, userId: string) {
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();
  return (data?.email as string | null) ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const rentalId = body?.rentalId as string | undefined;
    const subject = body?.subject as string | undefined;
    const html = body?.html as string | undefined;
    const mode = (body?.mode as string | undefined) || "renter"; // "renter" | "admin"

    if (!rentalId || !subject || !html) {
      return NextResponse.json(
        { error: "Missing rentalId, subject, or html" },
        { status: 400 }
      );
    }

    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.RESEND_FROM_EMAIL;

    if (!resendKey || !fromEmail) {
      return NextResponse.json(
        { error: "Missing RESEND_API_KEY or RESEND_FROM_EMAIL" },
        { status: 500 }
      );
    }

    const admin = adminClient();

    // Who can trigger notify?
    // - renter can only email themselves (renter mode)
    // - admin can email renter or admin address (admin mode)
    let actorRole: "renter" | "admin" = "renter";
    let actorId: string | null = null;

    if (mode === "admin") {
      const adminUser = await requireAdmin(req);
      actorRole = "admin";
      actorId = adminUser.id;
    } else {
      const user = await getUserFromRequest(req);
      actorRole = "renter";
      actorId = user.id;
    }

    // Load rental + enforce permissions
    const { data: rental } = await admin
      .from("rentals")
      .select("id,user_id")
      .eq("id", rentalId)
      .single();

    if (!rental) {
      return NextResponse.json({ error: "Rental not found" }, { status: 404 });
    }

    if (actorRole === "renter" && actorId !== rental.user_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const renterEmail = await getProfileEmail(admin, rental.user_id);
    if (!renterEmail) {
      return NextResponse.json(
        { error: "Renter email not found" },
        { status: 400 }
      );
    }

    const resend = new Resend(resendKey);

    await resend.emails.send({
      from: fromEmail,
      to: renterEmail,
      subject,
      html,
    });

    // Audit
    await admin.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: actorId,
      actor_role: actorRole,
      event_type: "email_sent",
      event_payload: { subject },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}