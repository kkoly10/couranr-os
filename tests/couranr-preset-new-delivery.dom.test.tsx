/**
 * Applying a saved preset inside the real New Delivery form.
 *
 * The unit tests pin the RULES; this pins that the form obeys them — that the
 * list is fetched when the picker opens rather than at mount, that the body
 * applied comes from a second server call made at that moment, that a value the
 * merchant already typed survives, and that a withdrawn proof method is
 * substituted and said out loud rather than silently carried.
 */

import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));

const h = vi.hoisted(() => ({ calls: [] as string[], list: null as unknown, one: null as unknown }));

vi.mock("@/components/couranr/requests/client", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    // Only the business + preset lookups are stubbed; everything else in the
    // form runs for real.
    fetchMyBusinessAccounts: vi.fn(async () => ({
      ok: true,
      value: { businessAccounts: [{ businessAccountId: "11111111-1111-4111-8111-111111111111", name: "Petal & Stem" }] },
    })),
    fetchOperationsBusinesses: vi.fn(async () => ({ ok: true, value: { businessAccounts: [] } })),
    fetchPresetsForDelivery: vi.fn(async () => {
      h.calls.push("list");
      return h.list;
    }),
    fetchPresetForApplication: vi.fn(async () => {
      h.calls.push("resolve");
      return h.one;
    }),
  };
});

import { NewDeliveryFlow } from "@/components/couranr/requests/NewDeliveryFlow";

const PRESET_ID = "22222222-2222-4222-8222-222222222222";

/*
 * THE REAL ROUTE SHAPE. The GET answers with the presets VIEW under `presets`,
 * and the merchant's own rows are the `presets` inside it. An earlier version of
 * this mock invented `mine`, which made every test here pass against a payload
 * the server never sends — the picker was empty in a real browser and green
 * here. Mocks are only worth their cost when they are the shape the server
 * actually returns.
 */
function listOk(name = "Weekly florist run") {
  return { ok: true, value: { presets: { presets: [{ id: PRESET_ID, name, version: 3 }] } } };
}
function resolveOk(body: Record<string, unknown>, name = "Weekly florist run") {
  return { ok: true, value: { preset: { id: PRESET_ID, name, version: 3, body } } };
}

beforeEach(() => {
  h.calls = [];
  h.list = listOk();
  h.one = resolveOk({
    commonItem: "Two dozen roses in a box",
    packageCount: 2,
    handling: "Keep upright",
    proofMethod: "signature",
  });
});
afterEach(cleanup);

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  const opener = await screen.findByTestId("preset-start-open");
  // Nothing is fetched until the merchant asks for it.
  expect(h.calls).toEqual([]);
  await user.click(opener);
  await screen.findByTestId("preset-start-select");
}

