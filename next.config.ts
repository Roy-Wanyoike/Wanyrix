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
  // Issue #141b — do not advertise the framework: the `X-Powered-By: Next.js`
  // response header is removed from every response.
  poweredByHeader: false,
  // Issue #141b — minimal hardening headers on EVERY response (pages + API).
  // CSP is deliberately out of scope for the local-first tool (docs/SECURITY.md §4).
  // NOTE: next.config changes are read at server start, not hot-reloaded —
  // a running dev server serves these only after a restart.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
