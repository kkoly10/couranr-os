/**
 * Server-only guard.
 *
 * The `server-only` package is not a dependency of this repo, so this stands in
 * for it. Call `assertServerOnly` at module scope in any module that touches the
 * service-role key, a Bearer token or a named server command.
 *
 * This is a runtime tripwire, not a compile-time barrier. The compile-time
 * enforcement is `tests/couranr-server-only.test.ts`, which fails the build if
 * any `"use client"` file reaches a guarded module through its import graph.
 *
 * Both exist because of the bug this repo already has: six server-context files
 * import the `"use client"` browser Supabase client, so they authenticate as
 * `anon` instead of the caller. A guard on only one side would not have caught
 * it.
 */
export function assertServerOnly(moduleName: string): void {
  if (typeof window !== "undefined") {
    throw new Error(
      `${moduleName} is server-only and must never be imported into a client component.`
    );
  }
}
