"use client";

import * as React from "react";
import Script from "next/script";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  initializeMarketingMeasurement,
  isSafeMarketingLocation,
  MARKETING_CONSENT_KEY,
  marketingConsentAccepted,
  trackMarketingPageView,
} from "@/lib/couranr/marketing/measurement";

type Consent = "pending" | "accepted" | "declined";

export function SameDayMarketingMeasurement({
  gaId,
  pixelId,
}: {
  gaId: string | null;
  pixelId: string | null;
}) {
  const pathname = usePathname();
  const [consent, setConsent] = React.useState<Consent>("pending");
  const [hydrated, setHydrated] = React.useState(false);
  const [scriptsReady, setScriptsReady] = React.useState(false);
  const [showChoices, setShowChoices] = React.useState(false);
  const lastPageView = React.useRef<string | null>(null);
  const configured = Boolean(gaId || pixelId);
  const onMarketingPage = pathname === "/sameday" || pathname === "/send";

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(MARKETING_CONSENT_KEY);
      setConsent(saved === "accepted" || saved === "declined" ? saved : "pending");
    } catch {
      setConsent("pending");
    }
    setHydrated(true);
  }, []);

  React.useEffect(() => {
    if (!configured || !onMarketingPage || consent !== "accepted") return;
    if (!marketingConsentAccepted() || !isSafeMarketingLocation(window.location)) return;
    initializeMarketingMeasurement(gaId, pixelId);
    setScriptsReady(true);
    const page = `${window.location.pathname}${window.location.search}`;
    if (lastPageView.current !== page) {
      trackMarketingPageView();
      lastPageView.current = page;
    }
  }, [configured, consent, gaId, onMarketingPage, pathname, pixelId]);

  React.useEffect(() => {
    function syncConsent(event: StorageEvent) {
      if (event.key === MARKETING_CONSENT_KEY && !marketingConsentAccepted()) {
        // Previously loaded third-party scripts cannot be safely unloaded.
        window.location.reload();
      }
    }
    window.addEventListener("storage", syncConsent);
    return () => window.removeEventListener("storage", syncConsent);
  }, []);

  function choose(next: "accepted" | "declined") {
    try {
      window.localStorage.setItem(MARKETING_CONSENT_KEY, next);
    } catch {
      // No storage means no durable opt-in. Stay declined and load no scripts.
      setConsent("declined");
      setShowChoices(false);
      return;
    }
    if (next === "declined" && scriptsReady) {
      window.location.reload();
      return;
    }
    setConsent(next);
    setShowChoices(false);
  }

  if (!configured || !onMarketingPage || !hydrated) return null;

  return (
    <>
      {scriptsReady && gaId ? (
        <Script src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`} strategy="afterInteractive" />
      ) : null}
      {scriptsReady && pixelId ? (
        <Script src="https://connect.facebook.net/en_US/fbevents.js" strategy="afterInteractive" />
      ) : null}
      {consent === "pending" || showChoices ? (
        <aside className="cr-marketing-consent" aria-label="Measurement preferences">
          <div>
            <strong>Help us understand what works</strong>
            <p>
              With your permission, Google Analytics and Meta measure Same Day page visits and submitted delivery requests.
              Your choice does not affect delivery. <Link href="/privacy">Privacy details</Link>
            </p>
          </div>
          <div className="cr-marketing-consent__actions">
            <button type="button" onClick={() => choose("declined")}>Not now</button>
            <button type="button" onClick={() => choose("accepted")}>Allow measurement</button>
          </div>
        </aside>
      ) : (
        <button type="button" className="cr-marketing-consent-link" onClick={() => setShowChoices(true)}>
          Tracking preferences
        </button>
      )}
    </>
  );
}
