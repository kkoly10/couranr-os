import { PageHeader } from "@/components/couranr/shell/parts";
import { SignUpForm } from "@/components/couranr/onboarding/SignUpForm";

export const metadata = { title: "Business sign up — Couranr" };

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
