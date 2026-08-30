import * as React from "react";
import { PublicShell } from "@/components/couranr/shell/shells";

/**
 * The Couranr master brand: PUB-012 at /.
 *
 * A SERVER layout. The variant is a constant chosen by which route group the
 * page lives in, so no client code and no `usePathname()` is involved in
 * selecting public chrome.
 */
export default function MasterPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell variant="master">{children}</PublicShell>;
}
