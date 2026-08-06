import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import { memberMay, type SettingsCapability } from "@/lib/couranr/settings/permissions";
import type { ActorMembership } from "@/lib/couranr/settings/commands";
import {
  distinctAddresses,
  findDuplicates,
  identityKey,
  maskEmail,
  maskPhone,
  normalizeEmail,
  normalizePhone,
  type DuplicateWarning,
} from "@/lib/couranr/customers/identity";

assertServerOnly("lib/couranr/customers/commands.ts");

/**
 * MER-008 / MER-009 command layer.
 *
 * The customer book is a JOIN OF TWO SOURCES:
 *
 *   1. `merchant_customers` — records the merchant created. These carry the
 *      archive flag, the notes and the payer preference, and they can exist
 *      for someone who has never had a delivery.
 *   2. `couranr_delivery_requests` — the real delivery history, grouped by
 *      normalized recipient identity. This is where counts, last-activity and
 *      saved destinations actually come from; nothing is invented.
 *
 * A person who appears in both is ONE entry, matched on normalized email or
 * phone. That matching is done here with the same pure functions the screen
 * uses, so the row a merchant clicks is the row the server resolved.
 */

export type CustomersFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type CustomersResult<T> = { ok: true; value: T } | CustomersFailure;

export function isCustomersFailure(r: { ok: boolean }): r is CustomersFailure {
  return r.ok === false;
}

function fail(p: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): CustomersFailure {
  const correlationId = newCorrelationId();
  logServerFailure({ correlationId, operation: p.operation, code: p.code, detail: p.detail });
  const out: CustomersFailure = { ok: false, code: p.code, correlationId };
  if (p.message) out.message = p.message;
  return out;
}

async function callRpc<T = any>(
  operation: string,
  fn: string,
  args: Record<string, unknown>
): Promise<CustomersResult<T>> {
  const { data, error } = (await supabaseAdmin.rpc(fn, args)) as { data: any; error: any };
  if (error) {
    return fail({
      operation,
      code: classifyDatabaseError(error),
      detail: { fn, code: error.code, message: error.message },
    });
  }
  if (data === null || data === undefined) {
    return fail({ operation, code: "conflict", detail: { fn, reason: "no row returned" } });
  }
  return { ok: true, value: data as T };
}

function requireCapability(
  operation: string,
  actor: ActorMembership,
  capability: SettingsCapability
): CustomersFailure | null {
  if (memberMay({ role: actor.role, status: actor.status }, capability)) return null;
  return fail({
    operation,
    code: "not_permitted",
    detail: { capability, role: actor.role },
    message: "You do not have access to change this.",
  });
}

/**
 * ONE entry in the customer book.
 *
 * The LIST projection masks contact details — the registry forbids
 * unnecessary PII in the list view — and the detail projection unmasks them,
 * because at that point the merchant is looking at data that came from their
 * own delivery requests.
 */
export type CustomerListEntry = {
  key: string;
  /** Present when a stored record backs this entry. */
  customerId: string | null;
  displayName: string;
  maskedEmail: string | null;
  maskedPhone: string | null;
  deliveryCount: number;
  lastDeliveryAt: string | null;
  lastPayerType: string | null;
  archived: boolean;
  hasActiveDelivery: boolean;
  /** More than one distinct dropoff snapshot for this identity. */
  hasConflictingAddress: boolean;
};

const TERMINAL_REQUEST_STATES: readonly string[] = ["declined", "cancelled", "closed"];

type RequestRow = {
  id: string;
  recipient_name: string | null;
  recipient_phone: string | null;
  recipient_email: string | null;
  dropoff_address: any;
  request_state: string;
  payer_type: string | null;
  created_at: string;
};

/** Groups this business's requests by normalized recipient identity. */
function groupRequests(rows: RequestRow[]) {
  const groups = new Map<
    string,
    {
      key: string;
      name: string | null;
      email: string | null;
      phone: string | null;
      requests: RequestRow[];
    }
  >();

  for (const row of rows) {
    const identity = {
      name: row.recipient_name,
      email: row.recipient_email,
      phone: row.recipient_phone,
    };
    const key = identityKey(identity);
    // A request with no recipient identity at all cannot join a customer book.
    // It is skipped rather than grouped under an empty key, which would pile
    // unrelated people into one fictional customer.
    if (!key) continue;

    if (!groups.has(key)) {
      groups.set(key, { key, name: identity.name, email: identity.email, phone: identity.phone, requests: [] });
    }
    groups.get(key)!.requests.push(row);
  }

  for (const g of groups.values()) {
    g.requests.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }
  return groups;
}

export async function listCustomers(params: {
  actor: ActorMembership;
  businessAccountId: string;
}): Promise<
  CustomersResult<{ customers: CustomerListEntry[]; duplicates: DuplicateWarning[] }>
