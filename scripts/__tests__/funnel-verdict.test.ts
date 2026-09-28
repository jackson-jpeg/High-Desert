import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The funnel's before-and-after verdict on autopilot (docs/funnel.md). The
 * pure parts are checked directly; `main` runs for real against a fake
 * /api/stats/funnel, a real git remote, and ssh/scp stubs that record what
 * they were asked to copy.
 */

const fv = await import("../funnel-verdict.mjs");
const { afterCohort, compare, renderVerdict, spliceDoc, main, START_MARK, END_MARK, BEFORE } = fv;

const DOC = readFileSync(path.resolve(__dirname, "../../docs/funnel.md"), "utf8");

const cohort = (day: string, device: string, visit: number, tune: number) => ({ day, device, visit, live: visit, tune, call: 0 });

describe("the arithmetic", () => {
  it("sums the phone cohorts from 2026-09-28 on, and nothing else", () => {
    const sum = afterCohort({
      cohorts: [
        cohort("2026-09-27", "phone", 215, 102),
        cohort("2026-09-28", "phone", 44, 28),
        cohort("2026-09-28", "desktop", 30, 10),
        cohort("2026-09-29", "phone", 60, 40),
      ],
    });
    expect(sum).toEqual({ visit: 104, live: 104, tune: 68, call: 0, days: 2 });
  });

  it("the word follows the 95% interval, not the point estimate", () => {
    expect(compare({ visit: 20, tune: 13 }, { visit: 300, tune: 210 }).word).toBe("no difference the data can see");
    expect(compare({ visit: 400, tune: 200 }, { visit: 400, tune: 300 }).word).toBe("better");
    expect(compare({ visit: 400, tune: 300 }, { visit: 400, tune: 200 }).word).toBe("worse");
    expect(compare({ visit: 400, tune: 200 }, { visit: 400, tune: 300 })).toMatchObject({ diff: 25 });
  });

  it("the section is user-readable copy: no em dash, the numbers of both sides, between its markers", () => {
    const after = { visit: 300, live: 290, tune: 210, call: 9, days: 5 };
    const text = renderVerdict({ writtenAt: "2026-10-03T17:40:00Z", since: "2026-09-28", threshold: 300, before: BEFORE, after, cmp: compare(BEFORE, after) });
    expect(text).not.toMatch(/—/);
    expect(text.startsWith(START_MARK) && text.endsWith(END_MARK)).toBe(true);
    expect(text).toContain("| Before | 20 | 20 (100%) | 13 (65%) | 0 (0%) |");
    expect(text).toContain("| After | 300 | 290 (97%) | 210 (70%) | 9 (3%) |");
  });

  it("docs/funnel.md carries the markers, and splicing touches only what is between them", () => {
    const next = spliceDoc(DOC, `${START_MARK}\nX\n${END_MARK}`);
    expect(next).toContain(`${START_MARK}\nX\n${END_MARK}`);
    expect(next.slice(0, next.indexOf(START_MARK))).toBe(DOC.slice(0, DOC.indexOf(START_MARK)));
    expect(() => spliceDoc("no markers here", "x")).toThrow(/funnel-verdict/);
  });
});

