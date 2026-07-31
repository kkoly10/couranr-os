import { PageHeader } from "@/components/couranr/shell/parts";
import { OnboardingForm } from "@/components/couranr/onboarding/OnboardingForm";

export const metadata = { title: "Set up your business — Couranr" };

/** MER-002 — merchant onboarding. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Set up your business"
        description="Six details, then you can send your first delivery. Payment setup and teammates come later."
        breadcrumbs={[{ label: "Couranr" }, { label: "Set up your business" }]}
      />
      <OnboardingForm />
    </>
  );
}
