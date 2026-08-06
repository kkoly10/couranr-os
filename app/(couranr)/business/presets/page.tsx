import * as React from "react";
import { PageHeader } from "@/components/couranr/shell/parts";
import { PresetsScreen } from "@/components/couranr/presets/PresetsScreen";

export const metadata = { title: "Presets — Couranr" };

/**
 * MER-010 presets list, and MER-011 the builder at `?edit=`.
 *
 * One route, two states, as the registry declares them.
 *
 * `Suspense` is required because the screen reads `useSearchParams`.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Presets"
        description="What you usually send, saved so you do not retype it."
        breadcrumbs={[{ label: "Couranr" }, { label: "Presets" }]}
      />
      <React.Suspense fallback={null}>
        <PresetsScreen />
      </React.Suspense>
    </>
  );
}
