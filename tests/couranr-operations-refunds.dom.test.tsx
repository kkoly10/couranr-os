import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * OPS-011 — the real Operations refund screen, driven.
 *
 * A jsdom test asserts what a component returns; this one exists for the
 * defects that a green typecheck and a green SQL suite both miss, and that
 * this repository has actually shipped before:
 *
 *   * reading a route's payload FLAT instead of under its named key. That was
 *     invisible to `tsc` (the routes return untyped JSON) and silent at
 *     runtime, and it left proof upload dead for its entire life.
 *   * a failed read rendering as "nothing to review" rather than as a failure.
 *     On a refund queue that reads as "no one is waiting for their money".
 *   * the number that leaves the browser not being the number on the screen.
 *     Money is typed in dollars and must travel as INTEGER CENTS.
 */

const { call } = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("@/components/couranr/requests/client", () => ({
  call,
  isApiFailure: (r: any) => r?.ok === false,
  withReference: (f: any) =>
    f?.correlationId ? `${f.error} Reference ${f.correlationId}.` : f?.error,
}));

import { RefundsWorkspace } from "@/components/couranr/operations/refunds/RefundsWorkspace";

const RR_ID = "9130c8fc-dae2-4510-a401-48abae0d2dde";
const REQ_ID = "22222222-2222-4222-8222-222222222222";

function row(over: Record<string, any> = {}) {
  return {
    id: RR_ID,
    requestId: REQ_ID,
    reference: "CR-ABCD-1234",
    obligationId: "11111111-1111-4111-8111-111111111111",
    incidentId: null,
    problemReportId: null,
    requestedBy: "customer",
    reasonCode: "service_not_performed",
    detail: "The delivery never arrived.",
    state: "pending",
    refundableBaseCents: null,
    approvedAmountCents: null,
    denialReason: null,
    decidedAt: null,
    version: 1,
    createdAt: "2026-09-17T00:00:00Z",
    capturedAmountCents: 2299,
    refundedAmountCents: 0,
    remainingRefundableCents: 2299,
    attempt: null,
    ...over,
  };
}

beforeEach(() => {
  call.mockReset();
});

describe("the refund queue reads its payload correctly", () => {
  it("reads the rows under the named key and shows the delivery-charge figures", async () => {
    call.mockResolvedValueOnce({ ok: true, value: { refundRequests: [row()] } });

    render(<RefundsWorkspace />);

    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    expect(call.mock.calls[0][0]).toBe("/api/couranr/operations/refunds");

    await screen.findByText(/CR-ABCD-1234/);
    // $22.99 appears twice by design: captured, and refundable now.
    expect(screen.getAllByText("$22.99").length).toBe(2);
    expect(screen.getByText(/never arrived/)).toBeTruthy();
  });

  it("does not render a FLAT payload as a queue", async () => {
    // The exact shape of the bug: `{ refundRequests: [...] }` typed flat.
    call.mockResolvedValueOnce({ ok: true, value: [row()] });

    render(<RefundsWorkspace />);

    await screen.findByText(/No refund requests/i);
    expect(screen.queryByText(/CR-ABCD-1234/)).toBeNull();
  });

  it("a FAILED read is a failure, never an empty queue", async () => {
    call.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: "Something went wrong.",
      correlationId: "cr_abcdefghjkmn",
    });

    render(<RefundsWorkspace />);

    await screen.findByText(/could not load the refund queue/i);
    // The load-bearing negative: it must NOT say there is nothing to review.
    expect(screen.queryByText(/No refund requests/i)).toBeNull();
    expect(screen.getByText(/cr_abcdefghjkmn/)).toBeTruthy();
  });

  it("says so plainly when there is genuinely nothing to review", async () => {
    call.mockResolvedValueOnce({ ok: true, value: { refundRequests: [] } });

    render(<RefundsWorkspace />);

    await screen.findByText(/No refund requests/i);
    expect(screen.queryByText(/could not load/i)).toBeNull();
  });
});

