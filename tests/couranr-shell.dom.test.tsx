import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * DOM behaviour of the shells: §7 requires keyboard navigation, visible focus,
 * skip-to-content, correct landmarks and accessible names, plus drawer focus
 * trapping and restoration.
 *
 * next/navigation is mocked so `usePathname()` can drive active-route
 * assertions, and next/link is reduced to an anchor.
 */

let mockPathname = "/business";

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  // The shells render the real SignOutButton, which routes on success.
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

// SignOutButton reaches the browser Supabase client at module scope through a
// lazy Proxy. Stubbed so these shell tests stay pure DOM assertions.
vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { signOut: async () => ({ error: null }) } },
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

const { MerchantShell, OperationsShell, DriverShell, PublicShell, CustomerTokenShell } =
  await import("@/components/couranr/shell/shells");
const { MAIN_CONTENT_ID } = await import("@/components/couranr/shell/parts");

beforeEach(() => {
  mockPathname = "/business";
});

describe("landmarks, skip link and accessible names", () => {
  it("renders a main landmark whose id is the skip link target", () => {
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    const main = document.querySelector("main");
    expect(main).not.toBeNull();
    expect(main!.id).toBe(MAIN_CONTENT_ID);

    const skip = screen.getByRole("link", { name: /skip to main content/i });
    expect(skip.getAttribute("href")).toBe(`#${MAIN_CONTENT_ID}`);
  });

  it("makes the skip link the first tabbable element", async () => {
    const user = userEvent.setup();
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    await user.tab();
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /skip to main content/i })
    );
  });

  it("gives the main content region a focusable target for the skip link", () => {
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );
    expect(document.querySelector("main")!.getAttribute("tabindex")).toBe("-1");
  });

  it("names every navigation landmark", () => {
    render(
      <OperationsShell>
        <p>content</p>
      </OperationsShell>
    );
    for (const nav of screen.getAllByRole("navigation")) {
      const name =
        nav.getAttribute("aria-label") || nav.getAttribute("aria-labelledby");
      expect(name, "every <nav> needs an accessible name").toBeTruthy();
    }
  });

  /**
   * An accessible name is not the same thing as textContent. The brand link
   * wraps the approved logo SVG and is named by aria-label plus the image alt,
   * which is valid and is what a screen reader announces. This assertion used
   * to check textContent only, so it failed the moment the typed wordmark was
   * replaced by the real logo — a defect in the test, not in the markup.
   */
  it("gives every navigation link a non-empty accessible name", () => {
    render(
      <OperationsShell>
        <p>content</p>
      </OperationsShell>
    );
    for (const link of screen.getAllByRole("link")) {
      const fromText = link.textContent?.trim() ?? "";
      const fromLabel = link.getAttribute("aria-label")?.trim() ?? "";
      const fromImgAlt = Array.from(link.querySelectorAll("img"))
        .map((i) => i.getAttribute("alt")?.trim() ?? "")
        .join("");
      const accessibleName = fromText || fromLabel || fromImgAlt;
      expect(accessibleName.length, `link with no accessible name: ${link.outerHTML.slice(0, 120)}`)
        .toBeGreaterThan(0);
    }
  });
});

describe("active-route indication comes from the current route", () => {
  it("marks the matching merchant destination aria-current=page", () => {
    mockPathname = "/business/deliveries";
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    const current = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");

    expect(current.length).toBeGreaterThan(0);
    for (const el of current) {
      expect(el.getAttribute("href")).toBe("/business/deliveries");
    }
  });

  it("does not mark the section root active on a child route", () => {
    mockPathname = "/business/deliveries";
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    const dashboard = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href") === "/business");

    for (const el of dashboard) {
      expect(el.getAttribute("aria-current")).toBeNull();
    }
  });

  it("marks nothing active on an unrelated route", () => {
    mockPathname = "/business/unknown-area";
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );
    const current = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(0);
  });
});

