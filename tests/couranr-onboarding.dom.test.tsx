import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "@/components/couranr/requests/client";

/**
 * Fail-closed behaviour for MER-002.
 *
 * The defect: every `ApiFailure` from the account lookup collapsed to an empty
 * list, so a transient 500 or an offline browser rendered the onboarding form
 * and invited an established merchant to create a SECOND workspace. Account
 * existence being UNKNOWN is not the same as there being NONE, and only one of
 * those may offer workspace creation.
 */

const fetchMyBusinessAccounts = vi.fn();
const createWorkspace = vi.fn();
const push = vi.fn();
const refresh = vi.fn();

vi.mock("@/components/couranr/onboarding/client", () => ({
  fetchMyBusinessAccounts: () => fetchMyBusinessAccounts(),
  createWorkspace: (input: unknown) => createWorkspace(input),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh, replace: vi.fn() }),
  usePathname: () => "/app/business/onboarding",
}));

const { OnboardingForm } = await import("@/components/couranr/onboarding/OnboardingForm");

type Accounts = { businessAccounts: Array<{ businessAccountId: string; name: string; role: string }> };

const ok = (names: string[]): ApiResult<Accounts> => ({
  ok: true,
  value: {
    businessAccounts: names.map((name, i) => ({
      businessAccountId: `id-${i}`,
      name,
      role: "owner",
    })),
  },
});

const fail = (status: number, extra: Record<string, unknown> = {}): ApiResult<Accounts> => ({
  ok: false,
  status,
  error: "Something went wrong.",
  ...extra,
});

beforeEach(() => {
  fetchMyBusinessAccounts.mockReset();
  createWorkspace.mockReset();
  push.mockReset();
  refresh.mockReset();
});

const formQuery = () => screen.queryByRole("button", { name: /create my workspace/i });

describe("OnboardingForm account lookup", () => {
  it("shows a loading state while the lookup is in flight", async () => {
    fetchMyBusinessAccounts.mockImplementation(() => new Promise(() => {}));
    render(<OnboardingForm />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(formQuery()).toBeNull();
  });

  it("renders the form when the lookup succeeds with zero businesses", async () => {
    fetchMyBusinessAccounts.mockResolvedValue(ok([]));
    render(<OnboardingForm />);

    await waitFor(() => expect(formQuery()).not.toBeNull());
    expect(screen.getByLabelText(/business name/i)).toBeTruthy();
  });

  it("does NOT render the form when the caller already has a business", async () => {
    fetchMyBusinessAccounts.mockResolvedValue(ok(["Bright Cleaners"]));
    render(<OnboardingForm />);

    await waitFor(() => expect(screen.getByText(/workspace is ready/i)).toBeTruthy());
    expect(formQuery()).toBeNull();
    expect(screen.getByText(/Bright Cleaners/)).toBeTruthy();
  });

  /* ------------------------------------------------------- fail closed */

  it("does NOT render the form on a 500", async () => {
    fetchMyBusinessAccounts.mockResolvedValue(fail(500));
    render(<OnboardingForm />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(formQuery()).toBeNull();
    expect(screen.getByText(/could not check your account/i)).toBeTruthy();
  });

  it("does NOT render the form when the browser is offline", async () => {
    // The client reports a transport failure as status 0.
    fetchMyBusinessAccounts.mockResolvedValue(fail(0, { error: "You appear to be offline." }));
    render(<OnboardingForm />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(formQuery()).toBeNull();
  });

  it("does NOT render the form on any other failure status", async () => {
    for (const status of [403, 404, 429, 502, 503]) {
      fetchMyBusinessAccounts.mockResolvedValue(fail(status));
      const { unmount } = render(<OnboardingForm />);
      await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
      expect(formQuery(), `status ${status} rendered the form`).toBeNull();
      unmount();
    }
  });

  it("offers a retry that runs the lookup again, without a page reload", async () => {
    fetchMyBusinessAccounts.mockResolvedValueOnce(fail(500));
    render(<OnboardingForm />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(fetchMyBusinessAccounts).toHaveBeenCalledTimes(1);

    fetchMyBusinessAccounts.mockResolvedValueOnce(ok([]));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(fetchMyBusinessAccounts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(formQuery()).not.toBeNull());
  });

  it("a retry that fails again keeps the form hidden", async () => {
    fetchMyBusinessAccounts.mockResolvedValue(fail(500));
    render(<OnboardingForm />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(fetchMyBusinessAccounts).toHaveBeenCalledTimes(2));
    expect(formQuery()).toBeNull();
  });

  it("a failed lookup cannot enable workspace creation", async () => {
    fetchMyBusinessAccounts.mockResolvedValue(fail(500));
    render(<OnboardingForm />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    // No submit control exists at all, so there is nothing to activate.
    expect(formQuery()).toBeNull();
    expect(createWorkspace).not.toHaveBeenCalled();
  });

  /* -------------------------------------------------------------- 401 */

  it("presents the sign-in path on 401, not the form and not an error", async () => {
    fetchMyBusinessAccounts.mockResolvedValue(fail(401));
    render(<OnboardingForm />);

    await waitFor(() => expect(screen.getByText(/sign in to continue/i)).toBeTruthy());
    expect(formQuery()).toBeNull();
    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link.getAttribute("href")).toBe("/sign-in");
  });

  /* ------------------------------------------------------- no leakage */

  it("shows no database or driver error text", async () => {
    fetchMyBusinessAccounts.mockResolvedValue(
      fail(500, {
        error: "We could not load your business accounts. Try again in a moment.",
        correlationId: "cr_abcdefghjkmn",
      })
    );
    render(<OnboardingForm />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    const text = document.body.textContent ?? "";
    for (const leak of [
      "business_members",
      "relation",
      "constraint",
      "PGRST",
      "select",
      "supabase",
      "postgres",
    ]) {
      expect(text.toLowerCase(), `leaked ${leak}`).not.toContain(leak.toLowerCase());
    }
    // The correlation id IS shown — that is the whole point of it.
    expect(text).toContain("cr_abcdefghjkmn");
  });
});
