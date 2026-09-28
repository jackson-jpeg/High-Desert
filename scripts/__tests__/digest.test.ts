import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * The weekly digest (scripts/digest.mjs). The pure parts are checked
 * directly; `main` runs for real against fake sources, a real git remote, and
 * ssh/scp stubs that record what they were asked to copy.
 */

const dg = await import("../digest.mjs");
const {
  dueDay,
  parseStatus,
  parseRelease,
  releaseVerdict,
  releaseBuilds,
  isReleaseBuild,
  lockedPhones,
  patternOf,
  proposeFix,
  evidenceReasons,
  render,
  screenLines,
  gather,
  titleIndex,
  main,
  AUTHOR,
} = dg;

const STATUS_OK = [
  "OK    deploy    live = HEAD = abc1234 (deployed 2026-10-01T10:00:00Z)",
  "OK    release   1.2% of starts lost on this release's builds in the 4.0 of 7 days since 2026-10-01T10:00:00Z (4 lost / 340 plays; target <3%); 5 rescued by the retry or the mirror (1.5%); older builds: 3 lost, 1 rescued / 20 plays, counted apart",
  "OK    mirror    nginx: 332 pinned (15.0 GB), fill cache 0.0 GB, manifest 7a3e, 11 mirror play(s) in 24h",
  "OK    cpu       every High Desert unit under 10% of a core over 15 min (highest: highdesert 0.7%)",
].join("\n");

const T = (iso: string) => new Date(iso).toISOString();
const row = (over: Record<string, unknown> = {}) => ({
  id: 1,
  at: T("2026-10-04T12:00:00Z"),
  episodeId: "coll--ep-a",
  kind: "stall",
  retried: true,
  recovered: false,
  uaClass: "ios-safari",
  detail: null,
  source: "archive",
  build: "abc1234",
  ...over,
});

describe("when the digest is due", () => {
  it("Monday from 17:40 UTC is this week's; before that, and every other day, the latest Monday's", () => {
    expect(dueDay("2026-10-05T17:40:00Z")).toBe("2026-10-05");
    expect(dueDay("2026-10-05T17:39:59Z")).toBe("2026-09-28");
    expect(dueDay("2026-10-06T17:40:00Z")).toBe("2026-10-05"); // a Tuesday catches Monday up
    expect(dueDay("2026-10-11T23:00:00Z")).toBe("2026-10-05");
    expect(dueDay("2026-10-12T18:00:00Z")).toBe("2026-10-12");
  });
});

describe("reading highdesert-status", () => {
  it("parses its lines, and the release line's numbers, sample and older builds", () => {
    const s = parseStatus(STATUS_OK + "\nnot a status line");
    expect(s.map((l: { area: string }) => l.area)).toEqual(["deploy", "release", "mirror", "cpu"]);
    const r = parseRelease(s[1]);
    expect(r).toMatchObject({ pct: 1.2, lost: 4, rescued: 5, plays: 340, older: { lost: 3, rescued: 1, plays: 20 }, whose: "on this release's builds" });
    expect(releaseVerdict(r)).toBe("pass");
  });

  it("the headline is starts lost: a release with many rescued starts passes on what the listener lost", () => {
    const [l] = parseStatus(
      "OK    release   1.0% of starts lost on this release's builds in the 7 of 7 days since 2026-10-01T10:00:00Z (3 lost / 300 plays; target <3%); 20 rescued by the retry or the mirror (6.7%)",
    );
    const r = parseRelease(l);
    expect(r).toMatchObject({ pct: 1, lost: 3, rescued: 20, plays: 300 });
    expect(releaseVerdict(r)).toBe("pass");
  });

  it("no verdict under 300 plays; a fail at 3% or more on 300", () => {
    expect(releaseVerdict({ pct: 9, plays: 299 })).toBeNull();
    expect(releaseVerdict({ pct: 3, plays: 300 })).toBe("fail");
    expect(releaseVerdict({ pct: 2.9, plays: 300 })).toBe("pass");
  });

  it("an API from before the build split is read as all builds, not claimed as the release's", () => {
    const [l] = parseStatus(
      "WARN  release   13 starts lost in 91 plays (all builds: the API gave no build split) so far, no verdict until 300 plays; 4 rescued by the retry or the mirror (0.2 of 7 days since 2026-09-28T06:46:22Z; target <3% lost)",
    );
    expect(parseRelease(l)).toMatchObject({ pct: 14.3, lost: 13, rescued: 4, plays: 91, whose: "across all builds", older: null });
    const [z] = parseStatus("OK    release   no plays yet on this release's builds since the release (2026-10-01T10:00:00Z); target <3%");
    expect(parseRelease(z)).toMatchObject({ plays: 0, whose: "on this release's builds" });
  });
});