describe("mobile navigation drawer", () => {
  it("opens, exposes a named dialog, and closes on Escape", async () => {
    const user = userEvent.setup();
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    const trigger = screen.getByRole("button", { name: /open merchant navigation/i });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: /merchant navigation/i });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /**
   * WHERE the overlay mounts, which is load-bearing and has already regressed
   * once in both directions.
   *
   * In the markup the drawer sits inside the shell's own bar — `.cr-topbar`
   * (public) and `.cr-appbar` (the role shells) — and both are
   * `position: sticky; z-index: 30`, which makes each of them a stacking
   * context. An `aria-modal` dialog at `z-index: 40` nested inside a 30 is
   * composited at 30, so every root-level fixed element painted over it: on
   * PUB-001 at 390px the Ask Couranr launcher covered the drawer and the bottom
   * CTA bar covered the drawer's own "Sign in" button. A z-index cannot climb
   * out of an ancestor's stacking context, so the element has to leave it.
   *
   * It must leave it to `.cr-root` and NOT to `document.body`: every
   * `--couranr-*` token is declared on `.cr-root`, and a body portal renders
   * with no panel background, no text colour and no scrim at all. That was
   * tried first and photographed.
   */
  it("portals the overlay to .cr-root, out of the bar's stacking context", async () => {
    const user = userEvent.setup();
    render(
      <div className="cr-root">
        <MerchantShell>
          <p>content</p>
        </MerchantShell>
      </div>
    );

    await user.click(screen.getByRole("button", { name: /open merchant navigation/i }));
    const overlay = screen.getByRole("dialog", { name: /merchant navigation/i }).parentElement!;

    expect(overlay.className).toContain("cr-overlay--nav");
    expect(overlay.parentElement?.className).toContain("cr-root");
    // The trap this exists to escape.
    expect(overlay.closest(".cr-appbar")).toBeNull();
    expect(overlay.closest(".cr-topbar")).toBeNull();
  });

  it("falls back to document.body when there is no .cr-root", async () => {
    const user = userEvent.setup();
    // No wrapper: the legacy trees have no `.cr-root`, and a drawer that
    // renders nowhere is worse than one that renders untokenised.
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    await user.click(screen.getByRole("button", { name: /open merchant navigation/i }));
    const overlay = screen.getByRole("dialog", { name: /merchant navigation/i }).parentElement!;
    expect(overlay.parentElement).toBe(document.body);
  });

  it("moves focus into the drawer on open and restores it to the trigger on close", async () => {
    const user = userEvent.setup();
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    const trigger = screen.getByRole("button", { name: /open merchant navigation/i });
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: /merchant navigation/i });
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(trigger);
  });

  it("closes when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    await user.click(screen.getByRole("button", { name: /open merchant navigation/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    const overlay = document.querySelector(".cr-overlay--nav")!;
    await user.click(overlay as HTMLElement);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes via its own close button and restores focus", async () => {
    const user = userEvent.setup();
    render(
      <OperationsShell>
        <p>content</p>
      </OperationsShell>
    );

    const trigger = screen.getByRole("button", { name: /open operations navigation/i });
    await user.click(trigger);

    await user.click(
      screen.getByRole("button", { name: /close operations navigation/i })
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("traps Tab inside the drawer", async () => {
    const user = userEvent.setup();
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    await user.click(screen.getByRole("button", { name: /open merchant navigation/i }));
    const dialog = screen.getByRole("dialog");

    // Cycle well past the number of focusable children; focus must stay inside.
    for (let i = 0; i < 24; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("exposes only this role's destinations inside the drawer", async () => {
    const user = userEvent.setup();
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    await user.click(screen.getByRole("button", { name: /open merchant navigation/i }));
    const dialog = screen.getByRole("dialog");

    const hrefs = within(dialog)
      .getAllByRole("link")
      .map((l) => l.getAttribute("href") || "");

    expect(hrefs.length).toBeGreaterThan(0);
    for (const h of hrefs) {
      // Sign out is the one deliberate exception; everything else is /business.
      if (h === "/login") continue;
      expect(h.startsWith("/business")).toBe(true);
      expect(h.startsWith("/operations")).toBe(false);
    }
  });
});

describe("driver field shell", () => {
  it("uses a bottom tab bar rather than the merchant sidebar", () => {
    mockPathname = "/driver/messages";
    render(
      <DriverShell>
        <p>content</p>
      </DriverShell>
    );

    const tabbar = document.querySelector(".cr-tabbar");
    expect(tabbar).not.toBeNull();
    expect(document.querySelector(".cr-sidebar")).toBeNull();
  });

  it("keeps the driver destination set small and driver-scoped", () => {
    mockPathname = "/driver/messages";
    render(
      <DriverShell>
        <p>content</p>
      </DriverShell>
    );

    const nav = screen.getByRole("navigation", { name: /driver navigation/i });
    const links = within(nav).getAllByRole("link");

    expect(links.length).toBeLessThanOrEqual(4);
    for (const l of links) {
      expect(l.getAttribute("href")!.startsWith("/driver")).toBe(true);
    }
  });

  it("indicates the active driver tab", () => {
    mockPathname = "/driver/availability";
    render(
      <DriverShell>
        <p>content</p>
      </DriverShell>
    );

    const current = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.getAttribute("href"))).toContain("/driver/availability");
  });
});

describe("public and customer shells", () => {
  it("public shell offers sign-in and account creation", () => {
    mockPathname = "/pricing";
    render(
      <PublicShell>
        <p>content</p>
      </PublicShell>
    );

    expect(screen.getAllByRole("link", { name: /sign in/i }).length).toBeGreaterThan(0);
    const hrefs = screen.getAllByRole("link").map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/sign-in");
    expect(hrefs).toContain("/sign-up");
  });

  /**
   * The token-scoped customer shell must not grow an account menu or global
   * navigation: customer accounts are optional and every customer screen is
   * reached by token.
   */
  it("customer token shell renders no navigation and no sign-out", () => {
    render(
      <CustomerTokenShell reference="CR-1042">
        <p>content</p>
      </CustomerTokenShell>
    );

    expect(screen.queryAllByRole("navigation")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: /sign out/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /open .*navigation/i })).toBeNull();
  });

  it("customer token shell still provides a main landmark and skip link", () => {
    render(
      <CustomerTokenShell>
        <p>content</p>
      </CustomerTokenShell>
    );
    expect(document.querySelector("main")!.id).toBe(MAIN_CONTENT_ID);
    expect(screen.getByRole("link", { name: /skip to main content/i })).toBeTruthy();
  });

  it("customer token shell never renders the access token", () => {
    render(
      <CustomerTokenShell reference="CR-1042" helpHref="/help/SECRET-TOKEN">
        <p>content</p>
      </CustomerTokenShell>
    );
    // The href may carry the token, but no visible label may.
    expect(document.body.textContent).not.toContain("SECRET-TOKEN");
  });
});

