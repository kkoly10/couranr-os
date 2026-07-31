import * as React from "react";
import { DriverShell } from "@/components/couranr/shell/shells";

export default function CanonicalDriverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DriverShell>{children}</DriverShell>;
}
