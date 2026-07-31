import * as React from "react";
import { PublicShell } from "@/components/couranr/shell/shells";

export default function PublicGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <PublicShell>{children}</PublicShell>;
}
