import { Suspense } from "react";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { SendFlow } from "@/components/couranr/sameday/SendFlow";
import { SEND_COPY } from "@/lib/couranr/public/masterSameDayCopy";
import { resolveAdapterMode } from "@/lib/couranr/sameday/adapterMode";
import {
  consumerSendProductionEnvironment,
} from "@/lib/couranr/sameday/serverGate";
import {
  CONSUMER_CANARY_COOKIE,
  consumerCanaryCookieValid,
} from "@/lib/couranr/consumer/canary";
import type { AdapterMode } from "@/lib/couranr/sameday/adapterMode";

/**
 * PUB-004's direct-consumer mode, at /send.
 *
 * Adapter mode is resolved server-side. Production requires BOTH the existing
 * two-key live arming AND a valid HttpOnly canary cookie before this page ever
 * renders the live adapters. A normal production visitor therefore remains on
 * the governed production-stop state even while a single canary participant is
 * permitted through.
 */
export const metadata: Metadata = {
  title: "Send something — Couranr Same Day",
  description: "Send something you have, or have Couranr pick something up for you.",
};

export default async function Page() {
  const resolved = resolveAdapterMode();
  let mode: AdapterMode = resolved.mode;

  if (mode === "live" && consumerSendProductionEnvironment()) {
    const cookieStore = await cookies();
    const canaryCookie = cookieStore.get(CONSUMER_CANARY_COOKIE)?.value ?? null;
    if (!(await consumerCanaryCookieValid(canaryCookie))) {
      mode = "disabled";
    }
  }

  return (
    <div className="cr-mkt cr-send-page">
      <Suspense fallback={<p className="cr-send-note">Loading your delivery form…</p>}>
        <SendFlow mode={mode} productionStop={SEND_COPY.production_stop} />
      </Suspense>
    </div>
  );
}
