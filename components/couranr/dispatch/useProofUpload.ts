"use client";

import * as React from "react";
import { isApiFailure, withReference } from "@/components/couranr/requests/client";
import { finalizeProofUpload, requestProofUpload } from "./client";
import type { LocationState } from "./useLocationCapture";

/**
 * The three-step proof upload, as one hook.
 *
 *   1. read the chosen file into MEMORY
 *   2. ask the server for an authorization + signed destination
 *   3. PUT the bytes, then finalize against what the server reads back
 *
 * STEP 1 IS NOT AN OPTIMIZATION. A disk-backed `File` from an `<input>` is
 * silently stripped in the browser harness — the page gets HTTP 200 and the
 * stored object is EMPTY. Holding an ArrayBuffer means the same code path
 * works under test and in production, and the exact-byte-count check at
 * finalization catches any truncation either way.
 *
 * `finalized` is the ONLY state that means the proof exists. A selected file
 * is not proof; an uploaded file is not proof. The server reads the object's
 * real size and type back from storage and refuses on any mismatch, so this
 * hook never reports success from a client-side fact.
 */

export type ProofUploadStatus =
  | "idle"
  | "reading"
  | "authorizing"
  | "uploading"
  | "finalizing"
  | "finalized"
  | "failed";

export type ProofUploadState = {
  status: ProofUploadStatus;
  proofId: string | null;
  error: string | null;
  byteSize: number | null;
  /** True only once a canonical proof record exists on the server. */
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
}): ProofUploadState {
  const [status, setStatus] = React.useState<ProofUploadStatus>("idle");
  const [proofId, setProofId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [byteSize, setByteSize] = React.useState<number | null>(null);

  const reset = React.useCallback(() => {
    setStatus("idle");
    setProofId(null);
    setError(null);
    setByteSize(null);
  }, []);

  const upload = React.useCallback(
    async (file: File) => {
      setError(null);
      setProofId(null);
      setStatus("reading");

      // Into memory FIRST. Everything after this point works on bytes we hold.
      let bytes: ArrayBuffer;
      try {
        bytes = await file.arrayBuffer();
      } catch {
        setStatus("failed");
        setError("That file could not be read. Take the photo again.");
        return;
      }
      const expectedBytes = bytes.byteLength;
      if (expectedBytes <= 0) {
        setStatus("failed");
        setError("That file is empty. Take the photo again.");
        return;
      }

      setStatus("authorizing");
      const ticket = await requestProofUpload(params.deliveryId, {
        stage: params.stage,
        proofType: params.proofType,
        expectedMime: file.type,
        expectedBytes,
      });
      if (isApiFailure(ticket)) {
        setStatus("failed");
        setError(withReference(ticket));
        return;
      }

      // `{ upload: … }` — the route's nested key, like every other driver route.
      const grant = ticket.value.upload;
      if (!grant?.signedUrl || !grant?.uploadId) {
        // Reading the wrong key used to leave this undefined, and
        // `fetch(undefined)` resolves against the PAGE url — Next answered with
        // an HTML page and a 200, so the upload "succeeded" having stored
        // nothing. Refuse explicitly rather than PUT to wherever that lands.
        setStatus("failed");
        setError("Couranr could not start that upload. Try again.");
        return;
      }

      setStatus("uploading");
      try {
        // A raw body, not FormData: multipart with a disk-backed part is the
        // shape that loses its bytes under the harness relay.
        const put = await fetch(grant.signedUrl, {
          method: "PUT",
          headers: { "content-type": file.type },
          body: bytes,
        });
        if (!put.ok) {
          setStatus("failed");
          setError("The upload did not complete. Try again.");
          return;
        }
      } catch {
        setStatus("failed");
        setError("The upload did not complete. Try again.");
        return;
      }

      setStatus("finalizing");
      const fin = await finalizeProofUpload({
        uploadId: grant.uploadId,
        latitude: params.location.fix?.latitude ?? null,
        longitude: params.location.fix?.longitude ?? null,
        accuracyM: params.location.fix?.accuracyM ?? null,
        discrepancyId: params.discrepancyId ?? null,
      });
      if (isApiFailure(fin)) {
        // The server compared what it read from storage against what it
        // authorized. A truncated object lands here, not in `finalized`.
        setStatus("failed");
        setError(withReference(fin));
        return;
      }

      setByteSize(fin.value.proof.byteSize ?? null);
      setProofId(fin.value.proof.proofId);
      setStatus("finalized");
      params.onFinalized?.(fin.value.proof.proofId);
    },
    [params]
  );

  return {
    status,
    proofId,
    error,
    byteSize,
    finalized: status === "finalized" && proofId !== null,
    upload,
    reset,
  };
}
