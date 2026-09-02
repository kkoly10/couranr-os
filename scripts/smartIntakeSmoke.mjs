#!/usr/bin/env node
/**
 * Smart Intake live smoke — runs the REAL Anthropic adapter against nine
 * synthetic shipment descriptions and prints, per item, only: schema-valid
 * yes/no, proposed fact keys + values, latency, token usage and the model
 * string. Never the key.
 *
 * The adapter is TypeScript behind `@/` path aliases, and this repo has no
 * script build step and no `tsx`, so the smoke itself is a Vitest file
 * (`tests/live/smartIntakeAnthropic.live.test.ts`) that is SKIPPED unless
 * `COURANR_LIVE_SMOKE=1` and `ANTHROPIC_API_KEY` are both set. This script is
 * the one-command entry point: it refuses early without a key so nobody
 * reads "0 passed, skipped" as a smoke that ran.
 */

import { spawnSync } from "node:child_process";

const LIVE_FILE = "tests/live/smartIntakeAnthropic.live.test.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "smoke:smart-intake: ANTHROPIC_API_KEY is not set; the live smoke did NOT run. Export the key and re-run."
  );
  process.exit(2);
}

const result = spawnSync("npx", ["vitest", "run", "-c", "vitest.live.config.ts", LIVE_FILE], {
  stdio: "inherit",
  env: { ...process.env, COURANR_LIVE_SMOKE: "1" },
});

process.exit(result.status ?? 1);
