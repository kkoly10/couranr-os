import {
  readAdapterEnv,
  resolveAdapterMode,
  type AdapterEnv,
} from "@/lib/couranr/sameday/adapterMode";

/**
 * Server-side kill switch for the Consumer Same Day backend.
 *
 * The /send page has always resolved adapter mode server-side, but the API
 * routes are public URLs too. They must independently fail closed or a caller
 * can bypass the disabled page and mint guest sessions / spend provider budget
 * directly.
 */
export function consumerSendServerLive(env: AdapterEnv = readAdapterEnv()): boolean {
  return resolveAdapterMode(env).mode === "live";
}

/**
 * VERCEL_ENV wins for the same reason it does in adapterMode.ts: previews use
 * NODE_ENV=production. Outside Vercel, NODE_ENV=production is the fallback.
 */
export function consumerSendProductionEnvironment(
  env: AdapterEnv = readAdapterEnv()
): boolean {
  const vercel = String(env.vercelEnv ?? "").toLowerCase();
  const node = String(env.nodeEnv ?? "").toLowerCase();
  return vercel ? vercel === "production" : node === "production";
}
