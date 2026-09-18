"use client";

import { call, type ApiResult } from "@/components/couranr/requests/client";

/**
 * Browser data access for OPS-015's settings surface.
 *
 * Goes through `call` rather than a raw `fetch` for the reason the merchant
 * settings client already records: `call` attaches the Bearer token every
 * canonical route resolves its actor from, and a hand-rolled fetch carries
 * none.
 *
 * EVERY GENERIC HERE NAMES THE ROUTE'S OWN TOP-LEVEL KEY. The routes return
 * untyped JSON, so `call<AvailabilityView>` against a route that answers
 * `{ availability: … }` typechecks cleanly and reads `undefined` forever —
 * which is precisely how proof upload was dead for its entire life. The two
 * routes answer `{ availability: … }` and `{ audit: … }`, and the shapes below
 * say so.
 */

export type AvailabilityStateId =
  | "standard"
  | "scheduled_only"
  | "temporarily_closed"
  | "weather_limited";

export type OperationalFlagKeyId =
  | "overnight_enabled"
  | "ai_auto_reply_enabled"
  | "request_intake_paused"
  | "ai_global_kill_switch";

export type MarketAvailability = {
  marketKey: string;
  active: boolean;
  maxConcurrentDeliveries: number | null;
  availabilityState: AvailabilityStateId;
  version: number;
  updatedAt: string | null;
  closures: Array<{ id: string; localDate: string; reason: string; active: boolean }>;
};

export type OperationalFlag = {
  key: OperationalFlagKeyId;
  enabled: boolean;
  version: number;
  updatedAt: string | null;
};

export type Availability = {
  provisioned: boolean;
  markets: MarketAvailability[];
  flags: OperationalFlag[];
  unavailable: string[];
};

export type AuditEntryView = {
  id: string;
  source: string;
  createdAt: string;
  actorKind: string | null;
  actorFingerprint: string | null;
  command: string | null;
  fromState: string | null;
  toState: string | null;
  subject: string | null;
  /**
   * OPS-020's "link to entity". A relative Operations path, or null when no
   * canonical screen exists for that entity — never a link that would 404.
   */
  entityHref: string | null;
  severity: "normal" | "security_alert";
  metadata: unknown;
};

export type AuditLog = {
  entries: AuditEntryView[];
  unavailable: string[];
  notProvisioned: string[];
  limit: number;
  truncated: boolean;
};

export function fetchAvailability(): Promise<ApiResult<{ availability: Availability }>> {
  return call("/api/couranr/operations/settings/availability");
}

type CommandResult = Promise<ApiResult<{ availability: Availability; auditRecorded: boolean }>>;

/**
 * Every mutation names a COMMAND WHOSE TARGET IS IN ITS NAME.
 *
 * The browser cannot ask for "this market, that state". It asks for one of
 * eight named things, and the server resolves each name to a target from a map
 * it owns. That is the convention this repo hardened
 * `/api/delivery/mark-in-transit` to — "its target status is fixed by the
 * route, never read from the body" — and two suites enforce it: a canonical
 * route that reads `body.*State` fails the build, which is how the first draft
 * of this slice was caught.
 *
 * The maps below are a browser-side CONVENIENCE so the component can keep
 * thinking in states. They are not authority. A command name the route does
 * not recognise is refused, and no field exists that could carry a target past
 * it.
 *
 * Each versioned command also carries the version the screen believes is
 * current, so the conditional UPDATE behind it turns a stale value into a
 * refusal rather than an overwrite.
 */
const MARKET_MODE_COMMAND: Record<AvailabilityStateId, string> = {
  standard: "set_market_standard",
  scheduled_only: "set_market_scheduled_only",
  temporarily_closed: "set_market_temporarily_closed",
  weather_limited: "set_market_weather_limited",
};

export function setMarketAvailability(input: {
  marketKey: string;
  availabilityState: AvailabilityStateId;
  expectedVersion: number;
}): CommandResult {
  return call("/api/couranr/operations/settings/availability", {
    method: "PUT",
    body: {
      command: MARKET_MODE_COMMAND[input.availabilityState],
      marketKey: input.marketKey,
      expectedVersion: input.expectedVersion,
    },
  });
}

export function setOperationalFlag(input: {
  flagKey: OperationalFlagKeyId;
  enabled: boolean;
  expectedVersion: number;
}): CommandResult {
  return call("/api/couranr/operations/settings/availability", {
    method: "PUT",
    body: {
      command: input.enabled ? "enable_operational_flag" : "disable_operational_flag",
      flagKey: input.flagKey,
      expectedVersion: input.expectedVersion,
    },
  });
}

export function setMarketActive(input: {
  marketKey: string;
  active: boolean;
}): CommandResult {
  return call("/api/couranr/operations/settings/availability", {
    method: "PUT",
    body: {
      command: input.active ? "open_market" : "close_market",
      marketKey: input.marketKey,
    },
  });
}

/**
 * A closure closes a market for one LOCAL calendar date, and the planner reads
 * it — `couranr_plan_service` skips a date with an active closure. Lifting one
 * deactivates the row rather than deleting it, so the record that the market
 * was closed survives.
 */
export function openOperatingClosure(input: {
  marketKey: string;
  localDate: string;
  reason: string;
}): CommandResult {
  return call("/api/couranr/operations/settings/availability", {
    method: "PUT",
    body: { command: "open_operating_closure", ...input },
  });
}

export function liftOperatingClosure(input: { closureId: string }): CommandResult {
  return call("/api/couranr/operations/settings/availability", {
    method: "PUT",
    body: { command: "lift_operating_closure", closureId: input.closureId },
  });
}

/**
 * OPS-020 is a READ, and this module offers no other verb for it on purpose.
 * There is no `updateAuditEntry`, no `deleteAuditEntry` and no route that
 * would answer one — the event tables hold no UPDATE or DELETE grant at all.
 */
export function fetchAuditLog(input: {
  source?: string;
  limit?: number;
}): Promise<ApiResult<{ audit: AuditLog }>> {
  const params = new URLSearchParams();
  if (input.source) params.set("source", input.source);
  if (input.limit) params.set("limit", String(input.limit));
  const qs = params.toString();
  return call(`/api/couranr/operations/settings/audit${qs ? `?${qs}` : ""}`);
}
