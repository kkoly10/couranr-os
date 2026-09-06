"use client";

import * as React from "react";
import {
  attemptProofBytes,
  buildOfflineProofEnvelope,
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
  const queuedEnvelope = React.useRef<OfflineProofEnvelope | null>(null);

  const reset = React.useCallback(() => {
    setStatus("idle");
    setProofId(null);
    setQueueId(null);
    setError(null);
    setByteSize(null);
    queuedEnvelope.current = null;
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
    queuedEnvelope.current = null;
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

    const outcome = await attemptProofBytes(envelope, bytes, (next) => setStatus(next));
    if (outcome.kind === "verified") {
      adoptVerified(outcome.proof);
      return;
    }

    try {
      await saveOfflineProof(envelope, bytes, {
        state: outcome.kind === "terminal" ? "terminal" : "pending",
        attempts: outcome.kind === "terminal" ? 1 : 0,
        lastErrorCode: outcome.code,
      });
    } catch {
      setStatus("failed");
      setError("Couranr could not safely save this proof on your device. Keep the page open and try again when you have a connection.");
      return;
    }

    queuedEnvelope.current = envelope;
    setQueueId(envelope.id);
    setStatus("queued");
    setError(
      outcome.kind === "terminal"
        ? "The proof is encrypted on this device and Couranr Operations needs to review the sync."
        : "The proof is encrypted on this device and will retry when the connection returns."
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
