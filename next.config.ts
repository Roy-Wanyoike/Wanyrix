import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: false,
  },
  // AUD-5: strict-mode double-render surfaced no dev regressions in the QA-1
  // browser walk (0 console/page errors across 10 views); activates on the
  // next dev-server restart (config changes are not hot-reloaded).
  reactStrictMode: true,
};

export default nextConfig;
