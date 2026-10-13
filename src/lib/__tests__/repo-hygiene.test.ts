// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { clearGitEnv } from "@/test-support/git-env";

/**
 * What the commit guard (.commit-guard, /root/vps-tools/bin/commit-guard)
 * refuses at commit time, held for what is already in git: no tracked file
 * over 20 MB, nothing inside a build or dev-server output folder. The guard is
 * a hook on the VPS; this is the same rule where hooks do not run (CI, a
 * laptop, a commit made with --no-verify).
 */
const ROOT = path.resolve(import.meta.dirname, "../../..");
const MAX_BYTES = 20 * 1024 * 1024;
const OUTPUT_DIR = /^(\.next|\.next[-.].*|node_modules|node_modules\..*|test-results|playwright-report|blob-report|coverage|\.turbo|\.vercel|\.cache)$/;

function tracked(): string[] {
  const env: Record<string, string | undefined> = { ...process.env };
  clearGitEnv(env);
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, env: env as NodeJS.ProcessEnv })
    .toString()
    .split("\0")
    .filter(Boolean);
}

function outputPaths(paths: string[]): string[] {
  return paths.filter((p) => p.split("/").slice(0, -1).some((d) => OUTPUT_DIR.test(d)));
}

describe("what is in git", () => {
  const files = tracked();

  it("lists the repository (control: the seed catalog is there)", () => {
    expect(files).toContain("public/seed/library.json");
  });

  it("no tracked file is over 20 MB", () => {
    const big = files.filter((f) => {
      try {
        return statSync(path.join(ROOT, f)).size > MAX_BYTES;
      } catch {
        return false;
      }
    });
    expect(big).toEqual([]);
  });

  it("nothing is inside a build or dev-server output folder", () => {
    expect(outputPaths(files)).toEqual([]);
  });

  it("the rule sees such a path, and not a source folder that only looks like one", () => {
    expect(outputPaths([".next-dev/static/chunk.js", "a/node_modules/x/index.js", "test-results/x.png", ".next.prev/BUILD_ID"])).toHaveLength(4);
    expect(outputPaths(["src/app/api/build/route.ts", "src/coverage.ts", "docs/next.md"])).toEqual([]);
  });

  it("the commit guard is opted in, at 20 MB", () => {
    const cfg = readFileSync(path.join(ROOT, ".commit-guard"), "utf8");
    expect(cfg).toMatch(/^max-mb 20$/m);
  });
});
