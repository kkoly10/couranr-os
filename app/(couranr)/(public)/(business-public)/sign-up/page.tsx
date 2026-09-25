import { PageHeader } from "@/components/couranr/shell/parts";
import { SignUpForm } from "@/components/couranr/onboarding/SignUpForm";
import { createNoIndexPublicMetadata } from "@/lib/couranr/public/seo";

export const metadata = createNoIndexPublicMetadata({
  title: "Business sign up — Couranr",
  description: "Create a business account to set up Couranr delivery.",
});

/** PUB-003 — business sign up. */
export default function Page() {
  return (
    <>
      <PageHeader
        title="Set up your business on Couranr"
        description="Create a sign-in, tell us where you pick up, and start sending deliveries."
      />
      <SignUpForm />
    </>
  );
}
