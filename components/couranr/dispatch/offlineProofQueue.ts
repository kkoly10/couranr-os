"use client";

import {
  finalizeProofUpload,
  isDispatchApiFailure,
  reportProofSyncFailure,
  requestProofUpload,
  type ProofMetadataView,
} from "./client";

const DB_NAME = "couranr-proof-queue-v1";
const DB_VERSION = 1;
const ITEM_STORE = "proofs";
const KEY_STORE = "keys";
const DEVICE_KEY_ID = "device-proof-key";

export const MAX_OFFLINE_SYNC_ATTEMPTS = 5;

/**
 * Explicit persisted shape. Signed URLs, upload tokens, auth tokens, server
 * object paths and contact/order data are intentionally absent.
 */
export const OFFLINE_PROOF_PERSISTED_FIELDS = [
  "id",
  "envelope",
  "ciphertext",
  "iv",
  "state",
  "attempts",
  "lastAttemptAt",
  "lastErrorCode",
  "alertReported",
] as const;

export type OfflineProofEnvelope = {
  id: string;
  deliveryId: string;
  stage: string;
  proofType: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  capturedAt: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  discrepancyId: string | null;
};

export type OfflineProofQueueState = "pending" | "retrying" | "terminal";

type StoredOfflineProof = {
  id: string;
  envelope: OfflineProofEnvelope;
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  state: OfflineProofQueueState;
  attempts: number;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
  alertReported: boolean;
};

export type OfflineProofSummary = Omit<StoredOfflineProof, "ciphertext" | "iv">;

export type ProofSyncOutcome =
  | { kind: "verified"; proof: ProofMetadataView }
  | { kind: "retryable"; code: string }
  | {
      kind: "terminal";
      code: string;
      reason:
        | "local_evidence_corrupt"
        | "assignment_or_stage_changed"
        | "server_rejected"
        | "retry_limit";
    };

const CHANGE_EVENT = "couranr:offline-proof-queue-changed";

function emitChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onOfflineProofQueueChanged(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

function request<T = unknown>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb_request_failed"));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb_transaction_failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb_transaction_aborted"));
  });
}

async function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") throw new Error("offline_storage_unavailable");
  const open = indexedDB.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    const d = open.result;
    if (!d.objectStoreNames.contains(ITEM_STORE)) d.createObjectStore(ITEM_STORE, { keyPath: "id" });
    if (!d.objectStoreNames.contains(KEY_STORE)) d.createObjectStore(KEY_STORE);
  };
  return request(open);
}

async function encryptionKey(): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) throw new Error("offline_encryption_unavailable");
  const d = await db();
  const readTx = d.transaction(KEY_STORE, "readonly");
  const existing = await request(readTx.objectStore(KEY_STORE).get(DEVICE_KEY_ID));
  await transactionDone(readTx);
  if (existing instanceof CryptoKey) return existing;

  /*
   * Non-extractable. The key can be structured-cloned by IndexedDB but cannot
   * be exported into app state, logs or a network request.
   */
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const writeTx = d.transaction(KEY_STORE, "readwrite");
  writeTx.objectStore(KEY_STORE).put(key, DEVICE_KEY_ID);
  await transactionDone(writeTx);
  return key;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("digest_unavailable");
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

export async function buildOfflineProofEnvelope(input: {
  deliveryId: string;
  stage: string;
  proofType: string;
  mimeType: string;
  bytes: ArrayBuffer;
  capturedAt: string;
  latitude: number;
  longitude: number;
  accuracyM: number | null;
  discrepancyId?: string | null;
  id?: string;
}): Promise<OfflineProofEnvelope> {
  return {
    id: input.id ?? crypto.randomUUID(),
    deliveryId: input.deliveryId,
    stage: input.stage,
    proofType: input.proofType,
    mimeType: input.mimeType,
    byteSize: input.bytes.byteLength,
    sha256: await sha256(input.bytes),
    capturedAt: input.capturedAt,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyM: input.accuracyM,
    discrepancyId: input.discrepancyId ?? null,
  };
}

function envelopeFingerprint(e: OfflineProofEnvelope): string {
  return JSON.stringify([
    e.id,e.deliveryId,e.stage,e.proofType,e.mimeType,e.byteSize,e.sha256,e.capturedAt,
    e.latitude,e.longitude,e.accuracyM,e.discrepancyId,
  ]);
}

