"use client";

import type { TrackingProjection } from "@/lib/couranr/tracking/projection";

/**
 * Browser data access for the customer tracking link.
 *
 * NOT `components/couranr/requests/client`'s `call`, deliberately: that helper
 * attaches a Bearer token from the browser session, and this surface has no
 * session and never will. A recipient has no Couranr account — the token in
 * the URL is the whole authorization, and it is carried in the path exactly as
 * the payment link is.
 *
 * The only mutation is a versioned adult attestation for a protected handoff.
 * It cannot change delivery, money, route, address, proof or lifecycle state.
 */

export type TrackingRefused = { resolved: false };
export type TrackingResolved = { resolved: true; tracking: TrackingProjection };
export type TrackingLoad = TrackingRefused | TrackingResolved | { failed: true };

/**
 * A REFUSAL AND A FAILURE ARE DIFFERENT THINGS.
 *
 * 404 means the server declined to resolve the link, and the page says so in
 * one fixed sentence. Anything else — a 500, an offline browser, a body that
 * is not JSON — means the page could not find out, and telling a waiting
 * customer their link is dead because the network blinked is the wrong answer.
 * The two render differently and only one offers a retry.
 */
export async function fetchTracking(token: string): Promise<TrackingLoad> {
  let res: Response;
  try {
    res = await fetch(`/api/couranr/track/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
  } catch {
    return { failed: true };
  }

  if (res.status === 404) return { resolved: false };
  if (!res.ok) return { failed: true };

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    return { failed: true };
  }
  if (!payload?.tracking) return { failed: true };
  return { resolved: true, tracking: payload.tracking as TrackingProjection };
}

/**
 * Mint a signed URL for one proof image.
 *
 * Called at the moment the customer asks to see it and never stored — PHO-001
 * sets `persist_signed_urls: false`, and the URL expires in 600 seconds, so a
 * cached one would be a broken image with a token in it.
 */
export async function fetchProofUrl(
  token: string,
  proofId: string
): Promise<{ url: string } | null> {
  let res: Response;
  try {
    res = await fetch(
      `/api/couranr/track/${encodeURIComponent(token)}/proof/${encodeURIComponent(proofId)}/url`,
      { cache: "no-store" }
    );
  } catch {
    return null;
  }
  if (!res.ok) return null;
  try {
    const payload = await res.json();
    const url = payload?.proofUrl?.url;
    return typeof url === "string" && url.length > 0 ? { url } : null;
  } catch {
    return null;
  }
}

export async function attestRecipientAdult(token: string): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/couranr/track/${encodeURIComponent(token)}/adult-attestation`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: true }),
      }
    );
    return res.ok;
  } catch {
    return false;
  }
}
