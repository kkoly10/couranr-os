/**
 * Environment access that fails at USE time, not at import time.
 *
 * `next build` collects page data by importing every route module. Anything
 * that reads a required secret at module scope therefore throws during the
 * build, which is why a clean clone could not build without production secrets
 * injected. Reading through these helpers keeps import side-effect free.
 *
 * Server secrets are never returned to the browser: only `NEXT_PUBLIC_*` names
 * are inlined by Next, and nothing here logs a value.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Names only. Never interpolate the value into an error.
    throw new Error(`${name} is required.`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return value ? value : undefined;
}

/**
 * True when a required env var is absent. Useful for routes that want to return
 * a 503 rather than throw when they are invoked without configuration.
 */
export function hasEnv(name: string): boolean {
  return Boolean(process.env[name]);
}
