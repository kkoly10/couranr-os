import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const dynamic = "force-dynamic";

function genCode() {
  // 6 digits
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data: u } = await supabase.auth.getUser();
    if (!u?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: prof } = await supabase.from("profiles").select("role").eq("id", u.user.id).single();
    if (prof?.role !== "admin") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const rentalId = String(body.rentalId || "");
    const action = String(body.action || "");
    const reason = String(body.reason || "");
    const lockboxCode = body.lockboxCode ? String(body.lockboxCode) : null;

    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });
    if (!["approve", "deny"].includes(action)) return NextResponse.json({ error: "Invalid action" }, { status: 400 });

    if (action === "deny" && !reason.trim()) {
      return NextResponse.json({ error: "Denial reason required" }, { status: 400 });
    }

    if (action === "approve") {
      const code = lockboxCode || genCode();

      const { error } = await supabase
        .from("rentals")
        .update({
          verification_status: "approved",
          verification_denial_reason: null,
          lockbox_code: code,
        })
        .eq("id", rentalId);

      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      await supabase.from("rental_events").insert({
        rental_id: rentalId,
        actor_user_id: u.user.id,
        actor_role: "admin",
        event_type: "verification_approved",
        event_payload: { lockbox_code_set: true },
      });

      return NextResponse.json({ ok: true });
    }

    // deny
    const { error: denyErr } = await supabase
      .from("rentals")
      .update({
        verification_status: "denied",
        verification_denial_reason: reason.trim(),
        lockbox_code: null,
        lockbox_code_released_at: null,
      })
      .eq("id", rentalId);

    if (denyErr) return NextResponse.json({ error: denyErr.message }, { status: 500 });

    await supabase.from("rental_events").insert({
      rental_id: rentalId,
      actor_user_id: u.user.id,
      actor_role: "admin",
      event_type: "verification_denied",
      event_payload: { reason: reason.trim() },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Server error" }, { status: 500 });
  }
}