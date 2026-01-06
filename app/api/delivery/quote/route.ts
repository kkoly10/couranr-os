import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { pickup, dropoff } = await req.json();

  if (!pickup || !dropoff) {
    return NextResponse.json({ error: "Missing addresses" }, { status: 400 });
  }

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?units=imperial&origins=${encodeURIComponent(
    pickup
  )}&destinations=${encodeURIComponent(
    dropoff
  )}&key=${process.env.GOOGLE_MAPS_API_KEY}`;

  const res = await fetch(url);
  const data = await res.json();

  const element = data.rows?.[0]?.elements?.[0];

  if (!element || element.status !== "OK") {
    return NextResponse.json(
      { error: "Unable to calculate distance" },
      { status: 500 }
    );
  }

  const miles = element.distance.value / 1609.34;

  return NextResponse.json({
    miles: Number(miles.toFixed(2)),
    durationText: element.duration.text,
  });
}
