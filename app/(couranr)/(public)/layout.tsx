import * as React from "react";
import { PublicShell } from "@/components/couranr/shell/shells";

export default function PublicGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // NO SERVICE-AREA BAR. Both PUB-001 artboards show a full-bleed notice above
  // the header and this layout filled it with MKT-001's markets sentence. The
  // owner removed it on 2026-08-29 at both widths and on all five public pages,
  // so the mock is deliberately not followed here — see the `top-notice` row in
  // PUB_001_VISUAL_DRIFT_LEDGER.csv. The sentence itself is NOT orphaned: the
  // homepage renders it in its service-areas card and PUB-010 renders it twice.
  return <PublicShell>{children}</PublicShell>;
}
