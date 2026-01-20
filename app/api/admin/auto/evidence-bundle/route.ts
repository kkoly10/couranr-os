import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import JSZip from "jszip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function safeFilename(name: string) {
  return name.replace(/[^\w.\-]+/g, "_").slice(0, 180);
}

async function fetchAsBuffer(url: string, timeoutMs = 15000): Promise<Buffer | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);

    if (!res.ok) return null;

    // Basic safety cap (25MB)
    const len = Number(res.headers.get("content-length") || "0");
    if (len && len > 25 * 1024 * 1024) return null;

    const ab = await res.arrayBuffer();
    if (ab.byteLength > 25 * 1024 * 1024) return null;

    return Buffer.from(ab);
  } catch {
    return null;
  }
}

function extFromUrl(url: string) {
  try {
    const u = new URL(url);
    const p = u.pathname.toLowerCase();
    const m = p.match(/\.(jpg|jpeg|png|webp|pdf)$/);
    return m ? `.${m[1]}` : "";
  } catch {
    return "";
  }
}

async function assertAdmin(token: string) {
  const supabase = createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: u, error: uErr } = await supabase.auth.getUser();
  if (uErr || !u?.user) throw new Error("Unauthorized");

  const { data: p, error: pErr } = await supabase
    .from("profiles")
    .select("role,email")
    .eq("id", u.user.id)
    .maybeSingle();

  if (pErr) throw new Error(pErr.message);
  if (!p || p.role !== "admin") throw new Error("Forbidden");

  return { userId: u.user.id, adminEmail: p.email || null };
}

