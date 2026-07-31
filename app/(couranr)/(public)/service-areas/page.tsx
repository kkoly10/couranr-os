import { ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { PageHeader } from "@/components/couranr/shell/parts";

export const metadata = { title: "Service areas page — Couranr" };

/**
 * Launch markets are an UNRESOLVED decision (02_DECISION_REGISTRY.json, MKT-001).
 *
 * The screen registry's own purpose string for PUB-010 names four specific
 * markets. Copying it here would convert an unresolved decision into shipped
 * copy, so the placeholder stays neutral until that decision is made.
 */
const NEUTRAL_PURPOSE =
  "Explain active launch markets, surrounding service areas, and review-based extended-distance availability.";

export default function Page() {
  return (
    <>
      <PageHeader title="Service areas page" />
      <ScreenPlaceholder
        screenId="PUB-010"
        name="Service areas page"
        purpose={NEUTRAL_PURPOSE}
      />
    </>
  );
}
