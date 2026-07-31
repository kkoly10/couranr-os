"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/cn";

/**
 * Real sign-out.
 *
 * This replaces a `<Link href="/login">` that said "Sign out" and did nothing
 * of the sort — it navigated, left the Supabase session intact, and the next
 * visit to any merchant page walked straight back in. A control labelled
 * "Sign out" must terminate the session; navigation alone is a lie to the user
 * and, on a shared machine, a real exposure.
 *
 * It is a `<button>`, not a styled link: it performs an action rather than
 * navigating, so it must be a button for keyboard and assistive-technology
 * users. It carries the sidebar link class only for visual consistency.
 */
export function SignOutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  async function onClick() {
    setFailed(false);
    setBusy(true);

    const { error } = await supabase.auth.signOut();

    if (error) {
      // Do NOT redirect. Telling someone they are signed out while their
      // session is still live is the worst possible outcome here.
      setBusy(false);
      setFailed(true);
      return;
    }

    // Only after the session is actually gone.
    router.replace("/sign-in");
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        aria-busy={busy || undefined}
        className={cn("cr-sidebar__link", "cr-signout", className)}
        style={{ marginTop: "var(--couranr-space-2)" }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed ? (
        <p className="cr-field__error" role="alert">
          Sign out did not complete. You are still signed in — try again.
        </p>
      ) : null}
    </div>
  );
}
