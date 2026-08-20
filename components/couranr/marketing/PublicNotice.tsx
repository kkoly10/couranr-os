import * as React from "react";
import Link from "next/link";
import { MARKETS_PUBLIC_COPY } from "@/lib/couranr/public/governed";
import { IconPin } from "./MarketingIcons";

/**
 * The full-bleed service-area bar that sits ABOVE the public header.
 *
 * Drift ledger row `top-notice`, classified REBUILD. The implementation had
 * this as a bordered rounded notice box inside the page content, below the
 * header. Both artboards show a full-bleed bar above it — cream on desktop,
 * navy on mobile — with a pin icon and a right-aligned link.
 *
 * WHY IT LIVES HERE RATHER THAN IN THE SHELL. `shells.tsx` states that no shell
 * renders market, pricing, hours or payer copy, and this sentence is MKT-001's.
 * So `PublicShell` takes a `notice` SLOT — geometry only, no copy — and the
 * public layout fills it with this component. The artboard's placement is
 * reproduced and the shell rule is kept intact.
 */
export function PublicNotice() {
  return (
    <p className="cr-topnotice__inner">
      <span className="cr-topnotice__icon" aria-hidden="true">
        <IconPin />
      </span>
      <span className="cr-topnotice__text">{MARKETS_PUBLIC_COPY}</span>
      <Link href="/service-areas" className="cr-topnotice__link">
        View service areas <span aria-hidden="true">→</span>
      </Link>
    </p>
  );
}
