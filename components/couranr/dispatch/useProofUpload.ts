"use client";

import * as React from "react";
import {
  buildOfflineProofEnvelope,
  findOfflineProof,
  offlineProofQueueSupported,
  saveOfflineProof,
  syncOfflineProof,
  type OfflineProofEnvelope,
} from "./offlineProofQueue";
import type { LocationState } from "./useLocationCapture";

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

const QUEUED_MESSAGE =
  "The proof is encrypted on this device and will retry when the connection returns.";
const TERMINAL_MESSAGE =
  "The proof is encrypted on this device and Couranr Operations needs to review the sync.";

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

  const uploadInFlight = React.useRef(false);
  const durableEvidenceId = React.useRef<string | null>(null);
  const finalizedProofId = React.useRef<string | null>(null);
  const recoveryStarted = React.useRef(false);

  const reset = React.useCallback(() => {
    if (uploadInFlight.current || durableEvidenceId.current || finalizedProofId.current) return;
    setStatus("idle");
    setProofId(null);
    setQueueId(null);
    setError(null);
    setByteSize(null);
  }, []);

  const recorded = params.recordedProofId ?? null;
  React.useEffect(() => {
    if (!recorded) return;
    finalizedProofId.current = recorded;
    durableEvidenceId.current = null;
    setStatus((s) => (s === "idle" || s === "queued" ? "finalized" : s));
    setProofId((p) => p ?? recorded);
    setQueueId(null);
  }, [recorded]);

  const adoptVerified = React.useCallback((proof: { proofId: string; byteSize?: number | null }) => {
    finalizedProofId.current = proof.proofId;
    durableEvidenceId.current = null;
    setByteSize(proof.byteSize ?? null);
    setProofId(proof.proofId);
    setQueueId(null);
    setError(null);
    setStatus("finalized");
    params.onFinalized?.(proof.proofId);
  }, [params.onFinalized]);

  /*
   * RELOAD RECOVERY: rediscover the durable evidence slot and reconcile the
   * exact encrypted bytes instead of asking the driver to capture again.
   */
  React.useEffect(() => {
    if (recorded || recoveryStarted.current || !offlineProofQueueSupported()) return;
    recoveryStarted.current = true;
    let live = true;

    void (async () => {
      let queued;
      try {
        queued = await findOfflineProof(
          params.deliveryId,
          params.stage,
          params.proofType,
          params.discrepancyId ?? null
        );
      } catch {
        if (!live) return;
        setStatus("failed");
        setError("This browser could not open Couranr's encrypted proof store.");
        return;
      }
      if (!live || !queued) return;

      durableEvidenceId.current = queued.id;
      setQueueId(queued.id);
      setByteSize(queued.envelope.byteSize);
      setStatus("queued");
      setError(queued.state === "terminal" ? TERMINAL_MESSAGE : QUEUED_MESSAGE);

      if (typeof navigator === "undefined" || !navigator.onLine) return;
      try {
        const outcome = await syncOfflineProof(queued.id, (next) => {
          if (live) setStatus(next);
        });
        if (!live) return;
        if (outcome.kind === "verified") {
          adoptVerified(outcome.proof);
          return;
        }
        setStatus("queued");
        setError(outcome.kind === "terminal" ? TERMINAL_MESSAGE : QUEUED_MESSAGE);
      } catch {
        if (!live) return;
        setStatus("queued");
        setError(QUEUED_MESSAGE);
      }
    })();

    return () => {
      live = false;
    };
  }, [
    recorded,
    params.deliveryId,
    params.stage,
    params.proofType,
    params.discrepancyId,
    adoptVerified,
  ]);

  React.useEffect(() => {
    if (status !== "queued" || !queueId) return;
    const retry = async () => {
      if (!navigator.onLine) return;
      try {
        const outcome = await syncOfflineProof(queueId, (next) => setStatus(next));
        if (outcome.kind === "verified") adoptVerified(outcome.proof);
        else {
          setStatus("queued");
          setError(outcome.kind === "terminal" ? TERMINAL_MESSAGE : QUEUED_MESSAGE);
        }
      } catch {
        setStatus("queued");
        setError(QUEUED_MESSAGE);
      }
    };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [status, queueId, adoptVerified]);

  const upload = React.useCallback(async (file: File) => {
    if (uploadInFlight.current || durableEvidenceId.current || finalizedProofId.current) return;

    setError(null);
    setProofId(null);
    setQueueId(null);
    setStatus("reading");

    if (!params.location.fix || !params.location.usable) {
      setStatus("failed");
      setError(params.location.message);
      return;
    }

    // No durable store means no first network attempt.
    if (!offlineProofQueueSupported()) {
      setStatus("failed");
      setError(
        "This browser cannot safely store delivery proof before upload. Use a current browser with site storage enabled, then try again."
      );
      return;
    }

    uploadInFlight.current = true;
    try {
      let bytes: ArrayBuffer;
      try {
        bytes = await file.arrayBuffer();
      } catch {
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

      try {
        await saveOfflineProof(envelope, bytes);
      } catch {
        setStatus("failed");
        setError(
          "This browser could not open Couranr's encrypted proof store. The proof was not sent. Free device storage or enable site storage, then try again."
        );
        return;
      }

      durableEvidenceId.current = envelope.id;
      setQueueId(envelope.id);
      setByteSize(envelope.byteSize);

      try {
        const outcome = await syncOfflineProof(envelope.id, (next) => setStatus(next));
        if (outcome.kind === "verified") {
          adoptVerified(outcome.proof);
          return;
        }
        setStatus("queued");
        setError(outcome.kind === "terminal" ? TERMINAL_MESSAGE : QUEUED_MESSAGE);
      } catch {
        setStatus("queued");
        setError(QUEUED_MESSAGE);
      }
    } finally {
      uploadInFlight.current = false;
    }
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
