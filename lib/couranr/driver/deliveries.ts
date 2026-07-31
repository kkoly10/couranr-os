/**
 * The driver delivery read model — one definition shared by the API route and
 * both driver screens.
 *
 * This module exists because the three pieces had drifted apart and each was
 * wrong in a different way:
 *
 *   /driver                     selected deliveries.pickup_address and
 *                               deliveries.dropoff_address — columns that do
 *                               not exist. The screen rendered
 *                               "Error: column deliveries.pickup_address does
 *                               not exist" to the driver.
 *   /driver/deliveries          expected joined pickup_address/dropoff_address
 *                               OBJECTS and read `payload.deliveries`.
 *   /api/driver/my-deliveries   selected `*` with no join at all and returned
 *                               `{ data }`, so `data.deliveries` was always
 *                               undefined and the list was permanently empty.
 *
 * The real schema is `pickup_address_id` / `dropoff_address_id` referencing
 * `addresses`, so the join has to be explicit. Both screens now consume this
 * one shape and nothing queries Supabase directly from the browser.
 */

/** Address as the `addresses` table actually stores it. */
export type AddressRow = {
  address_line: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

/** What both driver screens render. Field names are the API contract. */
export type DriverDelivery = {
  id: string;
  status: string;
  createdAt: string | null;
  recipientName: string | null;
  estimatedMiles: number | null;
  weightLb: number | null;
  orderNumber: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
};

/** The endpoint's response envelope. The client reads `deliveries`, nothing else. */
export type DriverDeliveriesPayload = { deliveries: DriverDelivery[] };

/**
 * PostgREST select for the read.
 *
 * The two address joins MUST be disambiguated by constraint name: `deliveries`
 * has two foreign keys into `addresses`, so an unqualified `addresses(...)`
 * embed is ambiguous and PostgREST rejects it. `alias:table!constraint(cols)`
 * is the documented form.
 */
export const DRIVER_DELIVERY_SELECT = `
  id,
  status,
  created_at,
  recipient_name,
  estimated_miles,
  weight_lbs,
  order:orders!deliveries_order_id_fkey ( order_number ),
  pickup:addresses!deliveries_pickup_address_id_fkey ( address_line, city, state, zip ),
  dropoff:addresses!deliveries_dropoff_address_id_fkey ( address_line, city, state, zip )
`;

/**
 * Renders an address for a human, tolerating any field being null.
 *
 * A driver standing on a doorstep is better served by a partial address than by
 * "null, null null" or an empty string, so present whatever exists and return
 * null only when nothing does.
 */
export function formatAddress(a: AddressRow | null | undefined): string | null {
  if (!a) return null;
  const line = (a.address_line ?? "").trim();
  const city = (a.city ?? "").trim();
  const state = (a.state ?? "").trim();
  const zip = (a.zip ?? "").trim();

  // "state zip" joins with a space; the rest with commas.
  const region = [state, zip].filter(Boolean).join(" ");
  const parts = [line, city, region].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** numeric(…) arrives from PostgREST as a string; render it as a number. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A PostgREST embed is an object for a to-one relationship, but some client
 * versions surface it as a single-element array. Accept both rather than
 * rendering nothing when the shape shifts.
 */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Maps one joined row to the shape the screens render. Allow-list, not spread. */
export function toDriverDelivery(row: any): DriverDelivery {
  return {
    id: String(row?.id ?? ""),
    status: String(row?.status ?? "unknown"),
    createdAt: row?.created_at ?? null,
    recipientName: row?.recipient_name ?? null,
    estimatedMiles: num(row?.estimated_miles),
    // The column is weight_lbs; the contract field is weightLb.
    weightLb: num(row?.weight_lbs),
    orderNumber: one<any>(row?.order)?.order_number ?? null,
    pickupAddress: formatAddress(one<AddressRow>(row?.pickup)),
    dropoffAddress: formatAddress(one<AddressRow>(row?.dropoff)),
  };
}

/** Outcome of the client-side read. Discriminated so a failure cannot be
 *  mistaken for an empty list — that confusion is exactly why the deliveries
 *  screen showed "No assigned deliveries" for a payload it never understood. */
export type DriverLoad =
  | { ok: true; deliveries: DriverDelivery[] }
  | { ok: false; status: number; message: string; correlationId?: string };

/**
 * Explicit narrowing helper.
 *
 * `tsconfig.json` sets `"strict": false`, under which TypeScript does NOT narrow
 * a discriminated union on a boolean tag. Every consumer must go through this
 * predicate; reading `r.message` after `if (r.ok)` fails to compile otherwise.
 */
export function isDriverLoadFailure(
  r: DriverLoad
): r is { ok: false; status: number; message: string; correlationId?: string } {
  return r.ok === false;
}

/**
 * Reads the canonical endpoint from a browser.
 *
 * Never throws for an HTTP error, and never surfaces a server message it was
 * not given: the endpoint already returns sanitized copy, and anything
 * unexpected collapses to neutral text rather than being rendered raw.
 */
export async function fetchMyDeliveries(signal?: AbortSignal): Promise<DriverLoad> {
  let res: Response;
  try {
    res = await fetch("/api/driver/my-deliveries", { signal, cache: "no-store" });
  } catch {
    return { ok: false, status: 0, message: "Could not reach Couranr. Check your connection and try again." };
  }

  let body: any = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      message:
        typeof body?.error === "string" && body.error.length > 0
          ? body.error
          : "We could not load your deliveries.",
      correlationId: typeof body?.correlationId === "string" ? body.correlationId : undefined,
    };
  }

  // Only a well-formed payload counts as success. A 200 whose shape we do not
  // recognise is a failure, not an empty list.
  if (!Array.isArray(body?.deliveries)) {
    return { ok: false, status: res.status, message: "We could not load your deliveries." };
  }

  return { ok: true, deliveries: body.deliveries as DriverDelivery[] };
}

/** Statuses a driver acts on, and the copy for each. */
export const DRIVER_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  assigned: "Assigned",
  in_transit: "In transit",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const statusLabel = (s: string): string => DRIVER_STATUS_LABELS[s] ?? s;

/** The one a driver is working right now, if any. */
export function activeDelivery(list: DriverDelivery[]): DriverDelivery | null {
  return list.find((d) => d.status === "assigned" || d.status === "in_transit") ?? null;
}

/** Completed today, in the viewer's own timezone. */
export function completedToday(list: DriverDelivery[], now: Date = new Date()): DriverDelivery[] {
  return list.filter((d) => {
    if (d.status !== "completed" && d.status !== "delivered") return false;
    if (!d.createdAt) return false;
    const t = new Date(d.createdAt);
    return (
      t.getFullYear() === now.getFullYear() &&
      t.getMonth() === now.getMonth() &&
      t.getDate() === now.getDate()
    );
  });
}
