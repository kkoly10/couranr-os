import type { Metadata } from "next";
import {
  consumerSendProductionEnvironment,
  consumerSendServerLive,
} from "@/lib/couranr/sameday/serverGate";

export const metadata: Metadata = {
  title: "Couranr Same Day canary access",
  robots: { index: false, follow: false },
};

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ invalid?: string }>;
}) {
  const params = await searchParams;
  const armed = consumerSendServerLive() && consumerSendProductionEnvironment();

  return (
    <div className="cr-mkt cr-send-page">
      <section
        className="cr-mkt-section cr-send"
        aria-labelledby="send-canary-h"
        data-couranr-send="canary-access"
      >
        <h1 id="send-canary-h" className="cr-type-statement">
          Same Day pilot access
        </h1>
        <p className="cr-mkt-editorial__body cr-type-lead">
          This entry is only for an owner-approved production canary.
        </p>
        {!armed ? (
          <p className="cr-send-note">
            The production canary is not armed. No access code can open Same Day right now.
          </p>
        ) : (
          <form
            method="post"
            action="/api/couranr/consumer/canary/activate"
            className="cr-send-panel"
            autoComplete="off"
          >
            <label className="cr-send-field__label" htmlFor="send-canary-token">
              One-time access code
            </label>
            <input
              id="send-canary-token"
              className="cr-input"
              type="password"
              name="token"
              required
              autoComplete="off"
            />
            {params.invalid === "1" ? (
              <p className="cr-field__error" role="alert">
                That access code is unavailable or expired.
              </p>
            ) : null}
            <button type="submit" className="cr-button cr-button--primary">
              Enter pilot
            </button>
          </form>
        )}
      </section>
    </div>
  );
}
