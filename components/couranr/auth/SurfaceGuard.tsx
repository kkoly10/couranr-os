"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { CardSkeleton, LoadingState } from "@/components/couranr/states";
import { Stack } from "@/components/couranr/primitives";
import { surfaceOf, type Surface } from "@/lib/couranr/auth/landing";
import { currentPathAsNext, fetchLanding } from "./session";

/**
 * Navigation guard for an authenticated surface.
 *
 * THIS IS NOT AUTHORIZATION. It decides what to render and where to send
 * someone; it decides nothing about what data they may have. Every API route
 * re-verifies the caller independently, and the canonical tables grant nothing
 * to `authenticated`, so bypassing this component yields empty screens, not
 * leaked records.
 *
 * What it is for: a merchant who types `/operations` should land somewhere
 * useful instead of an operator shell full of empty tables, and a signed-out
 * visitor should reach sign-in rather than a skeleton that never resolves.
 *
 * Children are NOT rendered until the check resolves — a guard that renders
 * first and redirects second flashes protected chrome, and §6 forbids a
 * loading state that reveals data it has not confirmed the viewer may see.
 */
export function SurfaceGuard({
  surface,
  children,
}: {
  surface: Surface;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = React.useState<"checking" | "allowed" | "redirecting">(
    "checking"
  );

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      // Ask for THIS path. The server honours it only if it belongs to the
      // surface the caller actually owns, so the answer doubles as the
      // wrong-surface check.
      const landing = await fetchLanding(currentPathAsNext());
      if (cancelled) return;

      if (!landing.ok) {
        setState("redirecting");
        const next = encodeURIComponent(currentPathAsNext());
        router.replace(`/sign-in?next=${next}`);
        return;
      }

      if (landing.value.surface === surface) {
        setState("allowed");
        return;
      }

      // Signed in, wrong surface. The server already computed where they do
      // belong, so send them there rather than to a dead end.
      setState("redirecting");
      router.replace(landing.value.destination);
    })();

    return () => {
      cancelled = true;
    };
    // `pathname` is a dependency so a client-side navigation across surfaces
    // is re-checked rather than trusting the first answer forever.
  }, [router, surface, pathname]);

  if (state === "allowed") return <>{children}</>;

  return (
    <LoadingState
      label={state === "redirecting" ? "Taking you to the right place" : "Checking your access"}
    >
      <Stack gap={4}>
        <CardSkeleton lines={3} />
        <CardSkeleton lines={2} />
      </Stack>
    </LoadingState>
  );
}

/** Convenience wrappers so a layout reads as one line. */
export function surfaceForPath(pathname: string): Surface | null {
  return surfaceOf(pathname);
}
