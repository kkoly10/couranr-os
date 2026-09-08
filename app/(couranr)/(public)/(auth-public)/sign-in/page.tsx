import * as React from "react";
import Image from "next/image";
import { SignInForm } from "@/components/couranr/auth/SignInForm";
import { Wordmark } from "@/components/couranr/shell/parts";

export const metadata = { title: "Sign in — Couranr" };

/**
 * PUB-002 — sign in.
 *
 * `Suspense` is required because the form reads `useSearchParams` for `next`.
 *
 * THE WORDMARK IS ON THE PAGE, not above it. This screen renders no public
 * header (see `(auth-public)/layout.tsx`), so the mark it used to inherit from
 * the topbar has to live here or the one screen a signed-out visitor is most
 * likely to land on carries no brand and no way back to `/`.
 *
 * It appears twice because the two panels are two different backgrounds and
 * BRAND_GUIDE.md forbids one mark from serving both — "do not place the navy
 * logo directly over photography". Exactly one is visible at any width:
 *
 *   >= 900px  the navy story panel is shown, and carries the REVERSE mark
 *   <  900px  that panel is hidden, and the light form panel carries the
 *             PRIMARY mark
 *
 * `tone="dark"` selects the reverse variant; the propless `<Wordmark />` is
 * the primary one, which is the form the brand guard in tests/brand-logo.ts
 * treats as the light-surface mark.
 */
export default function Page() {
  return (
    <div className="cr-auth-split">
      <section className="cr-auth-story" aria-labelledby="auth-story-heading">
        <Image
          src="/images/marketing/2026-08/16-consumer-doorstep-handoff.png"
          alt="A local delivery arriving at a customer's door"
          fill
          priority
          sizes="(min-width: 900px) 50vw, 0px"
          className="cr-auth-story__image"
        />
        <div className="cr-auth-story__scrim" aria-hidden="true" />
        <Wordmark tone="dark" className="cr-auth-story__mark" width={124} />
        <div className="cr-auth-story__content">
          <p className="cr-auth-story__eyebrow">Couranr for Business</p>
          <h2 id="auth-story-heading" className="cr-auth-story__title">
            Run every delivery with confidence.
          </h2>
          <p className="cr-auth-story__body">
            Keep requests, fulfillment, and proof of delivery connected in one
            reliable workspace.
          </p>
          <ul className="cr-auth-story__list">
            <li>Coordinate pickups and handoffs</li>
            <li>Follow every delivery through completion</li>
            <li>Keep delivery records organized</li>
          </ul>
        </div>
      </section>

      <section className="cr-auth-panel" aria-labelledby="sign-in-heading">
        <div className="cr-auth-panel__inner">
          <Wordmark className="cr-auth-panel__mark" width={118} />
          <div className="cr-auth-panel__intro">
            <p className="cr-auth-panel__eyebrow">Welcome back</p>
            <h1 id="sign-in-heading" className="cr-auth-panel__title">
              Sign in to Couranr
            </h1>
            <p className="cr-auth-panel__body">
              Access your delivery workspace and keep your team moving.
            </p>
          </div>
          <React.Suspense
            fallback={
              <p className="cr-auth-panel__loading" role="status">
                Loading sign-in…
              </p>
            }
          >
            <SignInForm />
          </React.Suspense>
        </div>
      </section>
    </div>
  );
}