export function sameOfflineEnvelope(a: OfflineProofEnvelope, b: OfflineProofEnvelope): boolean {
  return envelopeFingerprint(a) === envelopeFingerprint(b);
}

async function getStored(id: string): Promise<StoredOfflineProof | null> {
  const d = await db();
  const tx = d.transaction(ITEM_STORE, "readonly");
  const row = (await request(tx.objectStore(ITEM_STORE).get(id))) as StoredOfflineProof | undefined;
  await transactionDone(tx);
  return row ?? null;
}

async function putStored(row: StoredOfflineProof): Promise<void> {
  const d = await db();
  const tx = d.transaction(ITEM_STORE, "readwrite");
  tx.objectStore(ITEM_STORE).put(row);
  await transactionDone(tx);
  emitChanged();
}

async function deleteStored(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(ITEM_STORE, "readwrite");
  tx.objectStore(ITEM_STORE).delete(id);
  await transactionDone(tx);
  emitChanged();
}

export async function saveOfflineProof(
  envelope: OfflineProofEnvelope,
  bytes: ArrayBuffer,
  initial: { state?: OfflineProofQueueState; attempts?: number; lastErrorCode?: string | null } = {}
): Promise<void> {
  const existing = await getStored(envelope.id);
  if (existing) {
    if (!sameOfflineEnvelope(existing.envelope, envelope)) throw new Error("offline_evidence_identity_conflict");
    return;
  }

  const key = await encryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);

  await putStored({
    id: envelope.id,
    envelope,
    ciphertext,
    iv,
    state: initial.state ?? "pending",
    attempts: initial.attempts ?? 0,
    lastAttemptAt: null,
    lastErrorCode: initial.lastErrorCode ?? null,
    alertReported: false,
  });
}

export async function listOfflineProofs(deliveryId?: string): Promise<OfflineProofSummary[]> {
  const d = await db();
  const tx = d.transaction(ITEM_STORE, "readonly");
  const rows = (await request(tx.objectStore(ITEM_STORE).getAll())) as StoredOfflineProof[];
  await transactionDone(tx);
  return rows
    .filter((r) => !deliveryId || r.envelope.deliveryId === deliveryId)
    .sort((a, b) => a.envelope.capturedAt.localeCompare(b.envelope.capturedAt))
    .map(({ ciphertext: _c, iv: _i, ...safe }) => safe);
}

async function decrypt(row: StoredOfflineProof): Promise<ArrayBuffer> {
  const key = await encryptionKey();
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: row.iv }, key, row.ciphertext);
}

export function classifyProofSyncFailure(status: number, code?: string): ProofSyncOutcome {
  if (status === 0 || status >= 500 || status === 408 || status === 429) {
    return { kind: "retryable", code: code ?? `http_${status}` };
  }
  if (status === 403 || status === 404 || status === 409) {
    return {
      kind: "terminal",
      code: code ?? `http_${status}`,
      reason: "assignment_or_stage_changed",
    };
  }
  return {
    kind: "terminal",
    code: code ?? `http_${status}`,
    reason: "server_rejected",
  };
}

export async function attemptProofBytes(
  envelope: OfflineProofEnvelope,
  bytes: ArrayBuffer,
  onStage?: (stage: "authorizing" | "uploading" | "finalizing") => void
): Promise<ProofSyncOutcome> {
  onStage?.("authorizing");
  const prepared = await requestProofUpload(envelope.deliveryId, {
    stage: envelope.stage,
    proofType: envelope.proofType,
    expectedMime: envelope.mimeType,
    expectedBytes: envelope.byteSize,
    clientEvidenceId: envelope.id,
    evidenceSha256: envelope.sha256,
    capturedAt: envelope.capturedAt,
    latitude: envelope.latitude,
    longitude: envelope.longitude,
    accuracyM: envelope.accuracyM,
    discrepancyId: envelope.discrepancyId,
  });
  if (isDispatchApiFailure(prepared)) {
    return classifyProofSyncFailure(prepared.status, prepared.code);
  }

  const grant = prepared.value.upload;
  if (grant.status === "verified") {
    return { kind: "verified", proof: grant.proof };
  }
  if (!grant.signedUrl || !grant.uploadId) {
    return { kind: "terminal", code: "missing_upload_grant", reason: "server_rejected" };
  }

  onStage?.("uploading");
  let put: Response;
  try {
    put = await fetch(grant.signedUrl, {
      method: "PUT",
      headers: { "content-type": envelope.mimeType },
      body: bytes,
    });
  } catch {
    return { kind: "retryable", code: "storage_network_error" };
  }
  if (!put.ok) {
    return put.status >= 500 || put.status === 408 || put.status === 429
      ? { kind: "retryable", code: `storage_http_${put.status}` }
      : { kind: "retryable", code: `storage_http_${put.status}` };
  }

  onStage?.("finalizing");
  const finalized = await finalizeProofUpload({ uploadId: grant.uploadId });
  if (isDispatchApiFailure(finalized)) {
    return classifyProofSyncFailure(finalized.status, finalized.code);
  }
  return { kind: "verified", proof: finalized.value.proof };
}

