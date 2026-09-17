import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { assertServerOnly } from "@/lib/couranr/serverOnly";
import {
  classifyDatabaseError,
  logServerFailure,
  newCorrelationId,
  type PublicErrorCode,
} from "@/lib/couranr/errors";
import type { RequestActor } from "@/lib/couranr/requests/permissions";

assertServerOnly("lib/couranr/operations/custodyBundle.ts");

/**
 * OPS-012 — ONE custody bundle for one delivery, for an investigator.
 *
 * This is a READ. It opens nothing, decides nothing and moves nothing: no
 * money, no state, no claim outcome. An investigator looking at a claim has to
 * assemble the chain today out of four screens and two tables that no
 * TypeScript reads at all; this assembles it once, server-side, under the
 * Operations actor gate.
 *
 * THREE RULES THIS MODULE IS BUILT AROUND.
 *
 * 1. **No location of any private object ever leaves here.** Not a bucket, not
 *    an object path, not a signed URL. Evidence is identified by its proof id
 *    (or its problem-evidence id) and the browser exchanges that id for a
 *    short-lived URL through the EXISTING Operations endpoints, which call
 *    `signedProofUrl(..., viewer:"operations")` and
 *    `signedOperationsProblemEvidenceUrl`. The TTL is chosen by viewer role
 *    inside the proof policy; nothing here can influence it, and no URL is
 *    minted, persisted or logged on this path. `tests/couranr-operations-
 *    custody-bundle.test.ts` serializes the bundle and fails on any forbidden
 *    substring, mirroring the tracking projection's guard.
 *
 * 2. **A failed read is never rendered as an absent fact.** Telling an
 *    investigator "no security seal was recorded" because a query errored is
 *    the same defect class as telling a returning merchant they have no
 *    business. Every section that cannot be read is named in `unavailable`
 *    and its value stays null, so the screen can say which half of the chain
 *    it is missing rather than implying the driver skipped a step.
 *
 * 3. **`declared_value_cents` is Operations-only and stays that way.** It is
 *    the whole point of a claim review, so it belongs here — and it is a theft
 *    incentive, so it is deliberately absent from the driver projection
 *    (`lib/couranr/dispatch/projection.ts`, a strict allow-list).
 *    `tests/couranr-operations-custody-bundle.test.ts` asserts the driver
 *    projection still excludes it.
 */

/* ══════════════════════════════════════════════════════ result plumbing ══ */

export type CustodyFailure = {
  ok: false;
  code: PublicErrorCode;
  correlationId: string;
  message?: string;
};
export type CustodyResult<T> = { ok: true; value: T } | CustodyFailure;

/** `tsconfig` sets `"strict": false`; a bare `!r.ok` does not narrow. */
export function isCustodyFailure(r: { ok: boolean }): r is CustodyFailure {
  return r.ok === false;
}

function fail(p: {
  operation: string;
  code: PublicErrorCode;
  detail?: unknown;
  message?: string;
}): CustodyFailure {
  const correlationId = newCorrelationId();
  logServerFailure({ correlationId, operation: p.operation, code: p.code, detail: p.detail });
  const out: CustodyFailure = { ok: false, code: p.code, correlationId };
  if (p.message) out.message = p.message;
  return out;
}

/* ═══════════════════════════════════════════════════════ the guard list ══ */

/**
 * Strings that must NEVER appear anywhere in a serialized custody bundle, at
 * any depth. Exact column and field names plus the private bucket's own name,
 * so the check cannot false-positive on ordinary address or note text.
 *
 * Modelled on `TRACKING_PROJECTION_FORBIDDEN_SUBSTRINGS`. The membership is
 * different because the audiences are: Operations legitimately sees the
 * tenant, the delivery id and the capture coordinates that a public tracking
 * link must never carry. What NO audience ever receives is the location of a
 * private object or a credential's stored form.
 */
