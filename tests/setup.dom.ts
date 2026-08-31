/**
 * Test setup. Runs for every suite; the DOM-only work is guarded so node-env
 * suites are unaffected.
 */
if (typeof document !== "undefined") {
  // Node 26 exposes an experimental global `localStorage` property whose value
  // is undefined unless --localstorage-file is supplied. Vitest's jsdom global
  // bridge can copy that value over jsdom's real Storage object. Restore a
  // standards-shaped in-memory store for DOM tests only; production is
  // unaffected and tests can still assert that sensitive values are not kept.
  const makeStorage = (): Storage => {
    const values = new Map<string, string>();
    return {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key) => values.get(String(key)) ?? null,
      key: (index) => [...values.keys()][index] ?? null,
      removeItem: (key) => values.delete(String(key)),
      setItem: (key, value) => values.set(String(key), String(value)),
    };
  };
  if (!window.localStorage) {
    Object.defineProperty(window, "localStorage", { value: makeStorage(), configurable: true });
  }
  if (!window.sessionStorage) {
    Object.defineProperty(window, "sessionStorage", { value: makeStorage(), configurable: true });
  }
  const { cleanup } = await import("@testing-library/react");
  const { afterEach } = await import("vitest");
  afterEach(() => cleanup());
}

export {};
