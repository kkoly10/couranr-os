"use client";

import { call, type ApiResult } from "@/components/couranr/requests/client";

/** Browser data access for MER-008 and MER-009. */

export type CustomerListEntry = {
  key: string;
  customerId: string | null;
  displayName: string;
  maskedEmail: string | null;
  maskedPhone: string | null;
  deliveryCount: number;
  lastDeliveryAt: string | null;
  lastPayerType: string | null;
  archived: boolean;
  hasActiveDelivery: boolean;
  hasConflictingAddress: boolean;
};

export type DuplicateWarning = {
  keys: string[];
  strength: "strong" | "weak";
  reason: string;
};

export type CustomerDetail = {
  key: string;
  customerId: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  payerPreference: string | null;
  archived: boolean;
  version: number | null;
  addresses: { address: any; source: "delivery" | "saved"; label: string | null }[];
  hasConflictingAddress: boolean;
  deliveries: { id: string; createdAt: string; requestState: string; payerType: string | null }[];
};

const tenant = (id: string) => `businessAccountId=${encodeURIComponent(id)}`;

export function fetchCustomers(
  businessAccountId: string
): Promise<ApiResult<{ customers: CustomerListEntry[]; duplicates: DuplicateWarning[] }>> {
  return call(`/api/couranr/merchant/customers?${tenant(businessAccountId)}`);
}

export function fetchCustomer(
  businessAccountId: string,
  key: string
): Promise<ApiResult<CustomerDetail>> {
  return call(
    `/api/couranr/merchant/customers?${tenant(businessAccountId)}&customer=${encodeURIComponent(key)}`
  );
}

export function createCustomer(input: {
  businessAccountId: string;
  displayName: string;
  email: string;
  phone: string;
  notes: string;
}): Promise<ApiResult<{ customer: any }>> {
  const { businessAccountId, ...rest } = input;
  return call(`/api/couranr/merchant/customers?${tenant(businessAccountId)}`, {
    method: "POST",
    body: { action: "create", ...rest },
  });
}

/** Names the ACTION; the command stamps or clears the timestamp itself. */
export function archiveCustomer(input: {
  businessAccountId: string;
  customerId: string;
  action: "archive" | "restore";
}): Promise<ApiResult<{ customer: any }>> {
  return call(`/api/couranr/merchant/customers?${tenant(input.businessAccountId)}`, {
    method: "POST",
    body: { action: input.action, customerId: input.customerId },
  });
}