describe("sign-out placement", () => {
  /**
   * A BUTTON, not a link. This test previously asserted `role: "link"` — it
   * encoded the defect, where "Sign out" navigated to /login and left the
   * Supabase session live. Behaviour is covered by couranr-signout.dom.test.tsx.
   */
  it("appears once in the merchant sidebar and once in its drawer", async () => {
    const user = userEvent.setup();
    render(
      <MerchantShell>
        <p>content</p>
      </MerchantShell>
    );

    // Sidebar copy only, before the drawer opens.
    expect(screen.getAllByRole("button", { name: /sign out/i })).toHaveLength(1);
    expect(screen.queryAllByRole("link", { name: /sign out/i })).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: /open merchant navigation/i }));
    expect(screen.getAllByRole("button", { name: /sign out/i })).toHaveLength(2);
  });

  it("is present in the operations sidebar", () => {
    render(
      <OperationsShell>
        <p>content</p>
      </OperationsShell>
    );
    expect(screen.getAllByRole("button", { name: /sign out/i }).length).toBeGreaterThanOrEqual(1);
  });

  /**
   * The driver works on a shared device, so sign-out lives in the persistent
   * top bar where it is always reachable — NOT in the tab bar, which is for
   * destinations only.
   */
  it("is in the driver top bar and not in its tab bar", () => {
    render(
      <DriverShell>
        <p>content</p>
      </DriverShell>
    );
    expect(screen.getAllByRole("button", { name: /sign out/i })).toHaveLength(1);
    const nav = screen.getByRole("navigation", { name: /driver navigation/i });
    expect(within(nav).queryByRole("button", { name: /sign out/i })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /sign out/i })).toBeNull();
  });

  /** The customer surface is reached by a per-delivery token, not a session. */
  it("is absent from the customer token shell", () => {
    render(
      <CustomerTokenShell>
        <p>content</p>
      </CustomerTokenShell>
    );
    expect(screen.queryByRole("button", { name: /sign out/i })).toBeNull();
  });
});
