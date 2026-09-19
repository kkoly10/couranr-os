import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const MIGRATION = readFileSync(
  path.join(
    ROOT,
    "supabase/migrations/20260919232500_consumer_operations_review_null_tenant.sql"
  ),
  "utf8"
);
const ROLLBACK = readFileSync(
  path.join(
    ROOT,
    "supabase/rollbacks/20260919232500_consumer_operations_review_null_tenant.rollback.sql"
  ),
  "utf8"
);

describe("Consumer Operations review tenant parity", () => {
  it("hardens the two Operations review functions that still used nullable = equality", () => {
    expect(MIGRATION).toContain(
      "couranr_begin_delivery_request_review(uuid,uuid,integer,uuid)"
    );
    expect(MIGRATION).toContain(
      "couranr_decline_delivery_request(uuid,uuid,integer,uuid,text,text)"
    );
    expect(MIGRATION).toContain(
      "business_account_id is not distinct from p_business_account_id"
    );
  });

  it("preserves signatures and mutates no delivery data", () => {
    expect(MIGRATION).not.toMatch(/drop\s+(table|column|function)/i);
    expect(MIGRATION).not.toMatch(/delete\s+from/i);
    expect(MIGRATION).not.toMatch(/truncate/i);
    expect(MIGRATION).toContain("pg_get_functiondef");
  });

  it("has a paired rollback to the exact legacy predicate", () => {
    expect(ROLLBACK).toContain(
      "business_account_id is not distinct from p_business_account_id"
    );
    expect(ROLLBACK).toContain(
      "business_account_id = p_business_account_id"
    );
    expect(ROLLBACK).not.toMatch(/delete\s+from/i);
    expect(ROLLBACK).not.toMatch(/truncate/i);
  });
});
