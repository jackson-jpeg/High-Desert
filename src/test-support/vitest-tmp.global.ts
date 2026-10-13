import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

/**
 * Removes this run's Vitest temp dir when the run ends.
 *
 * Vitest 5 keeps a module cache for the forks pool in `$TMPDIR/<nanoid>/`
 * (`Vitest._tmpDir`, made in its constructor, before any config is read) and
 * never deletes it. Every `npm test`, every mutation and every agent's run left
 * one: on 2026-10-12 /tmp held 2,548 of them, 2.9 GB, with the disk at 98%.
 *
 * `_tmpDir` is internal, so this deletes only a directory directly under the
 * system temp dir whose name has nanoid's shape, and nothing when the field is
 * missing (a later Vitest that renamed it, or cleans up after itself).
 * HD_KEEP_VITEST_TMP=1 keeps it: the test's control.
 * Test: scripts/__tests__/vitest-tmp.test.ts.
 */
export function isRunTmp(dir: unknown): dir is string {
  return (
    typeof dir === "string" &&
    path.dirname(dir) === path.resolve(tmpdir()) &&
    /^[A-Za-z0-9_-]{21}$/.test(path.basename(dir))
  );
}

export default function setup(project: TestProject) {
  const dir = (project.vitest as unknown as { _tmpDir?: unknown })._tmpDir;
  return () => {
    if (process.env.HD_KEEP_VITEST_TMP === "1") return;
    if (isRunTmp(dir)) rmSync(dir, { recursive: true, force: true });
  };
}
