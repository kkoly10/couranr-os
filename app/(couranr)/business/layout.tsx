import * as React from "react";
import { MerchantShell } from "@/components/couranr/shell/shells";

export default function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MerchantShell>{children}</MerchantShell>;
}
