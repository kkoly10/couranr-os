import * as React from "react";
import { OperationsShell } from "@/components/couranr/shell/shells";

export default function OperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <OperationsShell>{children}</OperationsShell>;
}
