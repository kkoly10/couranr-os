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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
