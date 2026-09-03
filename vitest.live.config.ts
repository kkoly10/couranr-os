import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * The LIVE Smart Intake provider smoke — real Anthropic credential, real
 * network, real money. Never part of `npm run test:run` or the local gate
 * (vitest.config.ts excludes tests/live); run it deliberately through
 * `npm run smoke:smart-intake`, which refuses to start without a key.
 */
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["tests/live/**/*.live.test.ts"],
    testTimeout: 180_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
