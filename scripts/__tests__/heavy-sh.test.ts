// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * scripts/heavy.sh: heavy commands take their turn through the box-wide
 * `heavy` semaphore (/root/vps-tools/bin/heavy) when it is installed, and run
 * directly where it is not (CI). Memory fell to 13% on 2026-09-28 with five
 * builds and test runs at once (docs/memory-2026-09-28.md).
 */
const SCRIPT = path.resolve(__dirname, "../heavy.sh");
const ROOT = path.resolve(__dirname, "../..");

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "hd-heavy-"));
  await writeFile(
    path.join(dir, "heavy-stub"),
    `#!/bin/bash\necho "$*" >> "${dir}/heavy.log"\nwhile [ "$1" != "--" ]; do shift; done; shift\nexec "$@"\n`,
    { mode: 0o755 },
  );
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function run(args: string[], heavy: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("bash", [SCRIPT, ...args], { env: { ...process.env, HD_HEAVY: heavy } }, (err, stdout, stderr) => {
      const code = err ? ((err as { code?: number }).code ?? 1) : 0;
      resolve({ code: typeof code === "number" ? code : 1, out: stdout + stderr });
    });
  });
}

describe("scripts/heavy.sh", () => {
  it("runs the command through heavy, labelled, and returns its status", async () => {
    const r = await run(["sh", "-c", "echo ran; exit 3"], path.join(dir, "heavy-stub"));
    expect(r.code).toBe(3);
    expect(r.out).toContain("ran");
    const log = await readFile(path.join(dir, "heavy.log"), "utf8");
    expect(log).toContain("--label high-desert sh -- sh -c echo ran; exit 3");
  });

  it("without heavy installed, runs the command directly", async () => {
    const r = await run(["sh", "-c", "echo direct; exit 4"], path.join(dir, "no-such-heavy"));
    expect(r.code).toBe(4);
    expect(r.out).toContain("direct");
  });

  it("the build, lint, typecheck, test and mutation scripts all go through it", () => {
    const scripts = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).scripts;
    for (const name of ["build", "lint", "typecheck", "test", "test:mutations"]) {
      expect(scripts[name], name).toMatch(/^bash scripts\/heavy\.sh /);
    }
  });

  it("each mutation's vitest run goes through it", () => {
    const src = readFileSync(path.join(ROOT, "scripts/mutate-check.mjs"), "utf8");
    expect(src).toContain('["scripts/heavy.sh", "npx", "vitest", "run", testFile');
  });
});
