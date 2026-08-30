import * as React from "react";
import { PublicShell } from "@/components/couranr/shell/shells";

/**
 * Couranr for Business: PUB-001 at /business, its marketing family, and the auth entry points.
 *
 * A SERVER layout. The variant is a constant chosen by which route group the
 * page lives in, so no client code and no `usePathname()` is involved in
 * selecting public chrome.
 */
export default function BusinessPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell variant="business">{children}</PublicShell>;
}
