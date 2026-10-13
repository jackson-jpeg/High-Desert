// @vitest-environment node
import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { clearGitEnv } from "@/test-support/git-env";
import { isRunTmp } from "@/test-support/vitest-tmp.global";

/**
 * A Vitest run leaves no directory behind in $TMPDIR
 * (src/test-support/vitest-tmp.global.ts). Runs the real Vitest, with this
 * project's config, on one small test file, in a fresh TMPDIR of its own.
 * The control keeps the directory and finds it, so "nothing left" is not just
 * "nothing was ever written there".
 */
const run = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "../..");
const SMALL = "src/test-support/__tests__/git-env.test.ts";

async function leftAfterRun(keep: boolean): Promise<string[]> {
  const tmp = mkdtempSync(path.join(tmpdir(), "hd-vitest-tmp-test-"));
  const env: Record<string, string | undefined> = { ...process.env, TMPDIR: tmp, HD_KEEP_VITEST_TMP: keep ? "1" : "0" };
  clearGitEnv(env);
  try {
    await run("npx", ["vitest", "run", SMALL, "--reporter=dot", "--silent"], {
      cwd: ROOT,
      env: env as NodeJS.ProcessEnv,
      timeout: 120_000,
    });
    return readdirSync(tmp).filter((n) => /^[A-Za-z0-9_-]{21}$/.test(n));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe("a Vitest run cleans up its temp dir", () => {
  it("leaves nothing in TMPDIR", async () => {
    expect(await leftAfterRun(false)).toEqual([]);
  }, 150_000);

  it("control: kept, the run's directory is there to find", async () => {
    expect(await leftAfterRun(true)).toHaveLength(1);
  }, 150_000);

  it("deletes only a nanoid-shaped directory directly under the temp dir", () => {
    const base = path.resolve(tmpdir());
    expect(isRunTmp(path.join(base, "V1StGXR8_Z5jdHi6B-myT"))).toBe(true);
    expect(isRunTmp(path.join(base, "hd-verify-abc"))).toBe(false);
    expect(isRunTmp(path.join(base, "x", "V1StGXR8_Z5jdHi6B-myT"))).toBe(false);
    expect(isRunTmp("/root")).toBe(false);
    expect(isRunTmp(undefined)).toBe(false);
  });
});
