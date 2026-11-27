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
const args = process.argv.slice(2).filter((_, i, a) => a[i] !== "--json" && a[i - 1] !== "--json");
appendFileSync(process.env.STUB_CALLS, "mutate-check cwd=" + process.cwd() + " running=" + JSON.stringify(JSON.parse(running)) + " args=" + JSON.stringify(args) + "\\n");
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

  describe("the nightly design (the lead, 2026-11-27): incremental, a full run once a month", () => {
    const argsOf = async () => JSON.parse(/args=(\[.*\])/.exec((await callLog()).trim().split("\n").filter((l) => l.startsWith("mutate-check")).pop()!)![1]);
    const json = async (f: string) => JSON.parse(await readFile(path.join(state, f), "utf8"));
    const put = (f: string, v: unknown) => writeFile(path.join(state, f), JSON.stringify(v));
    const commit = async (name: string) => {
      await writeFile(path.join(src, name), name);
      await sh("git", ["add", "-A"], src);
      await sh("git", ["commit", "-qm", name], src);
      return sh("git", ["rev-parse", "HEAD"], src);
    };
    const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");

    it("with nothing on record, a full run: no selection, full.json and green.json written", async () => {
      expect((await runWeekly()).code).toBe(0);
      expect(await argsOf()).toEqual([]);
      const head = await sh("git", ["rev-parse", "HEAD"], src);
      expect(await result()).toMatchObject({ mode: "full", base: null, why: "no full run on record" });
      expect(await json("full.json")).toMatchObject({ mode: "full", head, red: 3 });
      expect(await json("green.json")).toMatchObject({ head });
      expect(existsSync(path.join(state, "full-tried.json")), "a finished full run clears its retry marker").toBe(false);
      expect((JSON.parse(/running=(\{.*?\}) args/.exec(await callLog())![1])).mode).toBe("full");
    });

    it("the next night is incremental from the green head, and full.json is left alone", async () => {
      await runWeekly();
      const green = await sh("git", ["rev-parse", "HEAD"], src);
      const fullBefore = await json("full.json");
      await commit("two");
      await rm(calls);
      expect((await runWeekly()).code).toBe(0);
      expect(await argsOf()).toEqual(["--changed-from", green]);
      expect(await result()).toMatchObject({ mode: "incremental", base: green });
      expect(await json("full.json")).toEqual(fullBefore);
    });

    it("carries the newest run's survivors into the next night (--also), and keeps the green base until it is red", async () => {
      await runWeekly();
      const green = await sh("git", ["rev-parse", "HEAD"], src);
      await commit("two");
      expect((await runWeekly({ STUB_MODE: "survive" })).code).toBe(1);
      expect(await json("green.json")).toMatchObject({ head: green });
      await commit("three");
      await rm(calls);
      await runWeekly();
      expect(await argsOf()).toEqual(["--changed-from", green, "--also", "a-survivor"]);
      // Red now: green moves to this head, and nothing is carried further.
      expect(await json("green.json")).toMatchObject({ head: await sh("git", ["rev-parse", "HEAD"], src) });
      await rm(calls);
      await runWeekly();
      expect(await argsOf()).toEqual(["--changed-from", await sh("git", ["rev-parse", "HEAD"], src)]);
    });

    it("a full run once the last one is HD_MUTATIONS_FULL_DAYS old, and not before", async () => {
      await runWeekly();
      await put("full.json", { ...(await json("full.json")), finishedAt: daysAgo(29) });
      await runWeekly();
      expect((await result()).mode).toBe("incremental");
      await put("full.json", { ...(await json("full.json")), finishedAt: daysAgo(31) });
      await runWeekly();
      expect(await result()).toMatchObject({ mode: "full", why: "the last full run finished 31d ago (every 30d)" });
    });

    it("a full run that never finished is tried again only after 7 days; the nights between are incremental", async () => {
      await runWeekly();
      await put("full.json", { ...(await json("full.json")), finishedAt: daysAgo(40) });
      await put("full-tried.json", { startedAt: daysAgo(2), head: "x" });
      await runWeekly();
      expect((await result()).mode).toBe("incremental");
      await put("full-tried.json", { startedAt: daysAgo(8), head: "x" });
      await runWeekly();
      expect((await result()).mode).toBe("full");
      expect(existsSync(path.join(state, "full-tried.json")), "finished: the marker goes").toBe(false);
      // A full run that dies keeps the marker, with its own start.
      await put("full.json", { ...(await json("full.json")), finishedAt: daysAgo(40) });
      expect((await runWeekly({ STUB_MODE: "crash" })).code).toBe(2);
      expect((await json("full-tried.json")).startedAt).toBe((await result()).startedAt);
    });

    it("a base main no longer contains means a full run", async () => {
      await runWeekly();
      await put("green.json", { head: "0123456789abcdef0123456789abcdef01234567" });
      await runWeekly();
      expect(await result()).toMatchObject({ mode: "full", why: "the base 0123456 is not in main's history" });
    });

    it("HD_MUTATIONS_MODE forces either", async () => {
      await runWeekly();
      await runWeekly({ HD_MUTATIONS_MODE: "full" });
      expect((await result()).mode).toBe("full");
    });
  });
});
