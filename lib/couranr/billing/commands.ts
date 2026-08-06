import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import {
  BILLING_GAPS,
  chargeRecordState,
  paymentMethodState,
  totalChargedCents,
  type BillingView,
  type ChargeRecord,
} from "@/lib/couranr/billing/records";

assertServerOnly("lib/couranr/billing/commands.ts");

/**
 * MER-016 read layer.
 *
 * READ ONLY. There is no write command in this module and there must not be
 * one: every state a merchant could change from a billing screen is either
 * undecided (`TAX-001`) or belongs to Couranr Operations (`REF-001`). A screen
 * that cannot change anything needs no command surface, and giving it one
 * would be the first step toward a refund button that should not exist.
 *
 * The obligation is the source of truth for money, not the request. A request
 * carries a QUOTE — what a delivery would cost — and a quote is not a charge.
 * Reading the request's `delivery_subtotal_cents` here would show a merchant
 * amounts for deliveries nobody ever authorized.
 */

export type BillingFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type BillingResult<T> = { ok: true; value: T } | BillingFailure;

export function isBillingFailure(r: { ok: boolean }): r is BillingFailure {
  return r.ok === false;
}

function fail(p: { operation: string; code: PublicErrorCode; detail?: unknown }): BillingFailure {
  const correlationId = newCorrelationId();
  logServerFailure({ correlationId, operation: p.operation, code: p.code, detail: p.detail });
  return { ok: false, code: p.code, correlationId };
}

/** How many charge rows the screen LISTS. Announced when it bites. */
const RECORD_PAGE = 100;

/**
 * How many captured rows the TOTAL will scan.
 *
 * Deliberately far above the page size, because the total must not be a
 * property of the page. If a business ever exceeds even this, the view says
 * the total is incomplete rather than reporting a smaller number that looks
 * exactly like a complete one.
 */
const TOTAL_SCAN_CAP = 5000;

/**
 * Every charge Couranr has raised against this business.
 *
 * Tenant scoping is the `business_account_id` FILTER, not a policy: this runs
 * as `service_role`, which has `rolbypassrls = true` on this project, so RLS
 * constrains nothing here. The filter IS the boundary. The caller's right to
 * this business is established before we are called, by the route.
 */
export async function listBillingRecords(params: {
  businessAccountId: string;
}): Promise<BillingResult<BillingView>> {
  const op = "listBillingRecords";

  const { data, error, count } = await supabaseAdmin
    .from("couranr_payment_obligations")
    .select(
      "id,request_id,amount_cents,captured_amount_cents,currency,payment_state,payer_type," +
        "created_at,authorized_at,captured_at,failed_at,cancelled_at",
      { count: "exact" }
    )
    .eq("business_account_id", params.businessAccountId)
    .order("created_at", { ascending: false })
    .limit(RECORD_PAGE);

  if (error || !Array.isArray(data)) {
    // Fail closed. An empty list would read as "you have never been charged",
    // which on a billing screen is a specific and alarming falsehood.
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_payment_obligations", error },
    });
  }

  // Recipient names come from the requests, in ONE query rather than per row.
  const requestIds = Array.from(new Set(data.map((r: any) => String(r.request_id))));
  const names: Record<string, string | null> = {};
  if (requestIds.length > 0) {
    const reqs = await supabaseAdmin
      .from("couranr_delivery_requests")
      .select("id,recipient_name,business_account_id")
      .eq("business_account_id", params.businessAccountId)
      .in("id", requestIds);

    if (reqs.error || !Array.isArray(reqs.data)) {
      return fail({
        operation: op,
        code: "internal",
        detail: { lookup: "couranr_delivery_requests" },
      });
    }
    for (const r of reqs.data as any[]) {
      names[String(r.id)] = r.recipient_name ?? null;
    }
  }

  const records: ChargeRecord[] = data.map((row: any) => {
    const state = chargeRecordState(row.payment_state);
    return {
      obligationId: String(row.id),
      requestId: String(row.request_id),
      amountCents: Number(row.amount_cents),
      capturedAmountCents:
        row.captured_amount_cents === null || row.captured_amount_cents === undefined
          ? null
          : Number(row.captured_amount_cents),
      currency: String(row.currency ?? "usd"),
      state,
      payerType: String(row.payer_type),
      // A request that is not this business's is not in `names`, so its
      // recipient stays null rather than leaking across a tenant.
      recipientName: names[String(row.request_id)] ?? null,
      createdAt: String(row.created_at),
      settledAt:
        row.captured_at ?? row.cancelled_at ?? row.failed_at ?? row.authorized_at ?? null,
    };
  });

  /*
   * THE TOTAL IS ITS OWN QUERY, over every captured obligation.
   *
   * It must never be computed from `records` above: that is one PAGE, and a
   * merchant past `RECORD_PAGE` deliveries would be shown a total that
   * silently understated what they had paid. Only captured rows are fetched,
   * and `totalChargedCents` re-checks the state anyway — the filter lives in
   * both places on purpose, so changing the query alone cannot start counting
   * authorizations as money taken.
   */
  const totals = await supabaseAdmin
    .from("couranr_payment_obligations")
    .select("payment_state,amount_cents,captured_amount_cents", { count: "exact" })
    .eq("business_account_id", params.businessAccountId)
    .eq("payment_state", "captured")
    .limit(TOTAL_SCAN_CAP);

  if (totals.error || !Array.isArray(totals.data)) {
    // Fail closed rather than fall back to the page's sum. A wrong total is
    // worse than no page at all.
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_payment_obligations totals", error: totals.error },
    });
  }

  const capturedCount = totals.count ?? totals.data.length;

  /*
   * Failed authorizations, counted over EVERY row. `head: true` fetches no
   * rows at all — only the count — because the screen needs to know THAT one
   * failed, not which. Same reason as the total, and a sharper one: a failed
   * authorization stops a delivery being dispatched, so a merchant whose
   * failure fell off the page would never be told what is blocking them.
   */
  const failed = await supabaseAdmin
    .from("couranr_payment_obligations")
    .select("id", { count: "exact", head: true })
    .eq("business_account_id", params.businessAccountId)
    .eq("payment_state", "failed");

  if (failed.error) {
    return fail({
      operation: op,
      code: "internal",
      detail: { lookup: "couranr_payment_obligations failed count", error: failed.error },
    });
  }

  return {
    ok: true,
    value: {
      businessAccountId: params.businessAccountId,
      paymentMethod: paymentMethodState(),
      records,
      totalChargedCents: totalChargedCents(
        (totals.data as any[]).map((row) => ({
          state: chargeRecordState(row.payment_state),
          amountCents: Number(row.amount_cents),
          capturedAmountCents:
            row.captured_amount_cents === null || row.captured_amount_cents === undefined
              ? null
              : Number(row.captured_amount_cents),
        }))
      ),
      recordCount: count ?? records.length,
      failedCount: failed.count ?? 0,
      totalIsComplete: capturedCount <= TOTAL_SCAN_CAP,
      gaps: BILLING_GAPS,
    },
  };
}
