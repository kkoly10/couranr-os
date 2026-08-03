"use client";

import * as React from "react";

/**
 * One place that asks the browser where it is, and one vocabulary for the
 * answer.
 *
 * PRF-001 requires a location on every proof, and the SQL commands refuse
 * without coordinates. So the interesting cases are all the ways a browser
 * says no — and each needs different words. "Turn on location" is useless
 * advice to someone who already granted it and is standing in a basement.
 *
 * WHAT THIS DELIBERATELY NEVER DOES: substitute a value. Not 0/0, not the
 * previous step's fix, not a hardcoded depot. `Number(null)` is 0, and 0/0 is
 * a real point in the Gulf of Guinea that the database's null check would
 * happily accept — a route in this very slice had that bug before it shipped.
 * A missing fix stays missing and the mutation is blocked.
 *
 * Coordinates are recorded as EVIDENCE, not authority: a phone can be told to
 * lie about where it is, and nothing here pretends otherwise.
 */

export type LocationStatus =
  | "not_requested"
  | "requesting"
  | "ready"
  | "denied"
  | "unavailable"
  | "timed_out";

export type LocationFix = {
  latitude: number;
  longitude: number;
  accuracyM: number | null;
};

export type LocationState = {
  status: LocationStatus;
  fix: LocationFix | null;
  /** What to tell the driver. Specific to the failure, never generic. */
  message: string;
  /** True only when a mutation requiring a position may proceed. */
  usable: boolean;
  request: () => void;
};

export const LOCATION_MESSAGES: Record<LocationStatus, string> = {
  not_requested: "Couranr needs your location for this step.",
  requesting: "Finding your location…",
  ready: "Location captured.",
  denied:
    "Location is blocked for this site. Enable it in your browser settings for this page, then try again.",
  unavailable:
    "Your device could not get a location fix. Move somewhere with a clearer view of the sky and try again.",
  timed_out: "That took too long. Try again once you have a signal.",
};

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Requests a fix on demand — never on mount.
 *
 * A permission prompt that appears the moment a screen loads gets dismissed
 * reflexively, and a dismissal is sticky in most browsers. Asking at the point
 * the driver presses "I have arrived" means the prompt has an obvious reason.
 */
export function useLocationCapture(options?: { timeoutMs?: number }): LocationState {
  const [status, setStatus] = React.useState<LocationStatus>("not_requested");
  const [fix, setFix] = React.useState<LocationFix | null>(null);
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const request = React.useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("unavailable");
      setFix(null);
      return;
    }
    setStatus("requesting");
    setFix(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos?.coords?.latitude;
        const lng = pos?.coords?.longitude;
        // A position object that carries no usable numbers is not a fix. Guard
        // explicitly rather than letting NaN or undefined reach a request body.
        if (typeof lat !== "number" || typeof lng !== "number" || !isFinite(lat) || !isFinite(lng)) {
          setStatus("unavailable");
          setFix(null);
          return;
        }
        const acc = pos?.coords?.accuracy;
        setFix({
          latitude: lat,
          longitude: lng,
          accuracyM: typeof acc === "number" && isFinite(acc) ? acc : null,
        });
        setStatus("ready");
      },
      (err) => {
        setFix(null);
        // 1 PERMISSION_DENIED, 2 POSITION_UNAVAILABLE, 3 TIMEOUT
        if (err?.code === 1) setStatus("denied");
        else if (err?.code === 3) setStatus("timed_out");
        else setStatus("unavailable");
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  }, [timeoutMs]);

  return {
    status,
    fix,
    message: LOCATION_MESSAGES[status],
    // The single predicate every caller gates on. `ready` alone is not enough:
    // a state can be ready with a null fix if a later refactor reorders the
    // setters, and this makes that impossible to miss.
    usable: status === "ready" && fix !== null,
    request,
  };
}

/**
 * The body fragment a located mutation sends.
 *
 * Throws rather than defaulting. A caller that reaches here without a fix has
 * a logic error, and the alternative — silently sending nulls — is how a
 * device with no GPS ends up recorded at the equator.
 */
export function locationBody(state: LocationState): LocationFix {
  if (!state.usable || !state.fix) {
    throw new Error("A location fix is required before this action.");
  }
  return state.fix;
}
