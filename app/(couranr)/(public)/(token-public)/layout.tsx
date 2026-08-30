import * as React from "react";
import { PublicShell } from "@/components/couranr/shell/shells";

/**
 * The token-scoped customer surfaces. Deliberately unchanged in this slice: the variant renders the pre-V10 presentation so three live customer pages are not redesigned as a side effect of a chrome refactor.
 *
 * A SERVER layout. The variant is a constant chosen by which route group the
 * page lives in, so no client code and no `usePathname()` is involved in
 * selecting public chrome.
 */
export default function TokenPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell variant="token">{children}</PublicShell>;
}
