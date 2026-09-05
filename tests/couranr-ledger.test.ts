import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");
const migration = readFileSync(
  path.join(ROOT, "supabase/migrations/20260905170000_couranr_financial_ledger_v1.sql"),
  "utf8",
);
const rollback = readFileSync(
  path.join(ROOT, "supabase/rollbacks/20260905170000_couranr_financial_ledger_v1.rollback.sql"),
  "utf8",
);

describe("P6-004 immutable balanced ledger", () => {
  it("keeps financial evidence in the private schema with no client grants", () => {
    for (const table of [
      "private.couranr_ledger_accounts",
      "private.couranr_ledger_transactions",
      "private.couranr_ledger_entries",
    ]) {
      expect(migration).toContain(`create table if not exists ${table}`);
      expect(migration).toContain(`revoke all on ${table} from public, anon, authenticated, service_role`);
    }
    expect(migration).not.toMatch(/grant\s+(insert|update|delete)[^;]*couranr_ledger_/i);
    expect(migration).toContain(
      "grant execute on function public.couranr_get_ledger_reconciliation()\n  to service_role",
    );
  });

  it("defines the minimum governed account set without inventing a tip flow", () => {
    for (const account of [
      "stripe_clearing",
      "accounts_receivable",
      "delivery_revenue",
      "overnight_revenue",
      "waiting_revenue",
      "return_revenue",
      "tips_payable",
      "toll_parking_reimbursement",
      "processing_expense",
      "promotional_credit_expense",
      "refund_expense",
      "dispute_expense",
      "tax_liability",
    ]) {
      expect(migration).toContain(`('${account}'`);
    }
    // The account exists because §10 requires the chart-of-accounts slot.
    // No current product authority creates gratuities, so this migration must
    // not fabricate a tip amount or a tip posting.
    expect(migration).not.toContain("'tip'");
    expect(migration).not.toContain("tip_cents");
  });

  it("posts revenue on capture, not authorization, and posts refunds separately", () => {
    expect(migration).toContain("couranr_ledger_capture_trg");
    expect(migration).toContain("after update of captured_amount_cents");
    expect(migration).toContain("'stripe_clearing','side','debit'");
    expect(migration).toContain("'delivery_revenue','side','credit'");
    expect(migration).toContain("'promotional_credit_expense','side','debit'");

    expect(migration).toContain("couranr_ledger_refund_trg");
    expect(migration).toContain("new.attempt_state <> 'succeeded'");
    expect(migration).toContain("'refund_expense','side','debit'");
    expect(migration).toContain("'stripe_clearing','side','credit'");

    expect(migration).not.toMatch(/trigger[^;]+authorized_at/is);
    expect(migration).not.toMatch(/source_kind[^;]+authorization/is);
  });

  it("requires every posting to balance before any entry is inserted", () => {
    expect(migration).toContain("ledger_transaction_unbalanced");
    expect(migration).toContain("v_debits <> v_credits");
    expect(migration).toContain("ledger_source_conflict");
    expect(migration).toContain("unique(source_kind,source_id)");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("hashtextextended(p_source_kind || ':' || p_source_id, 0)");
  });

  it("records governed cancellation receivables without pretending they were collected", () => {
    expect(migration).toContain("couranr.cancellation.receivable");
    expect(migration).toContain("'accounts_receivable','side','debit'");
    expect(migration).toContain("'collected',false");
    expect(migration).not.toContain("couranr.cancellation.no_charge','cancellation_receivable");
  });

  it("reconciles canonical source money to the ledger without a provider call", () => {
    expect(migration).toContain("couranr_get_ledger_reconciliation");
    expect(migration).toContain("expectedStripeClearingCents");
    expect(migration).toContain("missingCaptures");
    expect(migration).toContain("missingRefunds");
    expect(migration).toContain("missingReceivables");
    expect(migration).toContain("unbalancedTransactions");
    // Recent activity must show the external movement, not the sum of every
    // debit leg (which would overstate a discounted capture by its credit).
    expect(migration).toContain("t.source_kind='capture'");
    expect(migration).toContain("e.account_code='stripe_clearing' and e.side='debit'");
    expect(migration).not.toContain("stripe.com");
    expect(migration).not.toContain("PaymentIntent");
  });

  it("does not put forbidden PII/secrets into the ledger schema", () => {
    const tableBlock = migration.slice(
      migration.indexOf("create table if not exists private.couranr_ledger_transactions"),
      migration.indexOf("create index if not exists couranr_ledger_transactions_request_idx"),
    );
    for (const forbidden of [
      "address",
      "phone",
      "email",
      "message_body",
      "proof_url",
      "token",
      "card",
      "recipient",
    ]) {
      expect(tableBlock.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("refuses rollback once financial evidence exists", () => {
    expect(rollback).toContain("ledger_rollback_would_destroy_financial_evidence");
    expect(rollback).toContain("select count(*) from private.couranr_ledger_transactions");
    expect(rollback.indexOf("ledger_rollback_would_destroy_financial_evidence"))
      .toBeLessThan(rollback.indexOf("drop table if exists private.couranr_ledger_entries"));
  });
});
