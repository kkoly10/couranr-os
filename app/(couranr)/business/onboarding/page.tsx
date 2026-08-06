import { PageHeader } from "@/components/couranr/shell/parts";
import { OnboardingForm } from "@/components/couranr/onboarding/OnboardingForm";
import { ActivationScreen } from "@/components/couranr/activation/ActivationChecklist";

export const metadata = { title: "Set up your business — Couranr" };

/**
 * MER-002 — merchant onboarding, and MER-003 — the live activation checklist
 * at `?step=activation`. One route, two states, exactly as the registry
 * declares them.
 *
 * The step is read SERVER-SIDE rather than with `useSearchParams`, because
 * the page header differs between the two states and a header rendered before
 * the step is known would flash the wrong title.
 */
export default async function Page(props: {
  searchParams?: Promise<{ step?: string }>;
}) {
  const searchParams = await props.searchParams;

  if (searchParams?.step === "activation") {
    return (
      <>
        <PageHeader
          title="Go live"
          description="What Couranr needs before your deliveries are dispatched for real. No website, business registration or subscription is required."
          breadcrumbs={[
            { label: "Couranr" },
            { label: "Set up your business", href: "/business/onboarding" },
            { label: "Go live" },
          ]}
        />
        <ActivationScreen />
      </>
    );
  }

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
