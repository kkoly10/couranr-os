import { PageHeader } from "@/components/couranr/shell/parts";
import { ActivationReview } from "@/components/couranr/operations/ActivationReview";

export const metadata = { title: "Merchant management — Couranr" };

/**
 * OPS-007 — merchant management, ACTIVATION SLICE ONLY.
 *
 * The registry's OPS-007 also covers merchant health, risk, categories,
 * presets, support history and account pause. Those belong to ACP-038 in B06
 * and are deliberately absent rather than stubbed — there is no posted source
 * for merchant performance and the registry bans inventing one.
 *
 * What is here is the counterpart to MER-003: the review a merchant's
 * "Request activation" is waiting on. It exists because that decision was
 * previously write-only — an operator could grant or block, but could not see
 * what they were deciding on.
 */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Merchant management"
        description="Review business workspaces waiting on a Couranr activation decision."
        breadcrumbs={[{ label: "Couranr Operations" }, { label: "Merchants" }]}
      />
      <ActivationReview />
    </>
  );
}
