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

  /**
   * LEG-003 (registry, `decided`) mandates these hops, and its acceptance
   * criterion is literally "No redirect target 404s."
   *
   * The Pricing V2 cutover DELETED app/courier/** along with the legacy
   * calculator behind it. Deleting the pages without adding the redirects
   * turned two URLs that used to serve a page into dead ends for anyone
   * holding a bookmark or an indexed link - which is the acceptance criterion
   * failing, not a cosmetic gap.
   *
   * The registry writes the checkout target as `/business/deliveries/new`.
   * That path predates V10 Step A, which moved the merchant application under
   * `/app/business`; the live route is the one used here. `permanent: false`
   * because the merchant surface is still moving and a 308 is cached by
   * browsers indefinitely.
   */
  async redirects() {
    return [
      { source: "/courier/quote", destination: "/estimate", permanent: false },
      { source: "/courier/checkout", destination: "/app/business/deliveries/new", permanent: false },
      { source: "/courier", destination: "/estimate", permanent: false },
    ];
  },
};

module.exports = nextConfig;
