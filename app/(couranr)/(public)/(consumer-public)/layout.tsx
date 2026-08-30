import * as React from "react";
import { PublicShell } from "@/components/couranr/shell/shells";

/**
 * Couranr Same Day: PUB-013 at /sameday and PUB-004's direct-consumer routes.
 *
 * A SERVER layout. The variant is a constant chosen by which route group the
 * page lives in, so no client code and no `usePathname()` is involved in
 * selecting public chrome.
 */
export default function ConsumerPublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell variant="consumer">{children}</PublicShell>;
}