export const CUSTODY_BUNDLE_FORBIDDEN_SUBSTRINGS: readonly string[] = [
  "storage_object_path",
  "storageObjectPath",
  "storage_bucket",
  "storageBucket",
  "object_path",
  "objectPath",
  "signedUrl",
  "signed_url",
  "signedURL",
  // The credential as stored. A digest is not a code, and it is still not ours
  // to publish: it is the value an offline attack runs against.
  "code_digest",
  "codeDigest",
  "token_hash",
  "tokenHash",
  // The Stripe Identity session handle. The bundle carries the OUTCOME; the
  // handle is a provider-side capability and the schema already tracks its
  // purge date, which would be meaningless if we copied it out.
  "provider_reference",
  "providerReference",
  // The private bucket itself, in case a path is ever pasted in whole.
  "delivery-photos",
] as const;

/* ═════════════════════════════════════════════════════════════ the shape ══ */

/** One piece of driver-captured evidence, addressed by id and never by path. */
export type CustodyEvidence = {
  /** Exchange this at `/api/couranr/operations/proof/[proofId]/url`. */
  proofId: string;
  proofStage: string;
  proofType: string;
  finalizedAt: string | null;
  capturedAt: string | null;
  /** Whether media EXISTS. Where it lives is not a fact this bundle carries. */
  hasMedia: boolean;
};

/** One customer-supplied claim photo, addressed by id and never by path. */
export type CustodyClaimEvidence = {
  /**
   * Exchange this at
   * `/api/couranr/operations/problem-reports/[reportId]?evidenceId=…`.
   */
  evidenceId: string;
  finalizedAt: string | null;
};

export type CustodyClaim = {
  claimId: string;
  problemType: string;
  /** The customer's own words. Shown to the investigator verbatim. */
  details: string;
  state: string;
  submittedAt: string | null;
  resolvedAt: string | null;
  version: number;
  evidence: CustodyClaimEvidence[];
};

export type CustodyIncident = {
  incidentId: string;
  incidentType: string;
  incidentState: string;
  severity: string;
  summary: string | null;
  openedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  version: number;
};

/** A handoff credential's OUTCOME. Never the code, never its digest. */
export type CustodyCredential = {
  /** active | consumed | superseded | locked | expired */
  state: string;
  /** When the driver's entry was accepted, or null if it never was. */
  verifiedAt: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  failedAttempts: number;
  /** Reissues. A second generation means the first credential was replaced. */
  generation: number;
};

/** Where and when a physical handoff was recorded. */
export type CustodyPlace = {
  recordedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
};

