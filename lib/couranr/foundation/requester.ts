/** Strict-null requester identity for the canonical delivery foundation. */
export type RequesterIdentity =
  | {
      kind: "business";
      businessAccountId: string;
    }
  | {
      kind: "consumer";
      businessAccountId: null;
    };

/**
 * Convert the nullable database shape into a discriminated identity. A broken
 * database invariant is surfaced immediately instead of becoming the string
 * "null" and leaking into tenancy checks.
 */
export function requesterIdentityFromRow(row: Record<string, unknown>): RequesterIdentity {
  // Rows selected by pre-Gate-A compatibility queries have no requester_kind;
  // their non-null business account deterministically identifies the backfilled
  // business shape. Unknown explicit values still fail closed.
  const kind = row.requester_kind ??
    (typeof row.business_account_id === "string" ? "business" : undefined);

  if (kind === "consumer") {
    if (row.business_account_id !== null) {
      throw new Error("consumer_requester_has_business_account");
    }
    return { kind: "consumer", businessAccountId: null };
  }

  if (
    kind !== "business" ||
    typeof row.business_account_id !== "string" ||
    row.business_account_id.trim() === ""
  ) {
    throw new Error("business_requester_missing_business_account");
  }
  return { kind: "business", businessAccountId: row.business_account_id };
}
