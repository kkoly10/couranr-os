export type PickupManifest = {
  description: string;
  packageCount: number | null;
  orderReference: string | null;
  handlingNotes: string | null;
  source:
    | "merchant_statement"
    | "consumer_statement"
    | "hosted_customer_statement"
    | "merchant_confirmed"
    | "operations_statement";
};

export type PickupManifestInput = {
  description: string;
  packageCount: number | null;
  orderReference: string | null;
  handlingNotes: string | null;
};

export type PickupManifestView = {
  manifest: PickupManifest;
  manifestVersion: number;
};

const MAX_DESCRIPTION = 1000;
const MAX_REFERENCE = 120;
const MAX_HANDLING = 500;
const MAX_PACKAGES = 9999;

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length <= max ? text : null;
}

export function normalizePickupManifestInput(
  raw: unknown,
): { ok: true; value: PickupManifestInput } | { ok: false; message: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, message: "Expected pickup details." };
  }
  const body = raw as Record<string, unknown>;
  const description = cleanText(body.description, MAX_DESCRIPTION);
  if (!description) {
    return {
      ok: false,
      message: `Describe what the driver should look for in ${MAX_DESCRIPTION} characters or fewer.`,
    };
  }

  let packageCount: number | null = null;
  if (body.packageCount !== null && body.packageCount !== undefined && body.packageCount !== "") {
    const n =
      typeof body.packageCount === "number"
        ? body.packageCount
        : typeof body.packageCount === "string"
          ? Number(body.packageCount.trim())
          : NaN;
    if (!Number.isInteger(n) || n < 1 || n > MAX_PACKAGES) {
      return { ok: false, message: `Package count must be between 1 and ${MAX_PACKAGES}.` };
    }
    packageCount = n;
  }

  const orderReference =
    body.orderReference === null || body.orderReference === undefined || body.orderReference === ""
      ? null
      : cleanText(body.orderReference, MAX_REFERENCE);
  if (
    body.orderReference !== null &&
    body.orderReference !== undefined &&
    body.orderReference !== "" &&
    orderReference === null
  ) {
    return { ok: false, message: `Keep the pickup reference under ${MAX_REFERENCE} characters.` };
  }

  const handlingNotes =
    body.handlingNotes === null || body.handlingNotes === undefined || body.handlingNotes === ""
      ? null
      : cleanText(body.handlingNotes, MAX_HANDLING);
  if (
    body.handlingNotes !== null &&
    body.handlingNotes !== undefined &&
    body.handlingNotes !== "" &&
    handlingNotes === null
  ) {
    return { ok: false, message: `Keep handling notes under ${MAX_HANDLING} characters.` };
  }

  return {
    ok: true,
    value: { description, packageCount, orderReference, handlingNotes },
  };
}

export function pickupManifestFromRow(row: any): PickupManifestView | null {
  const raw = row?.pickup_manifest;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (!description) return null;
  const count =
    typeof raw.packageCount === "number" && Number.isInteger(raw.packageCount)
      ? raw.packageCount
      : null;
  return {
    manifest: {
      description,
      packageCount: count,
      orderReference:
        typeof raw.orderReference === "string" && raw.orderReference.trim()
          ? raw.orderReference
          : null,
      handlingNotes:
        typeof raw.handlingNotes === "string" && raw.handlingNotes.trim()
          ? raw.handlingNotes
          : null,
      source: String(raw.source ?? "merchant_statement") as PickupManifest["source"],
    },
    manifestVersion: Number(row?.pickup_manifest_version ?? 0),
  };
}