export type CustodyBundle = {
  deliveryId: string;
  requestId: string;
  /** The human reference an investigator quotes. Null on older rows. */
  reference: string | null;
  fulfillmentState: string;

  declaration: {
    /** What the sender said they were shipping (PRF-002 pickup manifest). */
    description: string | null;
    packageCount: number | null;
    orderReference: string | null;
    handlingNotes: string | null;
    manifestSource: string | null;
    manifestPolicyVersion: string | null;
    /** The declared TOTAL for the shipment. Operations-only. */
    declaredValueCents: number | null;
    protectionLevel: string | null;
    protectionPolicyVersion: string | null;
    restrictedClass: string | null;
    /**
     * Whether the protection policy GOVERNS this delivery, mirroring
     * `private.couranr_delivery_protection_level`: a row carrying a level but
     * no policy version was not written by that policy and is not held to its
     * rules. Every `required` flag below is false when this is false.
     */
    protectionGoverned: boolean;
  };

  senderTerms: {
    termsVersion: string | null;
    termsAcceptedAt: string | null;
    electronicConsentAt: string | null;
    adultAttestedAt: string | null;
  };

  pickup: {
    /** The SENDER's credential (`merchant_pickup`), not the driver's. */
    credential: CustodyCredential | null;
    place: CustodyPlace | null;
    observedPackageCount: number | null;
    /** The item, before it went into the package. */
    prepackPhoto: CustodyEvidence | null;
    /** The package, sealed. */
    sealedPackagePhoto: CustodyEvidence | null;
    /** Required at `secure_pickup` and above, per the custody-sequence trigger. */
    documentationRequired: boolean;
    /**
     * Whether the sender's credential was accepted AFTER both photographs.
     * The database enforces this ordering for a governed delivery; restating
     * it here is what lets an investigator SEE that a confirmation given
     * before the documentation existed could not have been about it.
     * Null when any of the three timestamps is missing.
     */
    credentialAfterDocumentation: boolean | null;
  };

  seal: {
    sealIdentifier: string | null;
    appliedAt: string | null;
    /** intact | damaged | missing */
    dropoffCondition: string | null;
    dropoffRecordedAt: string | null;
    /** The pickup photograph the seal record is bound to. */
    sealedPackagePhoto: CustodyEvidence | null;
    dropoffSealPhoto: CustodyEvidence | null;
  } | null;

  dropoff: {
    place: CustodyPlace | null;
    proofMethodUsed: string | null;
    /** The RECIPIENT's PIN (`recipient_dropoff`). */
    recipientCredential: CustodyCredential | null;
    recipientAdultAttestation: {
      version: string | null;
      attestedAt: string | null;
      /** Required at `protected_handoff` for a consumer-originated request. */
      required: boolean;
    };
    identity: {
      /** Required at `protected_handoff`, per the drop-off custody trigger. */
      required: boolean;
      /** Whether Couranr holds a verification record at all. */
      recorded: boolean;
      provider: string | null;
      /** pending | processing | verified | failed | unavailable | canceled */
      state: string | null;
      identityVerified: boolean | null;
      adultVerified: boolean | null;
      /** Whether the person who took delivery matched the authorized recipient. */
      authorizedRecipientMatch: boolean | null;
      verifiedAt: string | null;
      policyVersion: string | null;
    };
    /** Seal condition must be recorded at `secure_pickup` and above. */
    sealConditionRequired: boolean;
  };

  /** Every proof row for this delivery, in capture order. */
  evidence: CustodyEvidence[];
  claims: CustodyClaim[];
  incidents: CustodyIncident[];

  /**
   * Sections Couranr could NOT read, by name. A named section here means "we
   * do not know", never "there was none" — the screen must say so.
   */
  unavailable: string[];
};