describe("the release's builds", () => {
  it("the release commit, and every deploy since the release, by prefix either way", () => {
    const doc = "x\n**Release deployed:** `2026-10-01T10:00:00Z` (abc1234)\ny";
    const history = "0000000 2026-09-30T09:00:00Z\nabc1234 2026-10-01T10:00:00Z\ndef5678 2026-10-01T12:00:00Z\n";
    const rel = releaseBuilds(doc, history);
    expect(rel.at).toBe("2026-10-01T10:00:00Z");
    expect(rel.builds).toEqual(["abc1234", "abc1234", "def5678"]);
    expect(isReleaseBuild("abc1234567890abcdef1234567890abcdef1234", rel.builds)).toBe(true);
    expect(isReleaseBuild("def5678", rel.builds)).toBe(true);
    expect(isReleaseBuild("0000000", rel.builds)).toBe(false);
    expect(isReleaseBuild(null, rel.builds)).toBe(false);
  });
});

describe("locked phones", () => {
  it("none is said plainly", () => {
    expect(lockedPhones([]).lines[0]).toMatch(/^None this week/);
  });

  it("mostly hidden pages: it is the lock screen, and the rejoin tap is the way back", () => {
    const rows = [
      row({ kind: "handover-rejected", detail: "handover to=show hidden" }),
      row({ kind: "handover-rejected", detail: "handover to=station-id hidden" }),
      row({ kind: "handover-rejected", detail: "reload to=show visible", uaClass: "android-chrome", recovered: true }),
    ];
    const r = lockedPhones(rows);
    expect(r.hiddenShare).toBe(67);
    expect(r.lines[0]).toContain("3 refusals: 2 with the page hidden");
    expect(r.lines[0]).toContain("1 right after the tab updated itself");
    expect(r.lines[0]).toContain("1 came back without a tap");
    expect(r.lines.join(" ")).toMatch(/locked phones are refusing/);
    expect(r.lines.join(" ")).toMatch(/self-reload/);
  });

  it("mostly on screen: not the lock screen", () => {
    const r = lockedPhones([row({ kind: "handover-rejected", detail: "handover to=show visible" })]);
    expect(r.lines.join(" ")).toMatch(/not the lock screen/);
  });
});

describe("the pattern and the proposed fix", () => {
  it("one show that is most of the failures is named, with the pull procedure", () => {
    const rows = [row(), row(), row({ episodeId: "coll--ep-b", kind: "decode-error" })];
    const p = patternOf(rows, (id: string) => `Title of ${id}`);
    expect(p.lines.join(" ")).toContain("Most failing show: Title of coll--ep-a (2 of 3)");
    const fix = proposeFix(p, (id: string) => `Title of ${id}`);
    expect(fix.join(" ")).toMatch(/Title of coll--ep-a.*audit-durations/);
    expect(fix.join(" ")).toMatch(/failover reaches the mirror/);
  });

  it("play-rejected points at a start outside a tap; a browser that is most of it is named", () => {
    const rows = [
      row({ kind: "play-rejected", episodeId: "a" }),
      row({ kind: "play-rejected", episodeId: "b" }),
      row({ kind: "play-rejected", episodeId: "c" }),
      row({ kind: "stall", episodeId: "d", uaClass: "desktop-chrome" }),
    ];
    const fix = proposeFix(patternOf(rows)).join(" ");
    expect(fix).toMatch(/outside a tap/);
    expect(fix).toMatch(/75% on ios-safari/);
  });

  it("evidence is opened for any FAIL, and for the release over 3% on 300 plays, and not otherwise", () => {
    const ok = parseStatus(STATUS_OK);
    expect(evidenceReasons(ok, parseRelease(ok[1]))).toEqual([]);
    expect(evidenceReasons(ok, { pct: 3.1, plays: 299 })).toEqual([]);
    expect(evidenceReasons(ok, { pct: 3.1, plays: 300 }).map((r: { area: string }) => r.area)).toEqual(["release"]);
    const failing = parseStatus("FAIL  backup    DB BACKUP STALE\n" + STATUS_OK);
    expect(evidenceReasons(failing, null).map((r: { area: string }) => r.area)).toEqual(["backup"]);
  });
});

