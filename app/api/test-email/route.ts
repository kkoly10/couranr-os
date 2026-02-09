import { NextResponse } from "next/server";
import { Resend } from "resend";

export async function GET() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = process.env.TEST_EMAIL_TO;

  // Don't fail builds if env vars aren't present
  if (!apiKey || !from || !to) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Missing RESEND_API_KEY or RESEND_FROM_EMAIL or TEST_EMAIL_TO environment variables.",
      },
      { status: 500 }
    );
  }

  const resend = new Resend(apiKey);

  await resend.emails.send({
    from,
    to,
    subject: "Couranr test email",
    html: "<h1>It works 🎉</h1>",
  });

  return NextResponse.json({ ok: true });
}