/* ══════════════════════════════════════════════════════════ the builder ══ */

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function stamp(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** One proof row, stripped to what an investigator may hold. */
function evidenceOf(row: any): CustodyEvidence | null {
  if (!row || !row.id) return null;
  return {
    proofId: String(row.id),
    proofStage: String(row.proof_stage ?? ""),
    proofType: String(row.proof_type ?? ""),
    finalizedAt: stamp(row.finalized_at),
    capturedAt: stamp(row.captured_at),
    // Whether media EXISTS is metadata; where it lives is not. Same rule as
    // `listProofMetadata`, and the reason no path reaches this object.
    hasMedia: Boolean(row.storage_object_path),
  };
}

function credentialOf(row: any): CustodyCredential | null {
  if (!row || !row.code_state) return null;
  return {
    state: String(row.code_state),
    // Only a CONSUMED credential was ever accepted. A locked or expired one
    // may still carry a `consumed_at` from a superseded generation, so the
    // state decides, not the presence of the timestamp.
    verifiedAt: row.code_state === "consumed" ? stamp(row.consumed_at) : null,
    issuedAt: stamp(row.issued_at),
    expiresAt: stamp(row.expires_at),
    failedAttempts: num(row.failed_attempts) ?? 0,
    generation: num(row.generation) ?? 1,
  };
}

function placeOf(row: any): CustodyPlace | null {
  if (!row) return null;
  return {
    recordedAt: stamp(row.recorded_at),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    accuracyMeters: num(row.accuracy_m),
  };
}

/** The freshest proof of one type, or null. Rows arrive oldest-first. */
function newestProof(rows: readonly any[], proofType: string, proofStage?: string): any | null {
  let best: any = null;
  for (const r of rows) {
    if (String(r?.proof_type ?? "") !== proofType) continue;
    if (proofStage && String(r?.proof_stage ?? "") !== proofStage) continue;
    best = r;
  }
  return best;
}

/**
 * The proof types the consumer custody sequence names by hand. Kept as named
 * constants so a rename shows up here rather than as a silently empty panel.
 */
export const CUSTODY_PROOF_TYPES = {
  prepack: "item_prepack_photo",
  sealedPackage: "sealed_package_photo",
  dropoffSeal: "dropoff_seal_photo",
} as const;

/** Protection levels the custody triggers govern, in ascending order. */
export const PROTECTION_LEVELS_WITH_CUSTODY: readonly string[] = [
  "secure_pickup",
  "protected_handoff",
];

export type CustodyBundleRows = {
  delivery: Record<string, any>;
  request: Record<string, any> | null;
  proofs: readonly any[];
  seal: Record<string, any> | null;
  identity: Record<string, any> | null;
  handoffRecords: readonly any[];
  handoffCodes: readonly any[];
  claims: readonly any[];
  claimEvidence: readonly any[];
  incidents: readonly any[];
  unavailable: readonly string[];
};

/**
 * Pure. Plain rows in, plain bundle out — no database, no browser, no clock.
 *
 * Built as a strict ALLOW-LIST for the same reason the driver projection is: a
 * column added to `couranr_delivery_proofs` next month must reach nobody until
 * somebody writes a line for it. A deny-list would leak by default, and the
 * one column that would leak is the object path.
 */
export function buildCustodyBundle(rows: CustodyBundleRows): CustodyBundle {
  const d = rows.delivery ?? {};
  const r = rows.request ?? {};
  const proofs = Array.isArray(rows.proofs) ? rows.proofs : [];

  const manifest =
    r.pickup_manifest && typeof r.pickup_manifest === "object" && !Array.isArray(r.pickup_manifest)
      ? r.pickup_manifest
      : {};

  const protectionLevel = text(r.protection_level);
  const protectionPolicyVersion = text(r.protection_policy_version);
  // Mirrors `private.couranr_delivery_protection_level`: a level with no policy
  // version was not written by this policy and is not held to its rules.
  const governed = Boolean(protectionLevel && protectionPolicyVersion);
  const custodyGoverned =
    governed && PROTECTION_LEVELS_WITH_CUSTODY.includes(String(protectionLevel));
  const protectedHandoff = governed && protectionLevel === "protected_handoff";

  const prepack = evidenceOf(newestProof(proofs, CUSTODY_PROOF_TYPES.prepack, "pickup"));
  const sealed = evidenceOf(newestProof(proofs, CUSTODY_PROOF_TYPES.sealedPackage, "pickup"));
  const dropoffSeal = evidenceOf(newestProof(proofs, CUSTODY_PROOF_TYPES.dropoffSeal));

  const pickupRecord =
    rows.handoffRecords.find((h: any) => String(h?.handoff_stage ?? "") === "pickup") ?? null;
  const dropoffRecord =
    rows.handoffRecords.find((h: any) => String(h?.handoff_stage ?? "") === "dropoff") ?? null;

  const pickupCredential = credentialOf(
    newestCode(rows.handoffCodes, "merchant_pickup")
  );
  const recipientCredential = credentialOf(
    newestCode(rows.handoffCodes, "recipient_dropoff")
  );

  const claimEvidenceByReport = new Map<string, CustodyClaimEvidence[]>();
  for (const e of rows.claimEvidence ?? []) {
    // Only a VERIFIED upload is evidence. A pending or abandoned grant is an
    // upload that may never have happened, and showing it as a photo the
    // customer submitted would overstate what Couranr holds.
    if (!e || String(e.upload_state ?? "") !== "verified") continue;
    const key = String(e.report_id ?? "");
    const list = claimEvidenceByReport.get(key) ?? [];
    list.push({ evidenceId: String(e.id), finalizedAt: stamp(e.finalized_at) });
    claimEvidenceByReport.set(key, list);
  }

  return {
    deliveryId: String(d.id ?? ""),
    requestId: String(d.request_id ?? r.id ?? ""),
    reference: text(r.reference),
    fulfillmentState: String(d.fulfillment_state ?? ""),

    declaration: {
      description: text(manifest.description),
      packageCount: num(manifest.packageCount),
      orderReference: text(manifest.orderReference),
      handlingNotes: text(manifest.handlingNotes),
      manifestSource: text(manifest.source),
      manifestPolicyVersion: text(r.pickup_manifest_policy_version),
      declaredValueCents: num(r.declared_value_cents),
      protectionLevel,
      protectionPolicyVersion,
      restrictedClass: text(r.restricted_class),
      protectionGoverned: governed,
    },

    senderTerms: {
      termsVersion: text(r.sender_terms_version),
      termsAcceptedAt: stamp(r.sender_terms_accepted_at),
      electronicConsentAt: stamp(r.sender_electronic_consent_at),
      adultAttestedAt: stamp(r.sender_adult_attested_at),
    },

    pickup: {
      credential: pickupCredential,
      place: placeOf(pickupRecord),
      observedPackageCount: num(pickupRecord?.observed_package_count),
      prepackPhoto: prepack,
      sealedPackagePhoto: sealed,
      documentationRequired: custodyGoverned,
      credentialAfterDocumentation: orderedAfter(
        pickupCredential?.verifiedAt ?? null,
        prepack?.finalizedAt ?? null,
        sealed?.finalizedAt ?? null
      ),
    },

    seal: rows.seal
      ? {
          sealIdentifier: text(rows.seal.seal_identifier),
          appliedAt: stamp(rows.seal.applied_at),
          dropoffCondition: text(rows.seal.dropoff_condition),
          dropoffRecordedAt: stamp(rows.seal.dropoff_recorded_at),
          // Bound by id rather than by type, so the record names the exact
          // photograph the seal was applied to — not merely a photograph of
          // the same kind taken at some point during the pickup.
          sealedPackagePhoto:
            evidenceOf(
              proofs.find((p: any) => String(p?.id) === String(rows.seal?.sealed_package_proof_id))
            ) ?? null,
          dropoffSealPhoto: dropoffSeal,
        }
      : null,

    dropoff: {
      place: placeOf(dropoffRecord),
      proofMethodUsed: text(dropoffRecord?.proof_method_used),
      recipientCredential,
      recipientAdultAttestation: {
        version: text(r.recipient_attestation_version),
        attestedAt: stamp(r.recipient_adult_attested_at),
        required: protectedHandoff && String(r.requester_kind ?? "") === "consumer",
      },
      identity: {
        required: protectedHandoff,
        recorded: Boolean(rows.identity),
        provider: rows.identity ? text(rows.identity.provider) : null,
        state: rows.identity ? text(rows.identity.verification_state) : null,
        identityVerified: rows.identity ? bool(rows.identity.identity_verified) : null,
        adultVerified: rows.identity ? bool(rows.identity.adult_verified) : null,
        authorizedRecipientMatch: rows.identity
          ? bool(rows.identity.authorized_recipient_match)
          : null,
        verifiedAt: rows.identity ? stamp(rows.identity.verified_at) : null,
        policyVersion: rows.identity ? text(rows.identity.policy_version) : null,
      },
      sealConditionRequired: custodyGoverned,
    },

    evidence: proofs.map(evidenceOf).filter((e): e is CustodyEvidence => e !== null),

    claims: (rows.claims ?? []).map((c: any) => ({
      claimId: String(c.id),
      problemType: String(c.problem_type ?? ""),
      details: String(c.details ?? ""),
      state: String(c.report_state ?? ""),
      submittedAt: stamp(c.submitted_at),
      resolvedAt: stamp(c.resolved_at),
      version: num(c.version) ?? 1,
      evidence: claimEvidenceByReport.get(String(c.id)) ?? [],
    })),

    incidents: (rows.incidents ?? []).map((i: any) => ({
      incidentId: String(i.id),
      incidentType: String(i.incident_type ?? ""),
      incidentState: String(i.incident_state ?? ""),
      severity: String(i.severity ?? ""),
      summary: text(i.summary),
      openedAt: stamp(i.opened_at),
      resolvedAt: stamp(i.resolved_at),
      closedAt: stamp(i.closed_at),
      version: num(i.version) ?? 1,
    })),

    unavailable: [...(rows.unavailable ?? [])],
  };
}

/** The freshest credential of one kind. Rows arrive oldest-first. */
function newestCode(codes: readonly any[], kind: string): any | null {
  let best: any = null;
  for (const c of codes ?? []) {
    if (String(c?.code_kind ?? "") !== kind) continue;
    if (!best || (num(c.generation) ?? 0) >= (num(best.generation) ?? 0)) best = c;
  }
  return best;
}

/** True when `after` is at or past every one of `before`. Null if any is absent. */
function orderedAfter(after: string | null, ...before: (string | null)[]): boolean | null {
  if (!after) return null;
  const a = Date.parse(after);
  if (!Number.isFinite(a)) return null;
  for (const b of before) {
    if (!b) return null;
    const t = Date.parse(b);
    if (!Number.isFinite(t)) return null;
    if (a < t) return false;
  }
  return true;
}

/* ═══════════════════════════════════════════════════════════════ the read ══ */

/** Exactly the proof columns the bundle reads. `storage_object_path` is read
 *  ONLY to answer `hasMedia`; it never reaches the projection. */
const PROOF_COLUMNS =
  "id,proof_stage,proof_type,finalized_at,captured_at,storage_object_path";
/** No `code_digest`. The digest is the value an offline attack runs against. */
const CODE_COLUMNS =
  "code_kind,code_state,generation,issued_at,expires_at,failed_attempts,consumed_at";
/** No `provider_reference`. The bundle carries the outcome, not the handle. */
const IDENTITY_COLUMNS =
  "provider,verification_state,identity_verified,adult_verified," +
  "authorized_recipient_match,verified_at,policy_version";
const REQUEST_COLUMNS =
  "id,reference,requester_kind,restricted_class,pickup_manifest," +
  "pickup_manifest_policy_version,declared_value_cents,protection_level," +
  "protection_policy_version,sender_terms_version,sender_terms_accepted_at," +
  "sender_electronic_consent_at,sender_adult_attested_at," +
  "recipient_adult_attested_at,recipient_attestation_version";

/**
 * One optional section. An error marks the section unavailable rather than
 * failing the whole bundle: a missing seal table must not hide the twelve
 * other facts an investigator can still act on — and it must not read as
 * "there was no seal" either, which is what `unavailable` prevents.
 */
async function section<T>(
  name: string,
  unavailable: string[],
  run: () => PromiseLike<{ data: T; error: any }>
): Promise<T | null> {
  const { data, error } = await run();
  if (error) {
    logServerFailure({
      correlationId: newCorrelationId(),
      operation: `custodyBundle.${name}`,
      code: classifyDatabaseError(error),
      detail: { code: error?.code, message: error?.message },
    });
    unavailable.push(name);
    return null;
  }
  return data ?? null;
}

function requireOperations(actor: RequestActor, operation: string): CustodyFailure | null {
  if (actor?.kind === "operations") return null;
  return fail({
    operation,
    code: "not_permitted",
    detail: { reason: "not_operations" },
    message: "Couranr Operations access required.",
  });
}

/**
 * The custody bundle for one delivery.
 *
 * Operations-only, with no ownership walk — reviewing custody across every
 * business IS the Operations capability, exactly as for the proof-URL route
 * this bundle's media links go through. The actor gate is the whole boundary.
 */
export async function readCustodyBundle(p: {
  actor: RequestActor;
  deliveryId: string;
}): Promise<CustodyResult<CustodyBundle>> {
  const op = "readCustodyBundle";
  const denied = requireOperations(p.actor, op);
  if (denied) return denied;

  const delivery = await supabaseAdmin
    .from("couranr_deliveries")
    .select("id,request_id,fulfillment_state")
    .eq("id", p.deliveryId)
    .maybeSingle();

  // The delivery itself is NOT a soft section. Without it there is no bundle,
  // and an empty bundle would read as "this delivery has no custody record".
  if (delivery.error) {
    return fail({
      operation: op,
      code: classifyDatabaseError(delivery.error),
      detail: { code: delivery.error?.code, message: delivery.error?.message },
    });
  }
  if (!delivery.data) {
    return fail({ operation: op, code: "not_found", message: "Delivery not found." });
  }

  const deliveryId = String(delivery.data.id);
  const requestId = String(delivery.data.request_id ?? "");
  const unavailable: string[] = [];

  const request = await section("request", unavailable, () =>
    supabaseAdmin
      .from("couranr_delivery_requests")
      .select(REQUEST_COLUMNS)
      .eq("id", requestId)
      .maybeSingle()
  );

  /*
   * `couranr_deliveries.request_id` is NOT NULL with an ON DELETE RESTRICT
   * foreign key, so every delivery HAS its request. A null row here after a
   * successful read is therefore a surprise, and this is the one place a
   * surprise would be dangerous: with no request row the declaration reads as
   * all-nulls and `protectionGoverned` as false, which an investigator would
   * read as "no protection policy applied to this shipment" rather than "the
   * sender's declaration could not be read". Name it instead.
   */
  if (!request && !unavailable.includes("request")) unavailable.push("request");

  const proofs = await section("evidence", unavailable, () =>
    supabaseAdmin
      .from("couranr_delivery_proofs")
      .select(PROOF_COLUMNS)
      .eq("delivery_id", deliveryId)
      .order("finalized_at", { ascending: true })
  );

  const seal = await section("seal", unavailable, () =>
    supabaseAdmin
      .from("couranr_delivery_security_seals")
      .select(
        "seal_identifier,applied_at,sealed_package_proof_id," +
          "dropoff_condition,dropoff_recorded_at"
      )
      .eq("delivery_id", deliveryId)
      .maybeSingle()
  );

  const identity = await section("identity", unavailable, () =>
    supabaseAdmin
      .from("couranr_recipient_identity_verifications")
      .select(IDENTITY_COLUMNS)
      .eq("delivery_id", deliveryId)
      .neq("verification_state", "canceled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  );

  const handoffRecords = await section("handoff", unavailable, () =>
    supabaseAdmin
      .from("couranr_handoff_records")
      .select(
        "handoff_stage,observed_package_count,latitude,longitude," +
          "accuracy_m,proof_method_used,recorded_at"
      )
      .eq("delivery_id", deliveryId)
      .order("recorded_at", { ascending: false })
  );

  const handoffCodes = await section("credentials", unavailable, () =>
    supabaseAdmin
      .from("couranr_handoff_codes")
      .select(CODE_COLUMNS)
      .eq("delivery_id", deliveryId)
      .order("generation", { ascending: true })
  );

  const claims = await section("claims", unavailable, () =>
    supabaseAdmin
      .from("couranr_customer_problem_reports")
      .select("id,problem_type,details,report_state,submitted_at,resolved_at,version")
      // A draft is the customer's unsent notes, not a claim. Operations never
      // lists one, and the claim bundle must not become the back door that does.
      .neq("report_state", "draft")
      .eq("delivery_id", deliveryId)
      .order("created_at", { ascending: false })
  );

  const claimIds = (claims ?? []).map((c: any) => String(c.id));
  const claimEvidence = claimIds.length
    ? await section("claimEvidence", unavailable, () =>
        supabaseAdmin
          .from("couranr_customer_problem_evidence")
          .select("id,report_id,upload_state,finalized_at")
          .in("report_id", claimIds)
          .order("finalized_at", { ascending: true })
      )
    : [];

  const incidents = await section("incidents", unavailable, () =>
    supabaseAdmin
      .from("couranr_delivery_incidents")
      .select(
        "id,incident_type,incident_state,severity,summary," +
          "opened_at,resolved_at,closed_at,version"
      )
      .eq("delivery_id", deliveryId)
      .order("opened_at", { ascending: false })
  );

  return {
    ok: true,
    value: buildCustodyBundle({
      delivery: delivery.data,
      request: request as any,
      proofs: (proofs as any) ?? [],
      seal: seal as any,
      identity: identity as any,
      handoffRecords: (handoffRecords as any) ?? [],
      handoffCodes: (handoffCodes as any) ?? [],
      claims: (claims as any) ?? [],
      claimEvidence: (claimEvidence as any) ?? [],
      incidents: (incidents as any) ?? [],
      unavailable,
    }),
  };
}