/** Fake sources: the week as the tests say it was. */
function sources(over: Partial<Record<string, () => Promise<unknown>>> = {}) {
  return {
    status: async () => STATUS_OK,
    traffic: async () => ({ peakOnline: 38, peakListening: 26, peakAt: "2026-10-03T03:20:00Z", playsInRange: 1424 }),
    funnel: async () => ({ threshold: 300, after: { visit: 82, live: 80, tune: 49, call: 4, days: 7 } }),
    baseline: async () => ({ doc: "**Release deployed:** `2026-10-01T10:00:00Z` (abc1234)", history: "" }),
    catalog: async () => [{ archiveIdentifier: "coll", fileName: "ep a.mp3", title: "Area 51 — John Lear" }],
    disk: async () => ({ usedPct: 62, freeGb: 38 }),
    topShows: async () => [{ episodeId: "coll--ep_a", plays: 139 }],
    places: async () => ({ calls: 135, callers: 65, unplaced: 95, top: [{ place: "Los Angeles", calls: 5 }] }),
    failures: async () => [],
    close: async () => {},
    ...over,
  };
}

describe("the digest itself", () => {
  const NOW = "2026-10-05T17:40:00Z";

  it("a quiet week: nothing needs you, every section says something, one screen, no em dash", async () => {
    const md = render({ day: "2026-10-05", writtenAt: NOW, ...(await gather(sources(), NOW)) });
    expect(md).toContain("## Needs you\n\nNothing this week.");
    expect(md).toContain("1.2% of starts lost on this release's builds (4 of 340 plays; target under 3%). Under target: pass.");
    expect(md).toContain("Rescued by the retry or the mirror: 5 (1.5%), shown beside the target, not held to it.");
    expect(md).toContain("Tabs on older builds: 3 lost and 1 rescued in 20 plays, counted apart.");
    expect(md).toContain("82 of 300 phone arrivals so far; 60% tuned in, 5% called.");
    expect(md).toContain("None this week: no phone refused a change of show.");
    expect(md).toContain("Peak 38 online and 26 listening");
    expect(md).toContain("Area 51 , John Lear (139)"); // the catalog's em dash, taken out
    expect(md).toContain("Calling from: Los Angeles 5 (95 calls gave no place)");
    expect(md).toContain("highdesert-status: all 4 checks OK.");
    expect(md).toContain("Disk: 62% used, 38 GB free. Pins: 332 shows (15.0 GB). CPU: busiest unit highdesert 0.7% of a core.");
    expect(md).not.toMatch(/—/);
    expect(md).not.toContain("Evidence for a fix session");
    expect(screenLines(md)).toBeLessThanOrEqual(dg.SCREEN_LINES);
  });

  it("under 300 plays the release is counts, never a percentage", async () => {
    const status = async () =>
      STATUS_OK.replace(
        /OK    release .*/,
        "WARN  release   1 start lost in 1 play on this release's builds so far, no verdict until 300 plays; 0 rescued by the retry or the mirror (0.1 of 7 days since 2026-10-01T10:00:00Z; target <3% lost)",
      );
    const md = render({ day: "2026-10-05", writtenAt: NOW, ...(await gather(sources({ status }), NOW)) });
    const rel = md.slice(md.indexOf("## Release"), md.indexOf("## Funnel"));
    expect(rel).toContain("1 start lost in 1 play on this release's builds so far, no verdict until 300. 0 more rescued by the retry or the mirror.");
    expect(rel).not.toMatch(/%/);
    expect(md).not.toContain("Release over target");
  });

  it("the funnel's verdict, once written, is what it says", async () => {
    const funnel = async () => ({ verdict: { writtenAt: "2026-10-03T17:40:00Z", cmp: { diff: 8, lo: 2, hi: 14, word: "better" } } });
    const md = render({ day: "2026-10-05", writtenAt: NOW, ...(await gather(sources({ funnel }), NOW)) });
    expect(md).toContain("Verdict (written 2026-10-03): better. Tune-in share on phones +8 points (95% interval 2 to 14).");
  });

  it("a source that fails is named at the top, never passed off as none", async () => {
    const md = render({
      day: "2026-10-05",
      writtenAt: NOW,
      ...(await gather(sources({ failures: async () => Promise.reject(new Error("no column")), places: async () => Promise.reject(new Error("x")) }), NOW)),
    });
    expect(md).toMatch(/## Needs you\n\n- \*\*Could not read:\*\* failure rows, the phone lines\./);
    expect(md).toContain("No reading: the failure rows could not be read.");
    expect(md).toContain("- Callers: no reading.");
    expect(md).not.toContain("None this week");
  });

  it("the release over 3% on 300 plays: at the top, and the evidence below, from the release's own rows", async () => {
    const status = async () =>
      STATUS_OK.replace(
        /OK    release .*/,
        "WARN  release   4.1% of starts lost on this release's builds in the 7 of 7 days since 2026-10-01T10:00:00Z (14 lost / 340 plays; target <3%); 9 rescued by the retry or the mirror (2.6%)",
      );
    const failures = async () => [
      ...Array.from({ length: 12 }, (_, i) => row({ id: 100 + i, at: T(`2026-10-0${2 + (i % 3)}T0${i % 10}:00:00Z`) })),
      row({ id: 200, build: "0000000", kind: "play-rejected" }), // an older build's row: not the release's
      row({ id: 201, at: T("2026-09-30T00:00:00Z") }), // before the release
    ];
    const md = render({ day: "2026-10-05", writtenAt: NOW, ...(await gather(sources({ status, failures }), NOW)) });
    const top = md.slice(md.indexOf("## Needs you"), md.indexOf("## Release"));
    expect(top).toContain("**Release over target:** 4.1% of starts lost on 340 plays");
    expect(top).toContain("The evidence for a fix session is at the bottom.");
    expect(md).toContain("Over target: fail.");
    const ev = md.slice(md.indexOf("## Evidence for a fix session"));
    expect(ev).toContain("### The rows (12 of 12, newest first)");
    expect(ev).toContain("| stall | ios-safari | archive | no |");
    expect(ev).not.toContain("play-rejected");
    expect(ev).toContain("By kind: stall 12.");
    expect(ev).toMatch(/### Proposed fix\n\n- /);
    expect(ev).toMatch(/failover reaches the mirror/);
    expect(screenLines(md)).toBeLessThanOrEqual(dg.SCREEN_LINES);
    expect(md).not.toMatch(/—/);
  });

  it("a FAIL: at the top with what to do, and the week's rows as evidence", async () => {
    const status = async () => "FAIL  backup    DB BACKUP STALE: newest dump 50h old\n" + STATUS_OK;
    const failures = async () => [row({ kind: "network-error", source: "mirror" })];
    const md = render({ day: "2026-10-05", writtenAt: NOW, ...(await gather(sources({ status, failures }), NOW)) });
    expect(md).toMatch(/## Needs you\n\n- \*\*FAIL backup:\*\* DB BACKUP STALE: newest dump 50h old The DB backup: highdesert-backup-status/);
    expect(md).toContain("## Evidence for a fix session");
    expect(md).toContain("- FAIL backup: DB BACKUP STALE");
    expect(md).toContain("- backup: The DB backup:");
    expect(md).toMatch(/Mostly network-error off the mirror/);
  });

  it("titles come from the catalog by community key", () => {
    const t = titleIndex([{ archiveIdentifier: "c", fileName: "1997-06-18 - Coast.mp3", title: "Coast" }]);
    expect(t("c--1997-06-18_-_Coast")).toBe("Coast");
    expect(t("unknown")).toBe("unknown");
  });
});

describe("the job", () => {
  let dir: string;
  let remote: string;
  let copies: string;
  let macUp: boolean;

  const git = (cwd: string, ...a: string[]) =>
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd, encoding: "utf8" }).trim();

  async function run(now: string, src = sources()) {
    const bin = path.join(dir, "bin");
    await writeFile(path.join(bin, "ssh"), `#!/bin/sh\n${macUp ? "exit 0" : "echo 'ssh: connect to host macbook: timed out' >&2; exit 255"}\n`, { mode: 0o755 });
    await writeFile(path.join(bin, "scp"), `#!/bin/sh\n${macUp ? `cp "$3" "${copies}/"` : "exit 1"}\n`, { mode: 0o755 });
    return main(
      {
        ...process.env,
        HD_DIGEST_STATE: path.join(dir, "state"),
        HD_DIGEST_REMOTE: remote,
        HD_SSH: path.join(bin, "ssh"),
        HD_SCP: path.join(bin, "scp"),
        HD_NOW: now,
      },
      src,
    );
  }
  const remoteFiles = () => git(remote, "ls-tree", "-r", "--name-only", "main").split("\n");
  const remoteCommits = () => Number(git(remote, "rev-list", "--count", "main"));

  beforeEach(async () => {
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
    vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
    dir = await mkdtemp(path.join(os.tmpdir(), "digest-"));
    // The box's global pre-push gate cannot run in the job's checkout: a hook
    // that refuses every push, so only a push that skips it lands.
    const hooks = path.join(dir, "hooks");
    execFileSync("mkdir", ["-p", hooks, path.join(dir, "bin"), path.join(dir, "seed"), path.join(dir, "copies")]);
    await writeFile(path.join(hooks, "pre-push"), "#!/bin/sh\necho 'pre-push: refused' >&2\nexit 1\n", { mode: 0o755 });
    vi.stubEnv("GIT_CONFIG_COUNT", "1");
    vi.stubEnv("GIT_CONFIG_KEY_0", "core.hooksPath");
    vi.stubEnv("GIT_CONFIG_VALUE_0", hooks);
    remote = path.join(dir, "remote.git");
    git(dir, "init", "-q", "--bare", "-b", "main", remote);
    const seed = path.join(dir, "seed");
    git(seed, "init", "-q", "-b", "main");
    await writeFile(path.join(seed, "README.md"), "seed\n");
    git(seed, "add", ".");
    git(seed, "commit", "-q", "-m", "seed");
    git(seed, "push", "-q", "--no-verify", remote, "main");
    copies = path.join(dir, "copies");
    macUp = true;
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it("Monday 17:40: writes docs/digest/<Monday>.md on main under its own name, and copies it to the Mac", async () => {
    const s = await run("2026-10-05T17:41:00Z");
    expect(s.error).toBeNull();
    expect(s.due).toBe("2026-10-05");
    expect(remoteFiles()).toContain("docs/digest/2026-10-05.md");
    expect(git(remote, "log", "-1", "--format=%an <%ae>", "main")).toBe(`${AUTHOR.name} <${AUTHOR.email}>`);
    const doc = git(remote, "show", "main:docs/digest/2026-10-05.md");
    expect(doc).toContain("# High Desert, week to Monday, 5 October 2026");
    expect((await readFile(path.join(copies, "2026-10-05.md"), "utf8")).trim()).toBe(doc);
    expect(s.copied["2026-10-05"]).toBe("2026-10-05T17:41:00Z");
  });

  it("frozen: later runs that week neither rewrite nor push again", async () => {
    await run("2026-10-05T17:41:00Z");
    const s = await run("2026-10-06T17:41:00Z", sources({ status: async () => "FAIL  backup    changed" }));
    expect(s.error).toBeNull();
    expect(remoteCommits()).toBe(2);
    expect(git(remote, "show", "main:docs/digest/2026-10-05.md")).not.toContain("changed");
  });

  it("frozen even with its state lost: a week already on main is not rewritten", async () => {
    await run("2026-10-05T17:41:00Z");
    const doc = git(remote, "show", "main:docs/digest/2026-10-05.md");
    await rm(path.join(dir, "state", "status.json"));
    const s = await run("2026-10-06T17:41:00Z", sources({ status: async () => "FAIL  backup    changed" }));
    expect(s.error).toBeNull();
    expect(s.written["2026-10-05"]).toMatchObject({ note: "already on main" });
    expect(git(remote, "show", "main:docs/digest/2026-10-05.md")).toBe(doc);
    expect(remoteCommits()).toBe(2);
  });

  it("a week the Mac slept through is still copied when it wakes, a week later", async () => {
    macUp = false;
    await run("2026-10-05T17:41:00Z");
    await run("2026-10-08T17:41:00Z");
    macUp = true;
    const s = await run("2026-10-12T17:41:00Z");
    expect(s.error).toBeNull();
    expect(s.copied).toEqual({ "2026-10-05": "2026-10-12T17:41:00Z", "2026-10-12": "2026-10-12T17:41:00Z" });
    expect(await readFile(path.join(copies, "2026-10-05.md"), "utf8")).toContain("week to Monday, 5 October 2026");
  });

  it("a Monday that never ran is caught up on Tuesday, for that Monday", async () => {
    const s = await run("2026-10-06T17:41:00Z");
    expect(s.due).toBe("2026-10-05");
    expect(remoteFiles()).toContain("docs/digest/2026-10-05.md");
  });

  it("before Monday 17:40 nothing new is due (last week's is already written)", async () => {
    await run("2026-10-05T17:41:00Z");
    await run("2026-10-12T09:00:00Z");
    expect(remoteFiles().filter((f) => f.startsWith("docs/digest/"))).toEqual(["docs/digest/2026-10-05.md"]);
  });

  it("nothing is due before the first week (no digest for the week before the job existed)", async () => {
    const s = await run("2026-09-28T17:41:00Z");
    expect(s.due).toBeNull();
    expect(s.firstDue).toBe("2026-10-05");
    expect(remoteCommits()).toBe(1);
  });

  it("the Mac asleep: pushed, not copied, said so; the next run copies it", async () => {
    macUp = false;
    const s = await run("2026-10-05T17:41:00Z");
    expect(s.written["2026-10-05"]).toBeTruthy();
    expect(s.copied["2026-10-05"] ?? null).toBeNull();
    expect(s.error).toMatch(/ssh/);
    macUp = true;
    const t = await run("2026-10-06T17:41:00Z");
    expect(t.copied["2026-10-05"]).toBe("2026-10-06T17:41:00Z");
    expect(t.error).toBeNull();
    expect(remoteCommits()).toBe(2);
  });
});

describe("the units", () => {
  const unit = (f: string) => readFileSync(path.resolve(__dirname, "../../deploy", f), "utf8");

  it("the job holds the 10% rule: CPUQuota at or under 10%, Nice=19, idle IO (CLAUDE.md)", () => {
    const svc = unit("highdesert-digest.service");
    const quota = Number(/^CPUQuota=(\d+)%$/m.exec(svc)?.[1]);
    expect(quota).toBeGreaterThan(0);
    expect(quota).toBeLessThanOrEqual(10);
    expect(svc).toMatch(/^Nice=19$/m);
    expect(svc).toMatch(/^IOSchedulingClass=idle$/m);
    expect(svc).toMatch(/^ExecStart=\/usr\/bin\/node \/root\/High-Desert\/scripts\/digest\.mjs$/m);
  });

  it("the timer fires daily at 17:40 UTC (Mondays write; the rest catch up and retry the Mac)", () => {
    expect(unit("highdesert-digest.timer")).toMatch(/^OnCalendar=\*-\*-\* 17:40:00 UTC$/m);
    expect(dg.DUE_UTC).toEqual({ weekday: 1, hour: 17, minute: 40 });
  });
});
