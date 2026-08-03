import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Most suites are pure logic and run fastest in node. Only component tests
    // need a DOM, so jsdom is applied by glob rather than globally.
    environment: "node",
    environmentMatchGlobs: [["tests/**/*.dom.test.tsx", "jsdom"]],
    globals: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["tests/setup.dom.ts"],
    /**
     * 15s, not the 5s default.
     *
     * The component tests render, run an effect that awaits a doubled request,
     * and then `waitFor` the result. In isolation that is milliseconds; with all
     * 35 files running in parallel a jsdom render can miss 5s, and one did —
     * `DRV-001 renders active as live work` timed out once in six full-suite
     * runs while passing 3/3 on its own.
     *
     * This CANNOT hide a broken assertion. Every wait here is a `waitFor` on
     * content that must appear; if it never appears the test still fails, just
     * later. What it removes is a failure that depends on machine load, which is
     * the kind of red that teaches people to re-run instead of to look.
     */
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
