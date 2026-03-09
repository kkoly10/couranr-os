const STORAGE_KEY = "couranr.activeBusinessAccountId";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: string | null | undefined) {
  return !!v && UUID_RE.test(v);
}

export function getStoredBusinessAccountId() {
  if (typeof window === "undefined") return null;
  const v = String(window.localStorage.getItem(STORAGE_KEY) || "").trim();
  return isUuid(v) ? v : null;
}

export function setStoredBusinessAccountId(id: string | null) {
  if (typeof window === "undefined") return;
  if (!id) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const v = String(id).trim();
  if (isUuid(v)) {
    window.localStorage.setItem(STORAGE_KEY, v);
  }
}

export function resolveBusinessAccountId(candidate?: string | null) {
  const c = String(candidate || "").trim();
  if (isUuid(c)) return c;
  return getStoredBusinessAccountId();
}
