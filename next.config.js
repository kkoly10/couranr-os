/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // IMPORTANT:
  // Do NOT use `output: "export"` because this app uses API routes + auth.
};

module.exports = nextConfig;
