import { PageHeader, ScreenPlaceholder } from "@/components/couranr/shell/parts";
import { AuditLog } from "@/components/couranr/operations/settings/AuditLog";
import { AvailabilityControls } from "@/components/couranr/operations/settings/AvailabilityControls";
import { SettingsTabs } from "@/components/couranr/operations/settings/SettingsTabs";
import { resolveSettingsTab, settingsTab } from "@/components/couranr/operations/settings/tabs";

export const metadata = { title: "Operations settings — Couranr" };

/**
 * OPS-015 — the Operations settings shell, and the five sub-screens the
 * canonical registry hangs off it.
 *
 * THE TAB IS A ROUTE, NOT A COMPONENT STATE. `ui_screen_registry.json` gives
 * each sub-screen its own address — `?tab=availability` is OPS-016,
 * `?tab=audit` is OPS-020 — so the tab is resolved SERVER-SIDE from
 * `searchParams` and the heading is rendered from the resolved tab. Reading it
 * with `useSearchParams` in a client component would render the shell first
 * and the correct heading a moment later, which is the flash
 * `app/(couranr)/app/business/onboarding/page.tsx` avoids for the same reason.
 *
 * In Next 16 `searchParams` is a Promise and must be awaited.
 *
 * TWO OF THE FIVE TABS ARE BUILT. The other three — OPS-017 policies, OPS-018
 * notifications, OPS-019 AI controls — are ROUTED, LABELLED and EXPLICITLY
 * EMPTY. They render `ScreenPlaceholder`, which says what the screen is for
 * and that it is not built yet. A tab that 404s or silently shows the wrong
 * panel is worse than one that says what it will hold.
 *
 * THAT PLACEHOLDER IS ALSO LOAD-BEARING FOR THE LEDGER.
 * `docs/couranr-mvp/SCREEN_IMPLEMENTATION_LEDGER.csv` classifies all six of
 * OPS-015…020 `placeholder_only` against THIS file's path, and
 * `tests/couranr-implementation-ledger.test.ts` asserts that every
 * `placeholder_only` row's page really does render a `ScreenPlaceholder`. The
 * three unbuilt tabs genuinely are placeholders, so that stays true and
 * honest. The OPS-015 / OPS-016 / OPS-020 rows are now UNDERSTATED and should
 * be reclassified by whoever owns the ledger — the ledger and the generated
 * status files are deliberately not edited from here.
 */
export default async function Page(props: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const searchParams = await props.searchParams;
  const tabId = resolveSettingsTab(searchParams?.tab);
  const tab = settingsTab(tabId);

  return (
    <>
      <PageHeader
        title={tab.title}
        description={tab.purpose}
        breadcrumbs={[
          { label: "Operations", href: "/operations" },
          { label: "Settings", href: "/operations/settings" },
          { label: tab.label },
        ]}
      />

      <SettingsTabs activeTab={tabId} />

      <div
        id="cr-settings-panel"
        role="tabpanel"
        aria-labelledby={`cr-tab-${tabId}`}
        tabIndex={0}
        className="cr-tabs__panel"
      >
        {tabId === "availability" ? <AvailabilityControls /> : null}
        {tabId === "audit" ? <AuditLog /> : null}
        {tab.built ? null : (
          <ScreenPlaceholder screenId={tab.screenId} name={tab.title} purpose={tab.purpose} />
        )}
      </div>
    </>
  );
}