describe("approving sends integer cents, and never more than is refundable", () => {
  it("the full-refund control sends exactly what remains refundable, in cents", async () => {
    call
      .mockResolvedValueOnce({ ok: true, value: { refundRequests: [row()] } })
      .mockResolvedValueOnce({
        ok: true,
        value: { refundRequest: row({ state: "refunded", approvedAmountCents: 2299, refundableBaseCents: 2299 }) },
      });

    render(<RefundsWorkspace />);
    const full = await screen.findByRole("button", { name: /Approve full \$22\.99/i });
    await userEvent.click(full);

    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    const [path, init] = call.mock.calls[1];
    expect(path).toBe(`/api/couranr/operations/refunds/${RR_ID}/approve`);
    expect(init.method).toBe("POST");
    // INTEGER CENTS, and the version being decided on.
    expect(init.body).toEqual({ expectedVersion: 1, approvedCents: 2299 });
    // The body is a plain object — `call` encodes it exactly once.
    expect(typeof init.body).toBe("object");
  });

  it("a partial figure typed in DOLLARS leaves as integer CENTS", async () => {
    call
      .mockResolvedValueOnce({ ok: true, value: { refundRequests: [row()] } })
      .mockResolvedValueOnce({
        ok: true,
        value: { refundRequest: row({ state: "partially_refunded", approvedAmountCents: 705, refundableBaseCents: 2299 }) },
      });

    render(<RefundsWorkspace />);
    const box = await screen.findByLabelText(/Refund this much/i);
    await userEvent.type(box, "7.05");

    await userEvent.click(screen.getByRole("button", { name: /Approve partial refund/i }));

    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(call.mock.calls[1][1].body).toEqual({ expectedVersion: 1, approvedCents: 705 });
  });

  it("an OVER-CEILING figure is refused at the screen and never sent", async () => {
    call.mockResolvedValueOnce({ ok: true, value: { refundRequests: [row()] } });

    render(<RefundsWorkspace />);
    const box = await screen.findByLabelText(/Refund this much/i);
    await userEvent.type(box, "23.00"); // one cent over $22.99

    const partial = screen.getByRole("button", { name: /Approve partial refund/i });
    await waitFor(() => expect((partial as HTMLButtonElement).disabled).toBe(true));
    await userEvent.click(partial);

    // Still only the initial load. Nothing was sent.
    expect(call).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/more than the \$22\.99 still refundable/i)).toBeTruthy();
  });

  it("a partial that is already refunded lowers the ceiling the screen offers", async () => {
    call.mockResolvedValueOnce({
      ok: true,
      value: {
        refundRequests: [row({ refundedAmountCents: 1000, remainingRefundableCents: 1299 })],
      },
    });

    render(<RefundsWorkspace />);
    await screen.findByRole("button", { name: /Approve full \$12\.99/i });
    expect(screen.queryByRole("button", { name: /Approve full \$22\.99/i })).toBeNull();
  });

  it("a decided request offers no decision control at all", async () => {
    call.mockResolvedValueOnce({
      ok: true,
      value: {
        refundRequests: [
          row({ state: "refunded", approvedAmountCents: 2299, refundableBaseCents: 2299 }),
        ],
      },
    });

    render(<RefundsWorkspace />);
    await screen.findByText(/CR-ABCD-1234/);
    expect(screen.queryByRole("button", { name: /Approve/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Deny/i })).toBeNull();
  });
});

describe("denying is a recorded decision", () => {
  it("refuses to send an empty reason", async () => {
    call.mockResolvedValueOnce({ ok: true, value: { refundRequests: [row()] } });

    render(<RefundsWorkspace />);
    const deny = await screen.findByRole("button", { name: /Deny refund/i });
    await userEvent.click(deny);

    expect(call).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Say why this delivery-charge refund is being denied/i)).toBeTruthy();
  });

  it("sends the written reason and the version", async () => {
    call
      .mockResolvedValueOnce({ ok: true, value: { refundRequests: [row()] } })
      .mockResolvedValueOnce({
        ok: true,
        value: { refundRequest: row({ state: "denied", denialReason: "Proven delivered." }) },
      });

    render(<RefundsWorkspace />);
    const box = await screen.findByLabelText(/Reason for denying/i);
    await userEvent.type(box, "Proven delivered.");
    await userEvent.click(screen.getByRole("button", { name: /Deny refund/i }));

    await waitFor(() => expect(call).toHaveBeenCalledTimes(2));
    expect(call.mock.calls[1][0]).toBe(`/api/couranr/operations/refunds/${RR_ID}/deny`);
    expect(call.mock.calls[1][1].body).toEqual({
      expectedVersion: 1,
      denialReason: "Proven delivered.",
    });
  });

  it("shows a failed decision with its reference rather than silently doing nothing", async () => {
    call
      .mockResolvedValueOnce({ ok: true, value: { refundRequests: [row()] } })
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        error: "That refund was already decided.",
        correlationId: "cr_zzz111222333",
      });

    render(<RefundsWorkspace />);
    await userEvent.click(await screen.findByRole("button", { name: /Approve full/i }));

    await screen.findByText(/already decided/i);
    expect(screen.getByText(/cr_zzz111222333/)).toBeTruthy();
  });
});

describe("the registry scope is visible on the screen", () => {
  it("says Couranr refunds the delivery charge and the merchant controls the product", async () => {
    call.mockResolvedValueOnce({ ok: true, value: { refundRequests: [] } });

    render(<RefundsWorkspace />);
    await screen.findByText(/merchant controls any refund of the product/i);
  });

  it("offers no control that would refund merchandise, and promises no delivery time", async () => {
    call.mockResolvedValueOnce({ ok: true, value: { refundRequests: [row()] } });

    render(<RefundsWorkspace />);
    await screen.findByText(/CR-ABCD-1234/);

    const labels = screen.getAllByRole("button").map((b) => (b.textContent ?? "").toLowerCase());
    for (const label of labels) {
      expect(/product|merchandise|item price|goods/.test(label), label).toBe(false);
    }
    // TRM-001 never_claim: nothing rendered may promise a delivery time.
    expect(document.body.textContent ?? "").not.toMatch(/guarantee/i);
    expect(document.body.textContent ?? "").not.toMatch(/on-?time/i);
  });

  it("a failed refund says the money did NOT go back", async () => {
    call.mockResolvedValueOnce({
      ok: true,
      value: {
        refundRequests: [
          row({
            state: "failed",
            approvedAmountCents: 2299,
            refundableBaseCents: 2299,
            attempt: { state: "failed", amountCents: 2299, retainedCents: 0, providerSettled: false },
          }),
        ],
      },
    });

    render(<RefundsWorkspace />);
    expect((await screen.findAllByText(/did not complete/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/has not been returned/i)).toBeTruthy();
  });
});
