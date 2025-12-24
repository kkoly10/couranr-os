import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { name, contact, message } = await req.json();

    if (!name || !contact || !message) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // For now: log it. Next step: store in Supabase or send email/SMS.
    console.log("SPECIAL_REQUEST", { name, contact, message });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e.message || "Server error" },
      { status: 500 }
    );
  }
}
