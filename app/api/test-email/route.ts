// app/api/test-email/route.ts
import { Resend } from "resend";
import { NextResponse } from "next/server";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function GET() {
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: "your_personal_email@gmail.com",
    subject: "Couranr test email",
    html: "<h1>It works 🎉</h1>",
  });

  return NextResponse.json({ ok: true });
}
