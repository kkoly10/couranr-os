import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * ConsumerAddressField — the direct-consumer /send address input.
 *
 * The public funnel must be at least as careful as the Business autocomplete:
 * debounced, minimum-3, stale-response safe, tracking a selected Place ID that
 * an edit invalidates, and distinguishing a provider/service FAILURE from a
 * genuine no-result and from a rate limit. These drive the real component with
 * a controlled `search` so each of those is asserted directly.
 */

import {
  ConsumerAddressField,
  type ConsumerAddressValue,
} from "@/components/couranr/sameday/ConsumerAddressField";
import type { AddressSearchResult } from "@/lib/couranr/sameday/adapters";

const OK = (n: number): AddressSearchResult => ({
  status: "ok",
  suggestions: Array.from({ length: n }, (_, i) => ({
    id: `pl-${i}`,
    label: `${100 + i} Main Street`,
    detail: "Town, VA",
  })),
});

function Harness({ search }: { search: (q: string) => Promise<AddressSearchResult> }) {
  const [value, setValue] = React.useState<ConsumerAddressValue>({ value: "", placeId: null });
  return (
    <>
      <ConsumerAddressField id="addr" label="Pickup" hint={null} value={value} onChange={setValue} search={search} />
      <output data-testid="placeid">{value.placeId ?? "none"}</output>
      <output data-testid="text">{value.value}</output>
    </>
  );
}

afterEach(cleanup);

describe("ConsumerAddressField", () => {
  it("does not search below 3 characters", async () => {
    const search = vi.fn(async () => OK(1));
    render(<Harness search={search} />);
    await userEvent.type(screen.getByRole("combobox"), "ab");
    await new Promise((r) => setTimeout(r, 400));
    expect(search).not.toHaveBeenCalled();
  });

  it("debounces: many keystrokes yield a single search for the final value", async () => {
    const search = vi.fn(async () => OK(1));
    render(<Harness search={search} />);
    await userEvent.type(screen.getByRole("combobox"), "112 Main");
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith("112 Main");
  });

  it("renders a combobox + listbox and selecting a suggestion sets the canonical Place ID", async () => {
    render(<Harness search={async () => OK(2)} />);
    const input = screen.getByRole("combobox");
    expect(input.getAttribute("aria-autocomplete")).toBe("list");
    await userEvent.type(input, "100 Main");
    const option = await screen.findByRole("option", { name: /100 Main Street/ });
    // The listbox is present and wired to the combobox.
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");
    await userEvent.click(option);
    expect(screen.getByTestId("placeid").textContent).toBe("pl-0");
    expect(screen.getByTestId("text").textContent).toBe("100 Main Street, Town, VA");
  });

  it("editing after a selection invalidates the Place ID", async () => {
    render(<Harness search={async () => OK(1)} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "100 Main");
    await userEvent.click(await screen.findByRole("option", { name: /100 Main Street/ }));
    expect(screen.getByTestId("placeid").textContent).toBe("pl-0");
    // Typing one more character clears the selected identity immediately.
    await userEvent.type(input, "x");
    expect(screen.getByTestId("placeid").textContent).toBe("none");
  });

  it("a stale (slower, earlier) response can never overwrite the newest one", async () => {
    const resolvers: Array<(r: AddressSearchResult) => void> = [];
    const search = vi.fn(
      (q: string) =>
        new Promise<AddressSearchResult>((resolve) => {
          resolvers.push(resolve);
        }),
    );
    render(<Harness search={search} />);
    const input = screen.getByRole("combobox");
    await userEvent.type(input, "100 Main");
    await waitFor(() => expect(resolvers).toHaveLength(1));
    // Force a second query, then a second pending search.
    await userEvent.type(input, " Street");
    await waitFor(() => expect(resolvers).toHaveLength(2));
    // The NEWEST search resolves first with 2 options; the STALE first resolves
    // after with 1 option and must be ignored.
    resolvers[1]({
      status: "ok",
      suggestions: [
        { id: "new-a", label: "New A", detail: "" },
        { id: "new-b", label: "New B", detail: "" },
      ],
    });
    await screen.findByRole("option", { name: "New A" });
    resolvers[0]({ status: "ok", suggestions: [{ id: "stale", label: "Stale", detail: "" }] });
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByRole("option", { name: "Stale" })).toBeNull();
    expect(screen.getByRole("option", { name: "New A" })).toBeTruthy();
  });

  it("distinguishes a genuine empty result from a provider failure and a rate limit", async () => {
    for (const [result, expected] of [
      [{ status: "ok", suggestions: [] } as AddressSearchResult, /No matching street addresses/],
      [{ status: "error" } as AddressSearchResult, /Address lookup is unavailable/],
      [{ status: "rate-limited" } as AddressSearchResult, /Too many address searches/],
    ] as const) {
      const { unmount } = render(<Harness search={async () => result} />);
      await userEvent.type(screen.getByRole("combobox"), "100 Main");
      await screen.findByText(expected);
      unmount();
    }
  });
});
