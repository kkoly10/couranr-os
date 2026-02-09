// app/api/test-email/route.ts
import { NextResponse } from "next/server";
import { Resend } from "resend";

export const dynamic = "force-dynamic";

function getEnv(name: string) {
  return (process.env[name] || "").trim();
}

export async function POST(req: Request) {
  try {
    const RESEND_API_KEY = getEnv("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      return NextResponse.json(
        { error: "RESEND_API_KEY is not set (email disabled)." },
        { status: 400 }
      );
    }

    const resend = new Resend(RESEND_API_KEY);

    const body = await req.json().catch(() => ({}));
    const to = String(body?.to || "").trim();
    const subject = String(body?.subject || "Test email").trim();
    const html = String(body?.html || "<p>Test email</p>").trim();

    if (!to) {
      return NextResponse.json({ error: "Missing 'to' email." }, { status: 400 });
    }

    const from = getEnv("RESEND_FROM") || "Couranr <onboarding@resend.dev>";
    const result = await resend.emails.send({ from, to, subject, html });

    return NextResponse.json({ ok: true, result }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to send email" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const hasKey = !!getEnv("RESEND_API_KEY");
  return NextResponse.json({ ok: true, resendConfigured: hasKey });
}
