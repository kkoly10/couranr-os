import * as React from "react";
import Image from "next/image";
import { SignInForm } from "@/components/couranr/auth/SignInForm";

export const metadata = { title: "Sign in — Couranr" };

/**
 * PUB-002 — sign in.
 *
 * `Suspense` is required because the form reads `useSearchParams` for `next`.
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
