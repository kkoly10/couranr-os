import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendEmail, sendSMS } from "@/lib/notify";

export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

async function isAdmin(supabase: any) {
  const { data: u } = await supabase.auth.getUser();
  const user = u?.user;
  if (!user) return { ok: false, user: null };

  const { data: prof } = await supabase
    .from("profiles")
    .select("role,email")
    .eq("id", user.id)
    .single();

  return { ok: prof?.role === "admin", user };
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );

    const adminCheck = await isAdmin(supabase);
    if (!adminCheck.ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body.rentalId || "");
    const type = String(body.type || ""); // approved | return_reminder | deposit_refunded | deposit_withheld | payment_received
    if (!rentalId || !type) return NextResponse.json({ error: "Missing rentalId/type" }, { status: 400 });

    const { data: rental, error } = await supabase
      .from("rentals")
      .select(
        `
        id,
        user_id,
        purpose,
        pickup_at,
        lockbox_code,
        vehicles ( year, make, model )
      `
      )
      .eq("id", rentalId)
      .single();

    if (error || !rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });

    // Email source (profiles table has email)
    const { data: prof } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", rental.user_id)
      .single();

    const customerEmail = String(prof?.email || "");
    // Phone: for now we read from renters table if you have it. If not, SMS will skip.
    const { data: renterRow } = await supabase
      .from("renters")
      .select("phone")
      .eq("user_id", rental.user_id)
      .maybeSingle();

    const phone = String((renterRow as any)?.phone || "");

    const v: any = rental.vehicles;
    const carTitle = `${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim() || "Couranr Auto";

    const site = process.env.NEXT_PUBLIC_SITE_URL || req.headers.get("origin") || "";
    const dashboardUrl = `${site}/dashboard/auto`;

    const templates: Record<string, { subject: string; html: string; sms?: string }> = {
      approved: {
        subject: `✅ Approved — Pickup instructions for ${carTitle}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <h2>You're approved!</h2>
            <p><strong>Vehicle:</strong> ${carTitle}</p>
            <p><strong>Pickup:</strong> ${rental.pickup_at ?? ""}</p>
            <p>Go to your Auto Dashboard for next steps and lockbox access:</p>
            <p><a href="${dashboardUrl}">${dashboardUrl}</a></p>
            <p style="margin-top:14px;color:#6b7280;font-size:12px">
              Transactional message from Couranr Auto.
            </p>
          </div>
        `,
        sms: `Couranr Auto: You’re approved for ${carTitle}. Open your dashboard for pickup instructions: ${dashboardUrl}`,
      },

      return_reminder: {
        subject: `⏰ Return reminder — ${carTitle}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <h2>Return reminder</h2>
            <p><strong>Vehicle:</strong> ${carTitle}</p>
            <p>Please complete return steps in your dashboard (photos + confirmation):</p>
            <p><a href="${dashboardUrl}">${dashboardUrl}</a></p>
          </div>
        `,
        sms: `Couranr Auto: Return reminder for ${carTitle}. Complete return steps in your dashboard: ${dashboardUrl}`,
      },

      deposit_refunded: {
        subject: `💵 Deposit refunded — ${carTitle}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <h2>Deposit refunded</h2>
            <p>Your deposit has been marked as <strong>refunded</strong>.</p>
            <p>See details in your dashboard:</p>
            <p><a href="${dashboardUrl}">${dashboardUrl}</a></p>
          </div>
        `,
        sms: `Couranr Auto: Your deposit was refunded. Details: ${dashboardUrl}`,
      },

      deposit_withheld: {
        subject: `⚠️ Deposit update — ${carTitle}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <h2>Deposit update</h2>
            <p>Your deposit has been marked as <strong>withheld</strong> pending review or charges.</p>
            <p>See details in your dashboard:</p>
            <p><a href="${dashboardUrl}">${dashboardUrl}</a></p>
          </div>
        `,
        sms: `Couranr Auto: Deposit update (withheld). Details: ${dashboardUrl}`,
      },

      payment_received: {
        subject: `✅ Payment received — ${carTitle}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.6">
            <h2>Payment received</h2>
            <p>We received your payment for <strong>${carTitle}</strong>.</p>
            <p>Next steps will appear in your Auto Dashboard:</p>
            <p><a href="${dashboardUrl}">${dashboardUrl}</a></p>
          </div>
        `,
        sms: `Couranr Auto: Payment received for ${carTitle}. Next steps: ${dashboardUrl}`,
      },
    };

    const t = templates[type];
    if (!t) return NextResponse.json({ error: "Unknown type" }, { status: 400 });

    // Email required in your standard. If missing, we still return success but log.
    const emailResult = customerEmail
      ? await sendEmail({ to: customerEmail, subject: t.subject, html: t.html })
      : { ok: false, skipped: true, reason: "Missing customer email" };

    const smsResult =
      phone && t.sms ? await sendSMS({ to: phone, body: t.sms }) : { ok: false, skipped: true, reason: "No phone/SMS template" };

    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: adminCheck.user.id,
      actor_role: "admin",
      event_type: "notification_sent",
      event_payload: {
        type,
        email: customerEmail || null,
        emailResult,
        phone: phone || null,
        smsResult,
      },
    });

    return NextResponse.json({ ok: true, emailResult, smsResult });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}