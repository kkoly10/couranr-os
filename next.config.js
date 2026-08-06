/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The disposable browser harness must build with its own
  // NEXT_PUBLIC_SUPABASE_URL baked in — those variables are INLINED AT BUILD
  // TIME, not read at runtime, so a build made against the real project leaves
  // the browser client pointing at a host the harness cannot reach. Giving it a
  // separate output directory means the harness never clobbers a developer's
  // `.next`. Unset in every normal build, so nothing changes by default.
  ...(process.env.COURANR_DIST_DIR ? { distDir: process.env.COURANR_DIST_DIR } : {}),
  // IMPORTANT:
  // Do NOT use `output: "export"` because this app uses API routes + auth.
};

module.exports = nextConfig;
