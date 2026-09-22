import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const doubles = vi.hoisted(() => ({
  publish: vi.fn(),
  revoke: vi.fn(),
}));

vi.mock("@/components/couranr/dispatch/client", () => ({
  assignDeliveryFromBrowser: vi.fn(),
  fetchDispatchPanel: vi.fn(),
  replaceAssignmentFromBrowser: vi.fn(),
  publishDriverPortraitFromBrowser: doubles.publish,
  revokeDriverPortraitFromBrowser: doubles.revoke,
}));

vi.mock("@/components/couranr/payments/DriverTipPaymentElement", () => ({
  DriverTipPaymentElement: ({ amountCents }: { amountCents: number }) =>
    <div>Secure tip form {amountCents}</div>,
}));

import { DriverPortraitPublisher } from "@/components/couranr/dispatch/OperationsAssignmentPanel";
import { DriverFeedbackPanel } from "@/components/couranr/driver/DriverFeedbackPanel";
import TipReturnPage from "@/app/(couranr)/(public)/(token-public)/tip-return/page";
import type { DispatchDriver } from "@/components/couranr/dispatch/client";

const driver = (id: string, name: string, portrait: string | null = null): DispatchDriver => ({
  id,
  display_name: name,
  contact_phone: null,
  driver_state: "available",
  availability_state: "available",
  active: true,
  market: "Washington DC",
  version: 3,
  portrait_url: portrait,
});

beforeEach(() => {
  vi.clearAllMocks();
  doubles.publish.mockResolvedValue({ ok: true, value: { portraitUrl: "/portrait/new" } });
  doubles.revoke.mockResolvedValue({ ok: true, value: { revoked: true } });
});

describe("Operations driver portrait controls", () => {
  it("drops a selected file and consent when Operations changes drivers", async () => {
    const user = userEvent.setup();
    const onPublished = vi.fn(async () => {});
    const a = driver("10000000-0000-4000-8000-000000000001", "Driver A");
    const b = driver("20000000-0000-4000-8000-000000000002", "Driver B");
    const { rerender } = render(
      <DriverPortraitPublisher key={a.id} driver={a} onPublished={onPublished} />,
    );
    await user.upload(screen.getByLabelText(/Driver portrait/), new File(["a"], "a.png", { type: "image/png" }));
    await user.click(screen.getByRole("checkbox"));
    expect(
      (screen.getByRole("button", { name: "Publish approved portrait" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);

    rerender(<DriverPortraitPublisher key={b.id} driver={b} onPublished={onPublished} />);

    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    expect(
      (screen.getByRole("button", { name: "Publish approved portrait" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(doubles.publish).not.toHaveBeenCalled();
  });

  it("lets Operations withdraw current portrait consent through the named route", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onPublished = vi.fn(async () => {});
    const d = driver("30000000-0000-4000-8000-000000000003", "Driver C", "/portrait/current");
    render(<DriverPortraitPublisher key={d.id} driver={d} onPublished={onPublished} />);

    await user.click(screen.getByRole("button", { name: "Remove public portrait" }));
    await waitFor(() => expect(doubles.revoke).toHaveBeenCalledWith({
      driverId: d.id,
      expectedVersion: 3,
    }));
    expect(onPublished).toHaveBeenCalledTimes(1);
    confirm.mockRestore();
  });
});

describe("delivered customer feedback controls", () => {
  it("submits private review and opens the separately priced tip form", async () => {
    const user = userEvent.setup();
    const empty = {
      driverName: "Avery Driver",
      review: null,
      tip: null,
    };
    const request = vi.fn(async (body?: Record<string, unknown>) => {
      if (!body) return { feedback: empty };
      if (body.action === "review") return { feedback: {
        ...empty, review: { rating: body.rating as number, comment: String(body.comment), createdAt: "2026-09-22T12:00:00Z" },
      } };
      if (body.action === "tip") return {
        tip: { clientSecret: "pi_secret", state: "pending", amountCents: body.amountCents as number },
      };
      return { feedback: empty };
    });
    render(<DriverFeedbackPanel request={request} />);
    await screen.findByText("Driver: Avery Driver");

    await user.selectOptions(screen.getByLabelText("Rate your driver"), "4");
    await user.type(screen.getByLabelText("Optional private note"), "Careful handoff");
    await user.click(screen.getByRole("button", { name: "Send review" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith({
      action: "review", rating: 4, comment: "Careful handoff",
    }));

    await user.clear(screen.getByLabelText("Tip amount (USD)"));
    await user.type(screen.getByLabelText("Tip amount (USD)"), "7.25");
    await user.click(screen.getByRole("button", { name: "Continue to tip payment" }));
    expect(await screen.findByText("Secure tip form 725")).toBeTruthy();
    expect(request).toHaveBeenCalledWith({ action: "tip", amountCents: 725 });
  });
});

describe("tip provider return", () => {
  it("refuses an off-origin stored target without exposing a customer capability", async () => {
    window.sessionStorage.setItem("couranr-driver-tip-return-v1",
      "https://attacker.example/track/private-capability");
    render(<TipReturnPage />);
    expect(await screen.findByText(/could not restore your delivery link/i)).toBeTruthy();
    expect(window.sessionStorage.getItem("couranr-driver-tip-return-v1")).toBeNull();
    expect(document.body.textContent).not.toContain("private-capability");
  });
});