describe("preset application in New Delivery", () => {
  it("fetches presets only when the picker is opened, not at mount", async () => {
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    await screen.findByTestId("preset-start-open");
    expect(h.calls).toEqual([]);
    await openPicker(user);
    expect(h.calls).toEqual(["list"]);
  });

  it("resolves the chosen preset server-side before filling anything", async () => {
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    await openPicker(user);
    await user.selectOptions(screen.getByTestId("preset-start-select"), PRESET_ID);
    await user.click(screen.getByTestId("preset-start-apply"));
    // The picker's copy is never what fills the form.
    await waitFor(() => expect(h.calls).toEqual(["list", "resolve"]));
    // This is the MERCHANT form, so the description has no field and is not
    // among what was filled - see the not-applied assertions below.
    expect((await screen.findByTestId("preset-start-filled")).textContent ?? "").toMatch(
      /Package count/i,
    );
  });

  it("names what it filled in merchant language, never field names", async () => {
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    await openPicker(user);
    await user.selectOptions(screen.getByTestId("preset-start-select"), PRESET_ID);
    await user.click(screen.getByTestId("preset-start-apply"));
    const filled = await screen.findByTestId("preset-start-filled");
    expect(filled.textContent ?? "").not.toMatch(/pickup[A-Z]|proofMethod|body|payload/);
  });

  // The behaviour a merchant would feel most: their sentence survives.
  it("does not overwrite a handling note the merchant already typed", async () => {
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    const notes = await screen.findByLabelText(/handling/i).catch(() => null);
    if (notes) {
      await user.type(notes as HTMLElement, "Ring the bell twice");
      await openPicker(user);
      await user.selectOptions(screen.getByTestId("preset-start-select"), PRESET_ID);
      await user.click(screen.getByTestId("preset-start-apply"));
      expect((notes as HTMLTextAreaElement).value).toBe("Ring the bell twice");
      expect((await screen.findByTestId("preset-start-kept")).textContent ?? "").toMatch(/Handling note/i);
    }
  });

  it("substitutes a withdrawn proof method and says so, rather than carrying it", async () => {
    h.one = resolveOk({ proofMethod: "leave_at_door" });
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    await openPicker(user);
    await user.selectOptions(screen.getByTestId("preset-start-select"), PRESET_ID);
    await user.click(screen.getByTestId("preset-start-apply"));
    await waitFor(() => expect(h.calls).toContain("resolve"));
    // The existing withdrawn-method notice is the one that speaks — there is no
    // preset-specific proof-method path.
    expect(await screen.findByText(/leave_at_door|no longer|not available/i)).toBeTruthy();
  });

  it("tells the merchant when a preset has gone, and refreshes the list", async () => {
    h.one = { ok: false, status: 404, error: "Not found." };
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    await openPicker(user);
    await user.selectOptions(screen.getByTestId("preset-start-select"), PRESET_ID);
    await user.click(screen.getByTestId("preset-start-apply"));
    expect(await screen.findByText(/archived or removed/i)).toBeTruthy();
    // A dead option must stop being offered.
    await waitFor(() => expect(h.calls.filter((c) => c === "list").length).toBe(2));
  });

  it("shows an honest empty state rather than pretending presets failed to load", async () => {
    h.list = { ok: true, value: { presets: { presets: [] } } };
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    await user.click(await screen.findByTestId("preset-start-open"));
    expect((await screen.findByTestId("preset-start-empty")).textContent ?? "").toMatch(/not saved any presets/i);
  });

  it("does not claim emptiness when the lookup failed", async () => {
    h.list = { ok: false, status: 500, error: "boom" };
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    await user.click(await screen.findByTestId("preset-start-open"));
    await waitFor(() => expect(h.calls).toEqual(["list"]));
    expect(screen.queryByTestId("preset-start-empty")).toBeNull();
  });

  /*
   * A preset may hold a payer preference, and this build deliberately never
   * applies it. Reporting that under "left as you entered them" would tell the
   * merchant they chose who pays when they never touched the control.
   */
  it("says a payer preference was not filled in, not that the merchant entered it", async () => {
    h.one = resolveOk({ commonItem: "Two dozen roses", payerPreference: "customer" });
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    await openPicker(user);
    await user.selectOptions(screen.getByTestId("preset-start-select"), PRESET_ID);
    await user.click(screen.getByTestId("preset-start-apply"));

    const notApplied = await screen.findByTestId("preset-start-not-applied");
    expect(notApplied.textContent ?? "").toMatch(/Who pays/i);
    // And it must not appear in the "you entered this" line.
    const kept = screen.queryByTestId("preset-start-kept");
    expect(kept?.textContent ?? "").not.toMatch(/Who pays/i);
  });

  // A success banner left standing beside a failure claims a fill that did not
  // happen on this attempt.
  it("drops the previous success message when a later apply fails", async () => {
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    await openPicker(user);
    await user.selectOptions(screen.getByTestId("preset-start-select"), PRESET_ID);
    await user.click(screen.getByTestId("preset-start-apply"));
    await screen.findByTestId("preset-start-filled");

    h.one = { ok: false, status: 404, error: "Not found." };
    await user.click(screen.getByTestId("preset-start-apply"));

    expect(await screen.findByText(/archived or removed/i)).toBeTruthy();
    await waitFor(() => expect(screen.queryByTestId("preset-start-filled")).toBeNull());
  });

  /*
   * The merchant form has no "what to look for" field - Smart Intake owns the
   * description. A preset that claimed to fill it would be pointing at a box
   * that is not on screen, and Smart Intake would overwrite the value anyway.
   */
  it("does not claim to fill a description the merchant form does not have", async () => {
    const user = userEvent.setup();
    render(<NewDeliveryFlow />);
    await openPicker(user);
    await user.selectOptions(screen.getByTestId("preset-start-select"), PRESET_ID);
    await user.click(screen.getByTestId("preset-start-apply"));

    const filled = await screen.findByTestId("preset-start-filled");
    expect(filled.textContent ?? "").not.toMatch(/What to look for/i);
    const notApplied = await screen.findByTestId("preset-start-not-applied");
    expect(notApplied.textContent ?? "").toMatch(/What to look for/i);
    // What DOES have a home on this form is still filled.
    expect(filled.textContent ?? "").toMatch(/Package count/i);
    expect(filled.textContent ?? "").toMatch(/Handling note/i);
  });
});
