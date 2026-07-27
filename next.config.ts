import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * Identifies this build. Baked into the service worker's script URL so each
 * deploy installs a fresh worker and purges the previous build's cache.
 */
function resolveBuildId(): string {
  if (process.env.NEXT_PUBLIC_BUILD_ID) return process.env.NEXT_PUBLIC_BUILD_ID;
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return String(Date.now());
  }
}

const BUILD_ID = resolveBuildId();

/**
 * How many episodes ship in the seed catalog. The splash advertises this before
 * IndexedDB exists, and the seed file is 1.9 MB — far too heavy to fetch just
 * to call `.length` on it. Counted once here at build time instead.
 */
function resolveCatalogCount(): string {
  try {
    const seed = JSON.parse(readFileSync("./public/seed/library.json", "utf8"));
    return String(Array.isArray(seed) ? seed.length : seed?.episodes?.length ?? 0);
  } catch {
    return "0";
  }
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: BUILD_ID,
    NEXT_PUBLIC_CATALOG_COUNT: resolveCatalogCount(),
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self'",
              "connect-src 'self' https://archive.org https://*.archive.org",
              "media-src 'self' blob: https://archive.org https://*.archive.org",
              "worker-src 'self' blob:",
              "frame-ancestors 'self' https://sang3r.com https://www.sang3r.com",
            ].join("; "),
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
