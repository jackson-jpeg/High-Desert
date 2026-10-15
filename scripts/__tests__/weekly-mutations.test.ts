// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * scripts/weekly-mutations.sh, run for real against a throwaway repo whose
 * scripts/mutate-check.mjs is a stub that answers as told (STUB_MODE), with
 * stub npm and heavy on PATH. What it must hold: it mutates its own clone and
 * never the source tree, installs only when a lockfile changed and through
 * heavy, and leaves a result.json that highdesert-status and the digest can
 * trust, including when it broke before checking anything.
 */

const SCRIPT = path.resolve(__dirname, "../weekly-mutations.sh");

const STUB_MUTATE = `
import { writeFileSync, appendFileSync, readFileSync } from "node:fs";
const out = process.argv[process.argv.indexOf("--json") + 1];
const running = readFileSync(process.env.HD_MUTATIONS_STATE + "/running.json", "utf8");
appendFileSync(process.env.STUB_CALLS, "mutate-check cwd=" + process.cwd() + " running=" + JSON.stringify(JSON.parse(running)) + "\\n");
const mode = process.env.STUB_MODE ?? "red";
if (mode === "crash") process.exit(3);
const survived = mode === "survive" ? [{ id: "a-survivor", verdict: "GREEN", test: "t.test.ts", file: "f.ts", why: "w" }] : [];
writeFileSync(out, JSON.stringify({
  startedAt: "2026-10-19T14:00:05.123Z", finishedAt: new Date().toISOString(), exit: survived.length ? 1 : 0,
  total: 3, red: 3 - survived.length, skipped: [], survived,
}));
process.exit(survived.length ? 1 : 0);
`;

let dir: string;
let src: string;
let state: string;
let calls: string;

function sh(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }, (err, out) =>
      err ? reject(err) : resolve(out.trim()),
    ),
  );
}

function runWeekly(extra: Record<string, string> = {}): Promise<{ code: number; out: string }> {
  // The suite starts with no GIT_* variable (src/test-support/git-env.setup.ts).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
    HD_MUTATIONS_STATE: state,
    HD_MUTATIONS_SRC: src,
    STUB_CALLS: calls,
    ...extra,
  };
  delete env.TEST_DATABASE_URL;
  delete env.CI;
  return new Promise((resolve) =>
    execFile("bash", [SCRIPT], { env }, (err, out, errOut) =>
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: out + errOut }),
    ),
  );
}

const result = async () => JSON.parse(await readFile(path.join(state, "result.json"), "utf8"));
const callLog = async () => (existsSync(calls) ? await readFile(calls, "utf8") : "");

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "hd-weekly-mutations-"));
  src = path.join(dir, "src");
  state = path.join(dir, "state");
  calls = path.join(dir, "calls.log");
  await mkdir(path.join(src, "scripts"), { recursive: true });
  await mkdir(path.join(src, "services/live"), { recursive: true });
  await writeFile(path.join(src, "scripts/mutate-check.mjs"), STUB_MUTATE);
  await writeFile(path.join(src, "package-lock.json"), '{"v":1}');
  await writeFile(path.join(src, "services/live/package-lock.json"), '{"v":1}');
  await sh("git", ["init", "-q", "-b", "main"], src);
  await sh("git", ["add", "-A"], src);
  await sh("git", ["commit", "-qm", "one"], src);
  await mkdir(path.join(dir, "bin"));
  await writeFile(
    path.join(dir, "bin/npm"),
    `#!/bin/sh\necho "npm $* cwd=$(pwd)" >> "$STUB_CALLS"\n[ -n "$STUB_NPM_FAIL" ] && exit 1\nmkdir -p node_modules\n`,
    { mode: 0o755 },
  );
  await writeFile(
    path.join(dir, "bin/heavy"),
    `#!/bin/sh\necho "heavy $*" >> "$STUB_CALLS"\nwhile [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"\n`,
    { mode: 0o755 },
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("scripts/weekly-mutations.sh", () => {
  it("runs mutate-check in its own clone of main, never in the source tree, and records the run", async () => {
    const r = await runWeekly();
    expect(r.code).toBe(0);
    const log = await callLog();
    expect(log).toContain(`mutate-check cwd=${path.join(state, "checkout")} `);
    expect(log).not.toContain(`mutate-check cwd=${src} `);
    const res = await result();
    expect(res).toMatchObject({ head: await sh("git", ["rev-parse", "HEAD"], src), error: null, exit: 0, total: 3, red: 3, survived: [] });
    // Whole seconds, so jq's fromdate can read both (status's "took").
    expect(res.startedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(res.finishedAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    expect(existsSync(path.join(state, "running.json"))).toBe(false);
    expect(await readdir(path.join(state, "runs"))).toHaveLength(1);
  });

  it("says a run is going while it is: running.json with its pid and the head it checks", async () => {
    await runWeekly();
    const seen = /running=(\{.*\})/.exec(await callLog())![1];
    const running = JSON.parse(seen);
    expect(running.pid).toEqual(expect.any(Number));
    expect(running.head).toBe(await sh("git", ["rev-parse", "HEAD"], src));
  });

  it("installs through heavy, in both trees, and only when a lockfile changed", async () => {
    await runWeekly();
    let log = await callLog();
    expect(log).toMatch(/heavy --label high-desert weekly mutations: npm ci -- npm ci/);
    expect(log).toContain(`npm ci --no-audit --no-fund cwd=${path.join(state, "checkout")}\n`);
    expect(log).toContain(`npm ci --no-audit --no-fund cwd=${path.join(state, "checkout/services/live")}\n`);

    await rm(calls);
    await runWeekly();
    expect(await callLog()).not.toMatch(/npm ci/);

    await writeFile(path.join(src, "package-lock.json"), '{"v":2}');
    await sh("git", ["commit", "-qam", "two"], src);
    await rm(calls);
    await runWeekly();
    log = await callLog();
    expect(log).toContain(`npm ci --no-audit --no-fund cwd=${path.join(state, "checkout")}\n`);
    expect(log).not.toContain("checkout/services/live\n");
    expect((await result()).head).toBe(await sh("git", ["rev-parse", "HEAD"], src));
  });

  it("exits 1 and records the survivors when a mutation survives", async () => {
    const r = await runWeekly({ STUB_MODE: "survive" });
    expect(r.code).toBe(1);
    expect((await result()).survived).toEqual([expect.objectContaining({ id: "a-survivor", verdict: "GREEN" })]);
  });

  it("records an error, never a clean run, when it broke before checking", async () => {
    const r = await runWeekly({ STUB_NPM_FAIL: "1" });
    expect(r.code).toBe(2);
    expect(await result()).toMatchObject({ error: "npm ci failed in the checkout", exit: 2, survived: [] });
    expect(await callLog()).not.toMatch(/mutate-check/);
  });

  it("records an error when mutate-check dies without a verdict", async () => {
    const r = await runWeekly({ STUB_MODE: "crash" });
    expect(r.code).toBe(2);
    expect((await result()).error).toMatch(/^mutate-check exited 3 without a verdict/);
    expect(existsSync(path.join(state, "running.json"))).toBe(false);
  });
});
