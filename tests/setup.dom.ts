/**
 * Test setup. Runs for every suite; the DOM-only work is guarded so node-env
 * suites are unaffected.
 */
if (typeof document !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  const { afterEach } = await import("vitest");
  afterEach(() => cleanup());
}

export {};