describe("the job", () => {
  let dir: string;
  let server: Server;
  let api: string;
  let cohorts: ReturnType<typeof cohort>[];
  let remote: string;
  let copies: string;
  let macUp: boolean;

  const git = (cwd: string, ...a: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, encoding: "utf8" }).trim();

  async function run(now: string) {
    const bin = path.join(dir, "bin");
    await writeFile(path.join(bin, "ssh"), `#!/bin/sh\n${macUp ? "exit 0" : "echo 'ssh: connect to host macbook: timed out' >&2; exit 255"}\n`, { mode: 0o755 });
    await writeFile(path.join(bin, "scp"), `#!/bin/sh\n${macUp ? `cp "$3" "${copies}"` : "exit 1"}\n`, { mode: 0o755 });
    return main({
      ...process.env,
      HD_API: api,
      HD_FUNNEL_STATE: path.join(dir, "state"),
      HD_FUNNEL_REMOTE: remote,
      HD_SSH: path.join(bin, "ssh"),
      HD_SCP: path.join(bin, "scp"),
      HD_NOW: now,
    });
  }
  const remoteDoc = () => git(remote, "show", "main:docs/funnel.md");
  const remoteCommits = () => Number(git(remote, "rev-list", "--count", "main"));

  beforeEach(async () => {
    // No git identity from a global config, as on CI or a fresh box: the job
    // must bring its own (2026-09-28: it did not, and CI refused its commit).
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    dir = await mkdtemp(path.join(os.tmpdir(), "funnel-verdict-"));
    // The box's global pre-push gate, which cannot run in the job's checkout:
    // here a hook that refuses every push, so only a push that skips it lands.
    const hooks = path.join(dir, "hooks");
    execFileSync("mkdir", ["-p", hooks]);
    await writeFile(path.join(hooks, "pre-push"), "#!/bin/sh\necho 'pre-push: refused' >&2\nexit 1\n", { mode: 0o755 });
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "core.hooksPath");
    vi.stubEnv("GIT_CONFIG_VALUE_0", hooks);
    execFileSync("mkdir", ["-p", path.join(dir, "bin"), path.join(dir, "seed", "docs")]);
    // The remote: a bare repo whose main holds the real docs/funnel.md.
    remote = path.join(dir, "remote.git");
    git(dir, "init", "-q", "--bare", "-b", "main", remote);
    const seed = path.join(dir, "seed");
    git(seed, "init", "-q", "-b", "main");
    await writeFile(path.join(seed, "docs", "funnel.md"), DOC);
    git(seed, "add", ".");
    git(seed, "commit", "-q", "-m", "seed");
    git(seed, "push", "-q", "--no-verify", remote, "main"); // the setup, not the job: past the refusing hook
    copies = path.join(dir, "copied-funnel.md");
    macUp = true;
    cohorts = [cohort("2026-09-28", "phone", 44, 28)];
    server = createServer((req, res) => {
      if (req.url === "/api/stats/funnel?days=90") res.end(JSON.stringify({ days: 90, cohorts }));
      else {
        res.statusCode = 404;
        res.end("{}");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    api = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  afterEach(async () => {
    await new Promise((r) => server.close(r));
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("below 300 phone arrivals: progress recorded, nothing written, nothing pushed, nothing copied", async () => {
    const s = await run("2026-09-29T17:40:00Z");
    expect(s).toMatchObject({ after: { visit: 44 }, threshold: 300, error: null });
    expect(s.verdict).toBeUndefined();
    expect(remoteCommits()).toBe(1);
    await expect(readFile(copies, "utf8")).rejects.toThrow();
  });

  it("past 300: the verdict is written into docs/funnel.md on main, and the doc lands on the Mac", async () => {
    cohorts = [cohort("2026-09-28", "phone", 180, 120), cohort("2026-09-30", "phone", 130, 95)];
    const s = await run("2026-10-01T17:40:00Z");
    expect(s.error).toBeNull();
    expect(s.verdict).toMatchObject({ writtenAt: "2026-10-01T17:40:00Z", after: { visit: 310, tune: 215 } });
    expect(remoteCommits()).toBe(2);
    expect(git(remote, "log", "-1", "--format=%an <%ae>", "main")).toBe("High Desert funnel-verdict <funnel-verdict@highdesert.space>");
    const doc = remoteDoc();
    expect(doc).toContain("| After | 310 |");
    expect(doc).not.toContain("_Not measured yet._");
    expect(s.pushedSha).toBeTruthy();
    expect(await readFile(copies, "utf8")).toBe(doc + "\n");
    expect(s.copiedAt).toBe("2026-10-01T17:40:00Z");
  });

  it("frozen: a later run with other numbers neither rewrites the verdict nor pushes again", async () => {
    cohorts = [cohort("2026-09-28", "phone", 310, 215)];
    await run("2026-10-01T17:40:00Z");
    const doc = remoteDoc();
    cohorts = [cohort("2026-09-28", "phone", 500, 100)];
    const s = await run("2026-10-02T17:40:00Z");
    expect(s.after.visit).toBe(500);
    expect(s.verdict.after.visit).toBe(310);
    expect(remoteDoc()).toBe(doc);
    expect(remoteCommits()).toBe(2);
  });

  it("the Mac asleep: pushed, not copied, said so; the next run copies it", async () => {
    cohorts = [cohort("2026-09-28", "phone", 310, 215)];
    macUp = false;
    const s = await run("2026-10-01T17:40:00Z");
    expect(s.pushedSha).toBeTruthy();
    expect(s.copiedAt ?? null).toBeNull();
    expect(s.error).toMatch(/ssh/);
    macUp = true;
    const t = await run("2026-10-02T17:40:00Z");
    expect(t.copiedAt).toBe("2026-10-02T17:40:00Z");
    expect(t.error).toBeNull();
    expect(remoteCommits()).toBe(2);
  });
});