async function ensureTerminalAlert(row: StoredOfflineProof): Promise<StoredOfflineProof> {
  if (row.state !== "terminal" || row.alertReported) return row;
  const result = await reportProofSyncFailure(row.envelope.deliveryId, {
    clientEvidenceId: row.envelope.id,
    stage: row.envelope.stage,
    proofType: row.envelope.proofType,
    reason:
      row.lastErrorCode === "local_evidence_corrupt"
        ? "local_evidence_corrupt"
        : row.lastErrorCode === "retry_limit"
          ? "retry_limit"
          : row.lastErrorCode?.startsWith("http_4") ||
              row.lastErrorCode === "evidence_identity_conflict"
            ? "assignment_or_stage_changed"
            : "server_rejected",
    attempts: Math.max(1, row.attempts),
  });
  if (isDispatchApiFailure(result)) return row;
  const next = { ...row, alertReported: true };
  await putStored(next);
  return next;
}

export async function syncOfflineProof(id: string): Promise<ProofSyncOutcome> {
  let row = await getStored(id);
  if (!row) return { kind: "terminal", code: "queue_item_missing", reason: "server_rejected" };

  if (row.state === "terminal") {
    row = await ensureTerminalAlert(row);
    return {
      kind: "terminal",
      code: row.lastErrorCode ?? "terminal",
      reason: row.lastErrorCode === "local_evidence_corrupt"
        ? "local_evidence_corrupt"
        : row.lastErrorCode === "retry_limit"
          ? "retry_limit"
          : "server_rejected",
    };
  }

  const attempts = row.attempts + 1;
  row = { ...row, state: "retrying", attempts, lastAttemptAt: new Date().toISOString() };
  await putStored(row);

  let bytes: ArrayBuffer;
  try {
    bytes = await decrypt(row);
    if ((await sha256(bytes)) !== row.envelope.sha256 || bytes.byteLength !== row.envelope.byteSize) {
      row = { ...row, state: "terminal", lastErrorCode: "local_evidence_corrupt" };
      await putStored(row);
      await ensureTerminalAlert(row);
      return { kind: "terminal", code: "local_evidence_corrupt", reason: "local_evidence_corrupt" };
    }
  } catch {
    row = { ...row, state: "terminal", lastErrorCode: "local_evidence_corrupt" };
    await putStored(row);
    await ensureTerminalAlert(row);
    return { kind: "terminal", code: "local_evidence_corrupt", reason: "local_evidence_corrupt" };
  }

  const outcome = await attemptProofBytes(row.envelope, bytes);
  if (outcome.kind === "verified") {
    await deleteStored(id);
    return outcome;
  }

  if (outcome.kind === "retryable" && attempts < MAX_OFFLINE_SYNC_ATTEMPTS) {
    await putStored({ ...row, state: "pending", lastErrorCode: outcome.code });
    return outcome;
  }

  const terminalCode =
    outcome.kind === "retryable" ? "retry_limit" : outcome.code;
  const terminal = { ...row, state: "terminal" as const, lastErrorCode: terminalCode };
  await putStored(terminal);
  await ensureTerminalAlert(terminal);
  return outcome.kind === "retryable"
    ? { kind: "terminal", code: "retry_limit", reason: "retry_limit" }
    : outcome;
}

export async function syncPendingOfflineProofs(deliveryId?: string): Promise<ProofSyncOutcome[]> {
  const rows = await listOfflineProofs(deliveryId);
  const outcomes: ProofSyncOutcome[] = [];
  for (const row of rows) {
    if (row.state === "terminal") {
      const stored = await getStored(row.id);
      if (stored) await ensureTerminalAlert(stored);
      continue;
    }
    outcomes.push(await syncOfflineProof(row.id));
  }
  return outcomes;
}
