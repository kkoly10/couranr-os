import * as React from "react";
import { PageHeader } from "@/components/couranr/shell/parts";
import { SignInForm } from "@/components/couranr/auth/SignInForm";

export const metadata = { title: "Sign in — Couranr" };

/**
 * PUB-002 — sign in.
 *
 * `Suspense` is required because the form reads `useSearchParams` for `next`.
 */
export default function Page() {
  return (
    <>
      <PageHeader title="Sign in" />
      <React.Suspense fallback={null}>
        <SignInForm />
      </React.Suspense>
    </>
  );
}
