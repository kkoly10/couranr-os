import { NextResponse } from "next/server";
import { Resend } from "resend";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  // Prevent build/runtime crashes if env vars aren't set
  if (!apiKey || !from) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Missing RESEND_API_KEY or RESEND_FROM_EMAIL. Add them in Vercel Project Settings → Environment Variables.",
      },
      { status: 500 }
    );
  }

  const resend = new Resend(apiKey);

  // (Optional) swap this for your email
  const to = process.env.RESEND_TO_EMAIL || "your_personal_email@gmail.com";

  const { error } = await resend.emails.send({
    from,
    to,
    subject: "Couranr test email",
    html: "<h1>It works 🎉</h1>",
  });

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}