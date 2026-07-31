import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioural tests for sign-out.
 *
 * The defect this replaces was a `<Link href="/login">` labelled "Sign out"
 * that navigated and left the Supabase session live — so the next visit to any
 * merchant page walked straight back in. String-matching the source would not
 * have caught it (the string "Sign out" was present and the file looked fine),
 * so the ordering is asserted by driving the component.
 */

const signOut = vi.fn();
const replace = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: () => signOut() } },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh, push: vi.fn() }),
  usePathname: () => "/business",
}));

const { SignOutButton } = await import("@/components/couranr/auth/SignOutButton");

beforeEach(() => {
  signOut.mockReset();
  replace.mockReset();
  refresh.mockReset();
});

describe("SignOutButton", () => {
  it("is a button, not a link", () => {
    render(<SignOutButton />);
    const control = screen.getByRole("button", { name: /sign out/i });
    expect(control.tagName).toBe("BUTTON");
    expect(control.getAttribute("href")).toBeNull();
  });

  it("terminates the Supabase session when activated", async () => {
    signOut.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignOutButton />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("redirects to /sign-in only AFTER signOut resolves", async () => {
    let release: (v: unknown) => void = () => {};
    signOut.mockImplementation(() => new Promise((r) => (release = r)));

    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByRole("button", { name: /sign out/i }));

    // In flight: the session is not gone, so nothing may navigate yet.
    await waitFor(() => expect(signOut).toHaveBeenCalled());
    expect(replace).not.toHaveBeenCalled();

    release({ error: null });
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/sign-in"));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows a disabled busy state while signing out", async () => {
    let release: (v: unknown) => void = () => {};
    signOut.mockImplementation(() => new Promise((r) => (release = r)));

    const user = userEvent.setup();
    render(<SignOutButton />);
    const control = screen.getByRole("button", { name: /sign out/i });
    await user.click(control);

    await waitFor(() => expect(control.hasAttribute("disabled")).toBe(true));
    expect(control.getAttribute("aria-busy")).toBe("true");

    release({ error: null });
  });

  /** Telling someone they are signed out while their session is live is the worst outcome. */
  it("does NOT navigate when signOut fails, and says so", async () => {
    signOut.mockResolvedValue({ error: { message: "network down" } });
    const user = userEvent.setup();
    render(<SignOutButton />);

    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/still signed in/i);
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    // Re-enabled so the user can retry.
    expect(
      screen.getByRole("button", { name: /sign out/i }).hasAttribute("disabled")
    ).toBe(false);
  });

  it("does not leak the driver error message into the page", async () => {
    signOut.mockResolvedValue({
      error: { message: 'JWSError on relation "profiles"' },
    });
    const user = userEvent.setup();
    render(<SignOutButton />);
    await user.click(screen.getByRole("button", { name: /sign out/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(document.body.textContent).not.toMatch(/JWSError|profiles/);
  });

  it("is reachable and activatable by keyboard alone", async () => {
    signOut.mockResolvedValue({ error: null });
    const user = userEvent.setup();
    render(<SignOutButton />);

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /sign out/i }));

    await user.keyboard("{Enter}");
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});