export async function GET(req: Request) {
  try {
    // -------- Auth (admin only) --------
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    await assertAdmin(token);

    // -------- Parse rentalId --------
    const { searchParams } = new URL(req.url);
    const rentalId = String(searchParams.get("rentalId") || "").trim();
    if (!rentalId) return NextResponse.json({ error: "Missing rentalId" }, { status: 400 });

    // -------- Server-side Supabase (service role) --------
    const adminDb = createClient(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY")
    );

    // Rental core
    const { data: rental, error: rErr } = await adminDb
      .from("rentals")
      .select(
        `
        id,
        created_at,
        status,
        purpose,
        user_id,
        agreement_signed,
        docs_complete,
        verification_status,
        verification_denial_reason,
        paid,
        paid_at,
        lockbox_code_released_at,
        pickup_confirmed_at,
        return_confirmed_at,
        damage_confirmed,
        damage_confirmed_at,
        damage_notes,
        deposit_refund_status,
        deposit_refund_amount_cents,
        stripe_checkout_session_id,
        vehicles ( year, make, model )
      `
      )
      .eq("id", rentalId)
      .single();

    if (rErr || !rental) return NextResponse.json({ error: "Rental not found" }, { status: 404 });

    // Verification (one row)
    const { data: ver, error: vErr } = await adminDb
      .from("renter_verifications")
      .select("*")
      .eq("rental_id", rentalId)
      .maybeSingle();

    if (vErr) {
      return NextResponse.json({ error: vErr.message }, { status: 500 });
    }

    // Condition photos
    const { data: photos, error: pErr } = await adminDb
      .from("rental_condition_photos")
      .select("*")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    if (pErr) {
      return NextResponse.json({ error: pErr.message }, { status: 500 });
    }

    // Timeline / audit
    const { data: events, error: eErr } = await adminDb
      .from("rental_events")
      .select("*")
      .eq("rental_id", rentalId)
      .order("created_at", { ascending: true });

    if (eErr) {
      return NextResponse.json({ error: eErr.message }, { status: 500 });
    }

    // -------- Build ZIP --------
    const zip = new JSZip();
    const root = zip.folder(`rental-${safeFilename(rentalId)}`)!;

    // Summary
    const v = (rental as any).vehicles;
    const vehicleLabel =
      Array.isArray(v) && v.length > 0
        ? `${v[0]?.year ?? ""} ${v[0]?.make ?? ""} ${v[0]?.model ?? ""}`.trim()
        : v && typeof v === "object"
        ? `${v?.year ?? ""} ${v?.make ?? ""} ${v?.model ?? ""}`.trim()
        : "";

    const summaryLines = [
      `Rental ID: ${rental.id}`,
      `Created: ${rental.created_at}`,
      `Status: ${rental.status}`,
      `Vehicle: ${vehicleLabel || "—"}`,
      `Purpose: ${rental.purpose || "—"}`,
      `User ID: ${rental.user_id || "—"}`,
      ``,
      `Docs complete: ${rental.docs_complete ? "Yes" : "No"}`,
      `Verification status: ${rental.verification_status || "—"}`,
      `Agreement signed: ${rental.agreement_signed ? "Yes" : "No"}`,
      `Paid: ${rental.paid ? "Yes" : "No"}`,
      `Paid at: ${rental.paid_at || "—"}`,
      `Lockbox released at: ${rental.lockbox_code_released_at || "—"}`,
      `Pickup confirmed at: ${rental.pickup_confirmed_at || "—"}`,
      `Return confirmed at: ${rental.return_confirmed_at || "—"}`,
      ``,
      `Damage confirmed: ${rental.damage_confirmed ? "Yes" : "No"}`,
      `Damage confirmed at: ${rental.damage_confirmed_at || "—"}`,
      `Damage notes: ${rental.damage_notes || "—"}`,
      ``,
      `Deposit status: ${rental.deposit_refund_status || "—"}`,
      `Deposit withheld (cents): ${Number(rental.deposit_refund_amount_cents || 0)}`,
      `Stripe session id: ${rental.stripe_checkout_session_id || "—"}`,
    ];
    root.file("summary.txt", summaryLines.join("\n"));

    // Timeline JSON
    root.file(
      "timeline.json",
      JSON.stringify(
        {
          rental,
          renter_verification: ver || null,
          condition_photos: photos || [],
          events: events || [],
        },
        null,
        2
      )
    );

    // Identity
    const identity = root.folder("identity")!;
    if (ver?.license_front_url) {
      const buf = await fetchAsBuffer(ver.license_front_url);
      if (buf) identity.file(`license-front${extFromUrl(ver.license_front_url) || ".jpg"}`, buf);
    }
    if (ver?.license_back_url) {
      const buf = await fetchAsBuffer(ver.license_back_url);
      if (buf) identity.file(`license-back${extFromUrl(ver.license_back_url) || ".jpg"}`, buf);
    }
    if (ver?.selfie_url) {
      const buf = await fetchAsBuffer(ver.selfie_url);
      if (buf) identity.file(`selfie${extFromUrl(ver.selfie_url) || ".jpg"}`, buf);
    }

    // Condition photos by phase
    const photosFolder = root.folder("photos")!;
    const phaseMap: Record<string, string> = {
      pickup_exterior: "pickup-exterior",
      pickup_interior: "pickup-interior",
      return_exterior: "return-exterior",
      return_interior: "return-interior",
    };

    const grouped: Record<string, any[]> = {};
    for (const ph of Object.keys(phaseMap)) grouped[ph] = [];
    for (const row of photos || []) {
      const ph = String((row as any).phase || "");
      if (!grouped[ph]) grouped[ph] = [];
      grouped[ph].push(row);
    }

    for (const ph of Object.keys(grouped)) {
      const folder = photosFolder.folder(phaseMap[ph] || safeFilename(ph))!;
      const rows = grouped[ph] || [];
      for (let i = 0; i < rows.length; i++) {
        const url = String(rows[i]?.photo_url || "");
        if (!url) continue;

        const buf = await fetchAsBuffer(url);
        if (!buf) continue;

        const ext = extFromUrl(url) || ".jpg";
        const name = `photo-${String(i + 1).padStart(2, "0")}${ext}`;
        folder.file(name, buf);
      }
    }

    // Generate zip buffer
    const zipBuf = await zip.generateAsync({ type: "nodebuffer" });

    const filename = `rental-${safeFilename(rentalId)}-evidence.zip`;

    return new Response(zipBuf, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Server error" },
      { status: 500 }
    );
  }
}