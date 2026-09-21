import type { NextConfig } from "next";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { contentSecurityPolicy } from "./src/lib/csp";

/**
 * Identifies this build. Baked into the service worker's script URL so each
 * deploy installs a fresh worker and purges the previous build's cache.
 *
 * The id must change whenever the shipped bytes change, because `activate` in
 * public/sw.js only deletes caches whose name differs from the current one. An
 * id that repeats the previous deploy's leaves that deploy's shell cached and
 * served to offline visitors, pointing at chunk hashes that no longer exist.
 *
 * `git rev-parse HEAD` alone does not guarantee that. It describes the last
 * commit, not the tree being compiled — so a build run against uncommitted work
 * is stamped with its predecessor. That is not hypothetical: a build once ran
 * 85 seconds before the commit it was meant to ship, and went out carrying the
 * previous commit's id. Hashing the working tree closes it: a dirty build gets
 * an id of its own, and the same tree always resolves to the same id, so
 * rebuilding without editing is still a no-op.
 */
function resolveBuildId(): string {
  if (process.env.NEXT_PUBLIC_BUILD_ID) return process.env.NEXT_PUBLIC_BUILD_ID;
  try {
    const git = (cmd: string) =>
      execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();

    const head = git("git rev-parse --short HEAD");
    const status = git("git status --porcelain");
    if (!status) return head;

    // `git diff HEAD` covers tracked edits; untracked files show up in status
    // by name only, so hash their contents too — otherwise editing a new file
    // that has never been added would not move the id.
    const untracked = git(
      "git ls-files --others --exclude-standard -z | xargs -0 -r git hash-object",
    );

    const digest = createHash("sha1")
      .update(status)
      .update("\0")
      .update(git("git diff HEAD"))
      .update("\0")
      .update(untracked)
      .digest("hex")
      .slice(0, 7);
    return `${head}-${digest}`;
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

/**
 * Where `next build` writes. Production reads `.next`; `scripts/deploy.sh`
 * builds into `.next-staging` (HD_DIST_DIR) so the directory the running
 * server is reading from is never touched by a build — a failed build used to
 * leave the live process serving a manifest for chunks that had been deleted.
 * The staging directory is renamed into place only after the build succeeds.
 *
 * It must stay a sibling of `.next` at the same depth: Turbopack links server
 * externals with relative symlinks (`.next/node_modules/pg-… -> ../../node_modules/pg`
 * on 16.3; 16.2 went via the project's own directory name), which survive the
 * rename only because the depth does not change.
 */
const DIST_DIR = process.env.HD_DIST_DIR || ".next";

const nextConfig: NextConfig = {
  distDir: DIST_DIR,
  // Nothing here uses next/image. Leaving the optimizer on only kept
  // /_next/image reachable — the endpoint behind GHSA-2xp9-vwfh-vxw4.
  images: { unoptimized: true },
  poweredByHeader: false,
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
            value: contentSecurityPolicy(process.env.NODE_ENV !== "production").join("; "),
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