> {
  const op = "listCustomers";

  const denied = requireCapability(op, params.actor, "customers.read");
  if (denied) return denied;

  // Never `select("*")`: an allow-list is what stops a future column from
  // publishing itself to a merchant screen.
  const requests = await supabaseAdmin
    .from("couranr_delivery_requests")
    .select(
      "id,recipient_name,recipient_phone,recipient_email,dropoff_address,request_state,payer_type,created_at"
    )
    .eq("business_account_id", params.businessAccountId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (requests.error) {
    return fail({ operation: op, code: "internal", detail: { lookup: "couranr_delivery_requests", error: requests.error } });
  }
  if (!Array.isArray(requests.data)) {
    return fail({ operation: op, code: "internal", detail: { reason: "no error and no rows array" } });
  }

  const stored = await supabaseAdmin
    .from("merchant_customers")
    .select("id,display_name,email,phone,normalized_email,normalized_phone,archived_at,payer_preference")
    .eq("business_account_id", params.businessAccountId)
    .order("created_at", { ascending: false });

  if (stored.error) {
    return fail({ operation: op, code: "internal", detail: { lookup: "merchant_customers", error: stored.error } });
  }
  if (!Array.isArray(stored.data)) {
    return fail({ operation: op, code: "internal", detail: { reason: "no error and no rows array" } });
  }

  const groups = groupRequests(requests.data as RequestRow[]);
  const entries = new Map<string, CustomerListEntry>();

  // Stored records first, so a record with no deliveries still appears.
  for (const row of stored.data as any[]) {
    const key =
      identityKey({ name: row.display_name, email: row.email, phone: row.phone }) ??
      `customer:${row.id}`;
    entries.set(key, {
      key,
      customerId: String(row.id),
      displayName: String(row.display_name),
      maskedEmail: maskEmail(row.email),
      maskedPhone: maskPhone(row.phone),
      deliveryCount: 0,
      lastDeliveryAt: null,
      lastPayerType: null,
      archived: Boolean(row.archived_at),
      hasActiveDelivery: false,
      hasConflictingAddress: false,
    });
  }

  for (const g of groups.values()) {
    const existing = entries.get(g.key);
    const addresses = distinctAddresses(g.requests.map((r) => r.dropoff_address));
    const derived = {
      deliveryCount: g.requests.length,
      lastDeliveryAt: g.requests[0]?.created_at ?? null,
      lastPayerType: g.requests[0]?.payer_type ?? null,
      hasActiveDelivery: g.requests.some(
        (r) => !TERMINAL_REQUEST_STATES.includes(r.request_state)
      ),
      hasConflictingAddress: addresses.length > 1,
    };

    if (existing) {
      Object.assign(existing, derived);
    } else {
      entries.set(g.key, {
        key: g.key,
        customerId: null,
        displayName: g.name ?? g.email ?? g.phone ?? "Customer",
        maskedEmail: maskEmail(g.email),
        maskedPhone: maskPhone(g.phone),
        archived: false,
        ...derived,
      });
    }
  }

  const list = [...entries.values()].sort((a, b) => {
    // Most recent activity first; records with no deliveries after them.
    if (a.lastDeliveryAt && b.lastDeliveryAt) {
      return a.lastDeliveryAt < b.lastDeliveryAt ? 1 : -1;
    }
    if (a.lastDeliveryAt) return -1;
    if (b.lastDeliveryAt) return 1;
    return a.displayName.localeCompare(b.displayName);
  });

  const duplicates = findDuplicates(
    [...entries.values()].map((e) => {
      const g = groups.get(e.key);
      const s = (stored.data as any[]).find((row) => String(row.id) === e.customerId);
      return {
        key: e.key,
        identity: {
          name: s?.display_name ?? g?.name ?? null,
          email: s?.email ?? g?.email ?? null,
          phone: s?.phone ?? g?.phone ?? null,
        },
      };
    })
  );

  return { ok: true, value: { customers: list, duplicates } };
}

export type CustomerDetail = {
  key: string;
  customerId: string | null;
  displayName: string;
  /** UNMASKED here: this came from the merchant's own delivery requests. */
  email: string | null;
  phone: string | null;
  notes: string | null;
  payerPreference: string | null;
  archived: boolean;
  version: number | null;
  addresses: { address: any; source: "delivery" | "saved"; label: string | null }[];
  hasConflictingAddress: boolean;
  deliveries: {
    id: string;
    createdAt: string;
    requestState: string;
    payerType: string | null;
  }[];
};

/**
 * One customer, resolved WITHIN the caller's business.
 *
 * A `key` naming someone in another tenant simply finds nothing here, because
 * every query is scoped by `business_account_id` before the key is consulted —
 * so guessing an id cannot reach across businesses; it produces a not-found.
 */
export async function getCustomer(params: {
  actor: ActorMembership;
  businessAccountId: string;
  key: string;
}): Promise<CustomersResult<CustomerDetail>> {
  const op = "getCustomer";

  const denied = requireCapability(op, params.actor, "customers.read");
  if (denied) return denied;

  const requests = await supabaseAdmin
    .from("couranr_delivery_requests")
    .select(
      "id,recipient_name,recipient_phone,recipient_email,dropoff_address,request_state,payer_type,created_at"
    )
    .eq("business_account_id", params.businessAccountId)
    .order("created_at", { ascending: false })
    .limit(500);

  if (requests.error || !Array.isArray(requests.data)) {
    return fail({ operation: op, code: "internal", detail: { lookup: "couranr_delivery_requests" } });
  }

  const stored = await supabaseAdmin
    .from("merchant_customers")
    .select("id,display_name,email,phone,notes,payer_preference,archived_at,version")
    .eq("business_account_id", params.businessAccountId);

  if (stored.error || !Array.isArray(stored.data)) {
    return fail({ operation: op, code: "internal", detail: { lookup: "merchant_customers" } });
  }

  const groups = groupRequests(requests.data as RequestRow[]);
  const group = groups.get(params.key);

  const record = (stored.data as any[]).find((row) => {
    const key =
      identityKey({ name: row.display_name, email: row.email, phone: row.phone }) ??
      `customer:${row.id}`;
    return key === params.key;
  });

  if (!group && !record) {
    return fail({ operation: op, code: "not_found", detail: { key: params.key } });
  }

  const savedAddresses = record
    ? await supabaseAdmin
        .from("customer_addresses")
        .select("address,label,instructions")
        .eq("business_account_id", params.businessAccountId)
        .eq("merchant_customer_id", record.id)
        .is("archived_at", null)
    : { data: [], error: null };

  if (savedAddresses.error) {
    return fail({ operation: op, code: "internal", detail: { lookup: "customer_addresses" } });
  }

  const deliveryAddresses = distinctAddresses((group?.requests ?? []).map((r) => r.dropoff_address));

  return {
    ok: true,
    value: {
      key: params.key,
      customerId: record ? String(record.id) : null,
      displayName: record?.display_name ?? group?.name ?? "Customer",
      email: record?.email ?? group?.email ?? null,
      phone: record?.phone ?? group?.phone ?? null,
      notes: record?.notes ?? null,
      payerPreference: record?.payer_preference ?? null,
      archived: Boolean(record?.archived_at),
      version: record ? Number(record.version) : null,
      addresses: [
        ...(savedAddresses.data ?? []).map((a: any) => ({
          address: a.address,
          source: "saved" as const,
          label: a.label ?? null,
        })),
        ...deliveryAddresses.map((a) => ({
          address: a,
          source: "delivery" as const,
          label: null,
        })),
      ],
      hasConflictingAddress: deliveryAddresses.length > 1,
      deliveries: (group?.requests ?? []).map((r) => ({
        id: String(r.id),
        createdAt: String(r.created_at),
        requestState: String(r.request_state),
        payerType: r.payer_type ?? null,
      })),
    },
  };
}

export async function createCustomer(params: {
  actor: ActorMembership;
  businessAccountId: string;
  displayName: string;
  email: string;
  phone: string;
  payerPreference: string | null;
  notes: string;
}): Promise<CustomersResult<{ customer: Record<string, any> }>> {
  const op = "createCustomer";

  const denied = requireCapability(op, params.actor, "customers.write");
  if (denied) return denied;

  const normalizedEmail = normalizeEmail(params.email);
  const normalizedPhone = normalizePhone(params.phone);
  if (!normalizedEmail && !normalizedPhone) {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { reason: "no_contact" },
      message: "Enter an email address or a phone number for this customer.",
    });
  }
  if (String(params.displayName ?? "").trim() === "") {
    return fail({
      operation: op,
      code: "invalid_input",
      detail: { field: "displayName" },
      message: "Enter a name for this customer.",
    });
  }

  return callRpc<Record<string, any>>(op, "couranr_create_merchant_customer", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_display_name: params.displayName,
    p_email: params.email || null,
    p_phone: params.phone || null,
    p_normalized_email: normalizedEmail,
    p_normalized_phone: normalizedPhone,
    p_payer_preference: params.payerPreference,
    p_notes: params.notes || null,
  }).then((r) => (isCustomersFailure(r) ? r : { ok: true as const, value: { customer: r.value } }));
}

export async function setCustomerArchived(params: {
  actor: ActorMembership;
  businessAccountId: string;
  customerId: string;
  archived: boolean;
}): Promise<CustomersResult<{ customer: Record<string, any> }>> {
  const op = "setCustomerArchived";

  const denied = requireCapability(op, params.actor, "customers.write");
  if (denied) return denied;

  return callRpc<Record<string, any>>(op, "couranr_set_customer_archived", {
    p_business_account_id: params.businessAccountId,
    p_actor_user_id: params.actor.userId,
    p_customer_id: params.customerId,
    p_archived: params.archived,
  }).then((r) => (isCustomersFailure(r) ? r : { ok: true as const, value: { customer: r.value } }));
}
