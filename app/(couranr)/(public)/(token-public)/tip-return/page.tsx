"use client";

import * as React from "react";

/** Payment-provider redirects return to a token-free URL. The original
 * customer capability never enters Stripe metadata or a return_url. */
export default function TipReturnPage() {
  const [message, setMessage] = React.useState("Returning to your delivery…");
  React.useEffect(() => {
    let target: string | null = null;
    try {
      target = window.sessionStorage.getItem("couranr-driver-tip-return-v1");
      window.sessionStorage.removeItem("couranr-driver-tip-return-v1");
    } catch { /* same-tab storage may be blocked */ }
    if (target) {
      try {
        const url = new URL(target);
        if (url.origin === window.location.origin) {
          window.location.replace(url.href);
          return;
        }
      } catch { /* malformed target */ }
    }
    setMessage("Your card step finished, but this browser could not restore your delivery link. Return to your original Couranr email or delivery tab to check the tip status. Do not retry the charge without checking first.");
  }, []);
  return <section style={{ maxWidth: 640, margin: "10vh auto", padding: 24 }}>
    <h1>Couranr driver tip</h1><p>{message}</p>
  </section>;
}
