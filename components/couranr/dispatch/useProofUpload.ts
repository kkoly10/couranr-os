"use client";

import * as React from "react";
import {
  attemptProofBytes,
  buildOfflineProofEnvelope,
  offlineProofQueueSupported,
  saveOfflineProof,
  syncOfflineProof,
  type OfflineProofEnvelope,
} from "./offlineProofQueue";
import type { LocationState } from "./useLocationCapture";

/**
 * One proof capture with an offline-safe evidence identity.
 *
 * A file is never proof until the server verifies it. When connectivity fails,
 * the exact bytes are encrypted into IndexedDB with a non-extractable device
 * key. The queue stores no auth token, signed URL, upload token or server path.
 */
export type ProofUploadStatus =
  | "idle"
  | "reading"
  | "authorizing"
  | "uploading"
  | "finalizing"
  | "queued"
  | "finalized"
  | "failed";

export type ProofUploadState = {
  status: ProofUploadStatus;
  proofId: string | null;
  queueId: string | null;
  error: string | null;
  byteSize: number | null;
  finalized: boolean;
  upload: (file: File) => Promise<void>;
  reset: () => void;
};

export function useProofUpload(params: {
  deliveryId: string;
  stage: string;
  proofType: string;
  location: LocationState;
  discrepancyId?: string | null;
  onFinalized?: (proofId: string) => void;
  recordedProofId?: string | null;
}): ProofUploadState {
  const [status, setStatus] = React.useState<ProofUploadStatus>("idle");
  const [proofId, setProofId] = React.useState<string | null>(null);
  const [queueId, setQueueId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [byteSize, setByteSize] = React.useState<number | null>(null);

  const reset = React.useCallback(() => {
    setStatus("idle");
    setProofId(null);
    setQueueId(null);
    setError(null);
    setByteSize(null);
  }, []);

  const recorded = params.recordedProofId ?? null;
  React.useEffect(() => {
    if (!recorded) return;
    setStatus((s) => (s === "idle" || s === "queued" ? "finalized" : s));
    setProofId((p) => p ?? recorded);
    setQueueId(null);
  }, [recorded]);

  const adoptVerified = React.useCallback((proof: { proofId: string; byteSize?: number | null }) => {
    setByteSize(proof.byteSize ?? null);
    setProofId(proof.proofId);
    setQueueId(null);
    setError(null);
    setStatus("finalized");
    params.onFinalized?.(proof.proofId);
  }, [params]);

  React.useEffect(() => {
    if (status !== "queued" || !queueId) return;
    const retry = async () => {
      if (!navigator.onLine) return;
      const outcome = await syncOfflineProof(queueId);
      if (outcome.kind === "verified") adoptVerified(outcome.proof);
      else if (outcome.kind === "terminal") {
        setError("Couranr Operations needs to review this proof sync.");
      }
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [status, queueId, adoptVerified]);

  const upload = React.useCallback(async (file: File) => {
    setError(null);
    setProofId(null);
    setQueueId(null);
    setStatus("reading");

    if (!params.location.fix || !params.location.usable) {
      setStatus("failed");
      setError(params.location.message);
      return;
    }

    let bytes: ArrayBuffer;
    try { bytes = await file.arrayBuffer(); }
    catch {
      setStatus("failed");
      setError("That file could not be read. Take the photo again.");
      return;
    }
    if (bytes.byteLength <= 0) {
      setStatus("failed");
      setError("That file is empty. Take the photo again.");
      return;
    }

    let envelope: OfflineProofEnvelope;
    try {
      envelope = await buildOfflineProofEnvelope({
        deliveryId: params.deliveryId,
        stage: params.stage,
        proofType: params.proofType,
        mimeType: file.type,
        bytes,
        capturedAt: new Date().toISOString(),
        latitude: params.location.fix.latitude,
        longitude: params.location.fix.longitude,
        accuracyM: params.location.fix.accuracyM ?? null,
        discrepancyId: params.discrepancyId ?? null,
      });
    } catch {
      setStatus("failed");
      setError("This browser could not prepare the proof safely.");
      return;
    }

    /*
     * CRASH WINDOW RULE. On browsers that support the offline queue, persist
     * the immutable evidence BEFORE asking Couranr for an upload grant. A tab
     * close after PUT/finalize but before the response is therefore recoverable:
     * the stable evidence UUID remains on-device, and the next sync converges
     * against the server instead of creating new physical evidence.
     *
     * Unsupported browsers retain the ordinary online path, but they are never
     * told that failed proof is safely queued offline.
     */
    if (offlineProofQueueSupported()) {
      try {
        await saveOfflineProof(envelope, bytes);
      } catch {
        setStatus("failed");
        setError(
          "This browser could not open Couranr's encrypted proof store. The photo was not sent. Free device storage or use a supported browser, then try again."
        );
        return;
      }

      const outcome = await syncOfflineProof(envelope.id, (next) => setStatus(next));
      if (outcome.kind === "verified") {
        adoptVerified(outcome.proof);
        return;
      }

      setQueueId(envelope.id);
      setStatus("queued");
      setError(
        outcome.kind === "terminal"
          ? "The proof is encrypted on this device and Couranr Operations needs to review the sync."
          : "The proof is encrypted on this device and will retry when the connection returns."
      );
      return;
    }

    const outcome = await attemptProofBytes(envelope, bytes, (next) => setStatus(next));
    if (outcome.kind === "verified") {
      adoptVerified(outcome.proof);
      return;
    }

    setStatus("failed");
    setError(
      "This browser cannot keep failed proof safely offline. The delivery was not advanced. Reconnect or use a supported browser, then try again."
    );
  }, [params, adoptVerified]);

  return {
    status,
    proofId,
    queueId,
    error,
    byteSize,
    finalized: status === "finalized" && proofId !== null,
    upload,
    reset,
  };
}
