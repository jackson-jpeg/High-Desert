// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, copyFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

/**
 * scripts/status.sh (`highdesert-status`), run for real against a throwaway
 * git repo, stub systemctl/npm, a stub backup check and a fake stats API.
 * Each world below changes exactly one thing from healthy and asserts the one
 * line that must turn.
 */

const SCRIPT = path.resolve(__dirname, "../status.sh");
const UNIT = path.resolve(__dirname, "../../deploy/highdesert.service");
const VHOST = path.resolve(__dirname, "../../deploy/nginx/highdesert.conf");

interface World {
  timerState: string;
  sampleAgeS: number;
  sampleResult: string;
  serviceActive: string;
  audit: { critical: number; high: number };
  failures: number;
  plays: number;
  backupOk: boolean;
  backupMacSkipped: boolean;
  deployedIsHead: boolean;
  /** The `**Release deployed:**` timestamp in docs/reliability-baseline.md; null writes no doc. */
  releaseAt: string | null;
  /** `recovered` of `failures` were rescued by the retry or the mirror; the rest were lost. */
  release: { failures: number; recovered: number; plays: number; days: number };
  /** Rows in the window from builds that are not the release's, and untagged rows. */
  releaseOther: { build: string | null; failures: number; recovered: number; plays: number }[];
  /** .deploy/history lines ("<ref> <ISO>"); the release commit in the doc is abc1234. */
  history: string[];
  /** Answer the window without `byBuild`, as the API did before the build split. */
  noBuildSplit?: boolean;
  /** What the stub presence check prints and exits with. */
  presence: { rc: number; out: string };
  /** /proc/meminfo's MemTotal, MemAvailable and swap, in kB; null writes no file. */
  memory: { totalKb: number; availKb: number; swapTotalKb: number; swapFreeKb: number } | null;
  /** %steal of each sysstat sample today, oldest first; [] prints no samples. */
  steal: number[];
  /** is-active of the retired webtorrent unit, highdesert-mirror. */
  oldGatewayActive: string;
  /** /mirror/manifest's body; null answers 502. */
  mirrorManifest: { version: string; count: number; pinned: number; fileHashes: string[] } | null;
  /** Apparent bytes in the pin directory and in nginx's fill cache (sparse files). */
  pinnedBytes: number;
  fillCacheBytes: number;
  mirrorPlays24h: number;
  /** What the stub hd-cpu-sample prints and exits with. */
  cpu: { rc: number; out: string };
  /** warm-status.json, with `ageH` turned into its `at`; null writes no file. */
  warm: {
    ageH: number;
    outcome: string;
    pinned: number;
    bytes: number;
    fetched: number;
    failed: number;
    steal?: number;
    targetPinned?: number;
    targetMissing?: number;
    targetBytes?: number;
    freeBytes?: number;
    floorBytes?: number;
  } | null;
  /** peakOnline / peakListening /api/stats/traffic answers per range; a missing range answers no peaks. */
  peaks: Partial<Record<"24h" | "7d" | "30d", { online: number; listening: number }>>;
  /** /api/stats/funnel's 7-day totals; null answers 503. */
  funnel: { visit: number; live: number; tune: number; call: number } | null;
  /** Its `byDevice.phone`; null leaves `byDevice` out, as a build before the split did. */
  funnelPhone: { visit: number; live: number; tune: number; call: number } | null;
  /** scripts/funnel-verdict.mjs's status.json; null: the job has never run. `ageH` sets checkedAt. */
  funnelVerdict: ({ ageH: number } & Record<string, unknown>) | null;
  /** scripts/digest.mjs's status.json; null: never run. `ageH` sets checkedAt. */
  digest: ({ ageH: number } & Record<string, unknown>) | null;
  /** scripts/nightly-mutations.sh's answer; `ageH` sets createdAt. null: never run; "unreadable": GitHub fails. */
  mutations: { ageH: number; conclusion: string; mutationCheck: string[] } | null | "unreadable";
  liveActive: string;
  /** /live-api/health's body; null answers 502. */
  liveHealth: Record<string, unknown> | null;
}

const HEALTHY: World = {
  timerState: "active",
  sampleAgeS: 60,
  sampleResult: "success",
  serviceActive: "active",
  audit: { critical: 0, high: 0 },
  failures: 15,
  plays: 300,
  backupOk: true,
  backupMacSkipped: false,
  deployedIsHead: true,
  releaseAt: "2026-09-21T15:50:00Z",
  release: { failures: 4, recovered: 0, plays: 200, days: 7 },
  releaseOther: [],
  history: [],
  presence: { rc: 0, out: "surfaces agree in 3 view(s)" },
  // The oldest sample is high on purpose: only the last three (30 min) count.
  steal: [90, 4, 5, 6],
  memory: { totalKb: 8_000_000, availKb: 3_000_000, swapTotalKb: 12_582_912, swapFreeKb: 10_485_760 },
  oldGatewayActive: "inactive",
  mirrorManifest: { version: "0123456789abcdef", count: 3, pinned: 3, fileHashes: ["archive:c:a.mp3", "archive:c:b.mp3", "archive:c:c.mp3"] },
  pinnedBytes: 14 * 2 ** 30,
  fillCacheBytes: 2 * 2 ** 30,
  mirrorPlays24h: 7,
  cpu: { rc: 0, out: "highdesert 3.2\nhighdesert-live 3.1\nhighdesert-sample 0.4\nhighdesert-mirror-warm 0.0\nhighdesert-backup 0.0" },
  warm: { ageH: 5, outcome: "ok", pinned: 120, bytes: 14 * 2 ** 30, fetched: 4, failed: 0 },
  peaks: { "24h": { online: 4, listening: 2 }, "7d": { online: 9, listening: 5 }, "30d": { online: 9, listening: 6 } },
  funnel: { visit: 40, live: 30, tune: 12, call: 2 },
  funnelPhone: { visit: 30, live: 22, tune: 8, call: 1 },
  digest: {
    ageH: 2,
    due: "2026-10-05",
    written: { "2026-10-05": { sha: "abc1234", at: "2026-10-05T17:41:00Z" } },
    copied: { "2026-10-05": "2026-10-05T17:41:05Z" },
    error: null,
  },
  funnelVerdict: null,
  mutations: { ageH: 8, conclusion: "success", mutationCheck: ["success", "success", "success", "success"] },
  liveActive: "active",
  liveHealth: { ok: true, clients: 42, messagesLastHour: 17, slowMode: false, cpu: { pct: 2.5, windowS: 900 } },
};

let dir: string;
let root: string;
let server: Server;
let api: string;
let world: World;
let sinceAsked: string | null;
/** Where the stub "installed" vhost lives; a copy of the repo's unless a test edits it. */
let installedVhost: string;

function git(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile(
      "git",
      ["-c", "user.email=t@t", "-c", "user.name=t", ...args],
      { cwd: root },
      (err, out) => (err ? reject(err) : resolve(out.trim())),
    ),
  );
}

async function run(): Promise<{ code: number; out: string }> {
  const bin = path.join(dir, "bin");
  const lastTrigger = new Date(Date.now() - world.sampleAgeS * 1000).toUTCString();
  await writeFile(
    path.join(bin, "systemctl"),
    [
      "#!/bin/sh",
      `case "$*" in`,
      `  "is-active highdesert") echo "${world.serviceActive}";;`,
      `  "is-active highdesert-mirror") echo "${world.oldGatewayActive}";;`,
      `  "is-active highdesert-live") echo "${world.liveActive}";;`,
      `  *"highdesert-sample.timer -p ActiveState"*) echo "${world.timerState}";;`,
      `  *"highdesert-sample.timer -p LastTriggerUSec"*) echo "${lastTrigger}";;`,
      `  *"highdesert-sample.service -p Result"*) echo "${world.sampleResult}";;`,
      "esac",
    ].join("\n"),
    { mode: 0o755 },
  );
  await writeFile(
    path.join(bin, "npm"),
    `#!/bin/sh\necho '${JSON.stringify({ metadata: { vulnerabilities: { ...world.audit, moderate: 0, low: 0 } } })}'\n`,
    { mode: 0o755 },
  );
  await writeFile(
    path.join(bin, "backup-status"),
    world.backupOk
      ? `#!/bin/sh\necho 'DB BACKUP OK — fresh'\n${world.backupMacSkipped ? "echo 'WARN  off-box (Mac) copy skipped: Mac has 300MB free, needs 501MB'\n" : ""}exit 0\n`
      : "#!/bin/sh\necho 'DB BACKUP STALE — newest dump is 40h old'\nexit 1\n",
    { mode: 0o755 },
  );
  await writeFile(
    path.join(bin, "presence-check"),
    `#!/bin/sh\necho 'launching chromium'\necho '${world.presence.out}'\nexit ${world.presence.rc}\n`,
    { mode: 0o755 },
  );
  // sar -u's shape: a header, one row per sample, an Average row (not a sample).
  const sar = [
    "Linux 6.8.0 (vps)  09/24/2026  _x86_64_  (2 CPU)",
    "",
    "00:00:01        CPU     %user     %nice   %system   %iowait    %steal     %idle",
    ...world.steal.map((st, i) => `0${i}:00:01        all      5.00      0.00      2.00      0.10  ${st.toFixed(2).padStart(8)}     80.00`),
    ...(world.steal.length ? ["Average:        all      5.00      0.00      2.00      0.10     99.00     80.00"] : []),
  ].join("\n");
  await writeFile(path.join(bin, "sar.txt"), sar + "\n");
  await writeFile(path.join(bin, "sar"), `#!/bin/sh\ncat "${path.join(bin, "sar.txt")}"\n`, { mode: 0o755 });
  await writeFile(path.join(bin, "cpu"), `#!/bin/sh\nprintf '%s\\n' '${world.cpu.out.split("\n").join("' '")}'\nexit ${world.cpu.rc}\n`, { mode: 0o755 });
  const pins = path.join(dir, "pins");
  const fill = path.join(dir, "proxy");
  await rm(pins, { recursive: true, force: true });
  await rm(fill, { recursive: true, force: true });
  await mkdir(pins);
  await mkdir(path.join(fill, "a", "bc"), { recursive: true });
  await writeFile(path.join(pins, "archive:c:a.mp3"), "");
  await truncate(path.join(pins, "archive:c:a.mp3"), world.pinnedBytes);
  await writeFile(path.join(fill, "a", "bc", "slice"), "");
  await truncate(path.join(fill, "a", "bc", "slice"), world.fillCacheBytes);
  const meminfoFile = path.join(dir, "meminfo");
  if (world.memory) {
    const m = world.memory;
    await writeFile(
      meminfoFile,
      [
        `MemTotal:       ${m.totalKb} kB`,
        `MemFree:        ${Math.floor(m.availKb / 2)} kB`,
        `MemAvailable:   ${m.availKb} kB`,
        `SwapTotal:      ${m.swapTotalKb} kB`,
        `SwapFree:       ${m.swapFreeKb} kB`,
        "",
      ].join("\n"),
    );
  } else {
    await rm(meminfoFile, { force: true });
  }
  const warmFile = path.join(dir, "warm-status.json");
  if (world.warm) {
    const { ageH, ...rest } = world.warm;
    await writeFile(warmFile, JSON.stringify({ at: new Date(Date.now() - ageH * 3_600_000).toISOString(), ...rest }));
  } else {
    await rm(warmFile, { force: true });
  }
  const verdictFile = path.join(dir, "funnel-verdict.json");
  if (world.funnelVerdict) {
    const { ageH, ...rest } = world.funnelVerdict;
    await writeFile(verdictFile, JSON.stringify({ checkedAt: new Date(Date.now() - ageH * 3_600_000).toISOString(), ...rest }));
  } else {
    await rm(verdictFile, { force: true });
  }
  const digestFile = path.join(dir, "digest.json");
  if (world.digest) {
    const { ageH, ...rest } = world.digest;
    await writeFile(digestFile, JSON.stringify({ checkedAt: new Date(Date.now() - ageH * 3_600_000).toISOString(), ...rest }));
  } else {
    await rm(digestFile, { force: true });
  }
  const mutationsFile = path.join(dir, "mutations.json");
  if (world.mutations && world.mutations !== "unreadable") {
    const { ageH, ...rest } = world.mutations;
    await writeFile(
      mutationsFile,
      JSON.stringify({
        databaseId: 4242,
        headSha: "0123456789abcdef0123456789abcdef01234567",
        url: "https://github.com/o/r/actions/runs/4242",
        createdAt: new Date(Date.now() - ageH * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z"),
        ...rest,
      }),
    );
  } else {
    await writeFile(mutationsFile, "{}");
  }
  await writeFile(
    path.join(bin, "mutations"),
    world.mutations === "unreadable" ? "#!/bin/sh\necho 'HTTP 502' >&2\nexit 1\n" : `#!/bin/sh\ncat "${mutationsFile}"\n`,
    { mode: 0o755 },
  );
  const head = await git("rev-parse", "--short", "HEAD");
  const deployed = world.deployedIsHead ? head : await git("rev-parse", "--short", "HEAD~1");
  await writeFile(path.join(root, ".deploy/deployed"), `${deployed} 2026-09-21T14:00:00Z\n`);
  await writeFile(path.join(root, ".deploy/history"), world.history.map((l) => `${l}\n`).join(""));
  if (world.releaseAt) {
    await writeFile(
      path.join(root, "docs/reliability-baseline.md"),
      `# Reliability baseline\n\n**Release deployed:** \`${world.releaseAt}\` (abc1234)\n`,
    );
  } else {
    await rm(path.join(root, "docs/reliability-baseline.md"), { force: true });
  }

  return new Promise((resolve) => {
    execFile(
      "bash",
      [SCRIPT],
      {
        env: {
          ...process.env,
          HD_ROOT: root,
          HD_API: api,
          HD_SYSTEMCTL: path.join(bin, "systemctl"),
          HD_NPM: path.join(bin, "npm"),
          HD_BACKUP_STATUS_CMD: path.join(bin, "backup-status"),
          HD_INSTALLED_UNIT: path.join(root, "deploy/highdesert.service"),
          HD_INSTALLED_VHOST: installedVhost,
          HD_PRESENCE_CMD: path.join(bin, "presence-check"),
          HD_SAR_CMD: path.join(bin, "sar"),
          HD_MIRROR_MANIFEST_URL: `${api}/mirror/manifest`,
          HD_MIRROR_PINS: pins,
          HD_MIRROR_PROXY_CACHE: fill,
          HD_CPU_CMD: path.join(bin, "cpu"),
          HD_LIVE: api,
          HD_WARM_STATUS: warmFile,
          HD_FUNNEL_VERDICT: verdictFile,
          HD_DIGEST_STATUS: digestFile,
          HD_MUTATIONS_CMD: path.join(bin, "mutations"),
          HD_MEMINFO: path.join(dir, "meminfo"),
        },
        timeout: 30_000,
      },
      (err, stdout, stderr) => {
        const code = err ? Number((err as { code?: number }).code ?? 1) : 0;
        resolve({ code, out: stdout + stderr });
      },
    );
  });
}

function lineFor(out: string, area: string): string {
  return out.split("\n").find((l) => l.split(/\s+/)[1] === area) ?? "";
}

beforeEach(async () => {
  world = {
    ...HEALTHY,
    audit: { ...HEALTHY.audit },
    release: { ...HEALTHY.release },
    presence: { ...HEALTHY.presence },
    steal: [...HEALTHY.steal],
    memory: { ...HEALTHY.memory! },
    mirrorManifest: { ...HEALTHY.mirrorManifest!, fileHashes: [...HEALTHY.mirrorManifest!.fileHashes] },
    cpu: { ...HEALTHY.cpu },
    warm: { ...HEALTHY.warm! },
    liveHealth: { ...HEALTHY.liveHealth },
  };
  sinceAsked = null;
  dir = await mkdtemp(path.join(tmpdir(), "hd-status-"));
  root = path.join(dir, "High-Desert");
  await mkdir(path.join(root, "deploy"), { recursive: true });
  await mkdir(path.join(root, ".deploy"));
  await mkdir(path.join(root, "docs"));
  await mkdir(path.join(dir, "bin"));
  await copyFile(UNIT, path.join(root, "deploy/highdesert.service"));
  await mkdir(path.join(root, "deploy/nginx"));
  await copyFile(VHOST, path.join(root, "deploy/nginx/highdesert.conf"));
  installedVhost = path.join(dir, "installed-vhost.conf");
  await copyFile(VHOST, installedVhost);
  await writeFile(path.join(root, ".gitignore"), ".deploy\n");
  await git("init", "-q");
  await git("add", "-A");
  await git("commit", "-qm", "one");
  await writeFile(path.join(root, "two.txt"), "2");
  await git("add", "-A");
  await git("commit", "-qm", "two");

  server = createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/api/stats/failures")) {
      const since = new URL(req.url, "http://x").searchParams.get("since");
      if (since) {
        sinceAsked = since;
        const from = new Date(since);
        const to = new Date(from.getTime() + world.release.days * 86_400_000);
        res.end(
          JSON.stringify({
            summary: { failures: world.failures },
            window: {
              from: from.toISOString(),
              to: to.toISOString(),
              failures: world.release.failures + world.releaseOther.reduce((n, b) => n + b.failures, 0),
              recovered: world.release.recovered + world.releaseOther.reduce((n, b) => n + b.recovered, 0),
              plays: world.release.plays + world.releaseOther.reduce((n, b) => n + b.plays, 0),
              ...(world.noBuildSplit
                ? {}
                : {
                    byBuild: [
                      { build: "abc1234", failures: world.release.failures, recovered: world.release.recovered, plays: world.release.plays },
                      ...world.releaseOther,
                    ],
                  }),
            },
          }),
        );
        return;
      }
      res.end(JSON.stringify({ summary: { failures: world.failures } }));
    } else if (req.url?.startsWith("/api/stats/traffic")) {
      const range = new URL(req.url, "http://x").searchParams.get("range");
      const peak = world.peaks[range as "24h" | "7d" | "30d"];
      res.end(
        JSON.stringify({
          playsInRange: world.plays,
          playsBySource: range === "24h" ? { archive: 40, mirror: world.mirrorPlays24h } : {},
          ...(peak ? { peakOnline: peak.online, peakListening: peak.listening } : {}),
        }),
      );
    } else if (req.url === "/api/stats/funnel?days=7") {
      if (!world.funnel) res.statusCode = 503;
      res.end(JSON.stringify(world.funnel ? { days: 7, cohorts: [], totals: world.funnel, ...(world.funnelPhone ? { byDevice: { phone: world.funnelPhone, desktop: world.funnel } } : {}) } : { error: "Stats unavailable" }));
    } else if (req.url === "/live-api/health") {
      if (!world.liveHealth) res.statusCode = 502;
      res.end(JSON.stringify(world.liveHealth ?? {}));
    } else if (req.url === "/mirror/manifest") {
      if (!world.mirrorManifest) {
        res.statusCode = 502;
        res.setHeader("content-type", "text/html");
        res.end("<html>502 Bad Gateway</html>");
        return;
      }
      res.end(JSON.stringify(world.mirrorManifest));
    } else {
      res.statusCode = 404;
      res.end("{}");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await rm(dir, { recursive: true, force: true });
});

describe("highdesert-status", () => {
  it("is all OK, and exits 0, when everything is healthy", async () => {
    const r = await run();
    expect(r.out).not.toMatch(/^FAIL/m);
    expect(lineFor(r.out, "failures")).toContain("5.0% of starts failed in 7 days (15 failures / 300 plays)");
    expect(r.code).toBe(0);
  });

  describe("funnel line", () => {
    it("says how far the week's first visits got, each step as a share of the arrivals", async () => {
      const r = await run();
      expect(lineFor(r.out, "funnel")).toBe(
        "OK    funnel    7d: 40 first visits > 30 saw Live (75%) > 12 tuned in (30%) > 2 called (5%); phones: 30 > 73% saw Live > 27% tuned in > 3% called",
      );
    });

    it("leaves the phones out when there were none, or the server does not split by device", async () => {
      world.funnelPhone = { visit: 0, live: 0, tune: 0, call: 0 };
      expect(lineFor((await run()).out, "funnel")).toBe(
        "OK    funnel    7d: 40 first visits > 30 saw Live (75%) > 12 tuned in (30%) > 2 called (5%)",
      );
      world.funnelPhone = null;
      expect(lineFor((await run()).out, "funnel")).toBe(
        "OK    funnel    7d: 40 first visits > 30 saw Live (75%) > 12 tuned in (30%) > 2 called (5%)",
      );
    });

    it("no arrivals is not a division by zero", async () => {
      world.funnel = { visit: 0, live: 0, tune: 0, call: 0 };
      expect(lineFor((await run()).out, "funnel")).toBe("OK    funnel    no first visits in 7 days");
    });

    const FUNNEL = "OK    funnel    7d: 40 first visits > 30 saw Live (75%) > 12 tuned in (30%) > 2 called (5%); phones: 30 > 73% saw Live > 27% tuned in > 3% called";

    it("before the verdict: how far the after cohort has got toward it", async () => {
      world.funnelVerdict = { ageH: 2, since: "2026-09-28", threshold: 300, after: { visit: 44, live: 42, tune: 28, call: 2, days: 1 }, error: null };
      expect(lineFor((await run()).out, "funnel")).toBe(`${FUNNEL}; after (phones from 2026-09-28): 44 of 300 arrivals for a verdict`);
    });

    it("once written: the verdict itself, and whether it has reached the doc and the Mac", async () => {
      const verdict = {
        writtenAt: "2026-10-01T17:40:00Z",
        before: { visit: 20, tune: 13 },
        after: { visit: 310, tune: 215 },
        cmp: { diff: 4, lo: -17, hi: 25, word: "no difference the data can see" },
      };
      world.funnelVerdict = { ageH: 2, since: "2026-09-28", threshold: 300, after: { visit: 320 }, verdict, pushedSha: "abc1234", copiedAt: "2026-10-01T17:40:05Z", error: null };
      const said = "; verdict 2026-10-01: phones tuned in 13 of 20 before, 215 of 310 after, 4 points (-17 to 25): no difference the data can see";
      expect(lineFor((await run()).out, "funnel")).toBe(`${FUNNEL}${said}`);
      world.funnelVerdict = { ...world.funnelVerdict, copiedAt: null, error: "ssh: connect to host macbook: timed out" };
      expect(lineFor((await run()).out, "funnel")).toBe(`${FUNNEL}${said} (not on the Mac yet) (last run: ssh: connect to host macbook: timed out)`);
    });

    it("WARNs when the verdict job has stopped running", async () => {
      world.funnelVerdict = { ageH: 40, since: "2026-09-28", threshold: 300, after: { visit: 44 }, error: null };
      expect(lineFor((await run()).out, "funnel")).toMatch(/^WARN\s+funnel\s+.*44 of 300 arrivals for a verdict \(verdict job last ran 40h ago\)$/);
    });

    it("WARNs, and does not fail the run, when the funnel cannot be read", async () => {
      world.funnel = null;
      const r = await run();
      expect(lineFor(r.out, "funnel")).toMatch(/^WARN\s+funnel\s+could not read/);
      expect(r.code).toBe(0);
    });
  });

  describe("peaks line", () => {
    it("is OK when the peaks nest, and says what they are", async () => {
      const r = await run();
      expect(lineFor(r.out, "peaks")).toBe(
        "OK    peaks     nested: online 4 / 9 / 9, listening 2 / 5 / 6 (24h / 7d / 30d)",
      );
    });

    // One case per ordering: each of the four comparisons must be able to fail
    // the line on its own. The 2026-09-25 numbers (14 / 12 / 10 online) broke two.
    const violations: [string, World["peaks"]][] = [
      ["30d online below 7d", { "24h": { online: 4, listening: 2 }, "7d": { online: 9, listening: 5 }, "30d": { online: 8, listening: 6 } }],
      ["7d online below 24h", { "24h": { online: 10, listening: 2 }, "7d": { online: 9, listening: 5 }, "30d": { online: 11, listening: 6 } }],
      ["30d listening below 7d", { "24h": { online: 4, listening: 2 }, "7d": { online: 9, listening: 5 }, "30d": { online: 9, listening: 4 } }],
      ["7d listening below 24h", { "24h": { online: 4, listening: 6 }, "7d": { online: 9, listening: 5 }, "30d": { online: 9, listening: 7 } }],
    ];
    for (const [name, peaks] of violations) {
      it(`FAILs when ${name}`, async () => {
        world.peaks = peaks;
        const r = await run();
        expect(lineFor(r.out, "peaks")).toMatch(/^FAIL\s+peaks\s+a longer window reports a lower peak/);
        expect(r.code).not.toBe(0);
      });
    }

    it("FAILs when a range's peaks cannot be read", async () => {
      world.peaks = { "24h": { online: 4, listening: 2 }, "7d": { online: 9, listening: 5 } };
      const r = await run();
      expect(lineFor(r.out, "peaks")).toMatch(/^FAIL\s+peaks\s+could not read/);
      expect(r.code).not.toBe(0);
    });
  });

  describe("release line", () => {
    it("measures from the timestamp in docs/reliability-baseline.md; under 300 plays it gives counts, never a percentage", async () => {
      const r = await run();
      expect(sinceAsked).toBe("2026-09-21T15:50:00Z");
      const l = lineFor(r.out, "release");
      expect(l).toBe(
        "OK    release   4 starts lost in 200 plays on this release's builds so far, no verdict until 300 plays; 0 rescued by the retry or the mirror (7 of 7 days since 2026-09-21T15:50:00Z; target <3% lost)",
      );
      expect(l.slice(0, l.indexOf("target"))).not.toContain("%");
    });

    it("one failure in one play is a count and no verdict, not \"100% failed\", and reads OK", async () => {
      world.release = { failures: 1, recovered: 0, plays: 1, days: 0.1 };
      const r = await run();
      expect(lineFor(r.out, "release")).toBe(
        "OK    release   1 start lost in 1 play on this release's builds so far, no verdict until 300 plays; 0 rescued by the retry or the mirror (0.1 of 7 days since 2026-09-21T15:50:00Z; target <3% lost)",
      );
    });

    it("under 300 plays, over the 3% target still reads OK: that is a verdict, and there is none yet", async () => {
      world.release = { failures: 10, recovered: 0, plays: 200, days: 3 };
      expect(lineFor((await run()).out, "release")).toMatch(/^OK\s+release\s+10 starts lost in 200 plays/);
    });

    it("the tripwire: 10% or more lost on at least 30 plays WARNs before the verdict", async () => {
      world.release = { failures: 3, recovered: 0, plays: 30, days: 0.5 };
      const r = await run();
      expect(lineFor(r.out, "release")).toBe(
        "WARN  release   3 starts lost in 30 plays on this release's builds so far, no verdict until 300 plays; 0 rescued by the retry or the mirror (0.5 of 7 days since 2026-09-21T15:50:00Z; target <3% lost); tripwire: 10% or more lost on 30+ plays",
      );
      expect(r.code).toBe(0);
    });

    it("the tripwire needs 30 plays, and counts only lost starts", async () => {
      world.release = { failures: 3, recovered: 0, plays: 29, days: 0.5 };
      expect(lineFor((await run()).out, "release")).toMatch(/^OK\s+release\s+3 starts lost in 29 plays/);
      // 6 failures on 40 plays is 15%, but 4 were rescued: 2 lost is 5%.
      world.release = { failures: 6, recovered: 4, plays: 40, days: 0.5 };
      expect(lineFor((await run()).out, "release")).toMatch(/^OK\s+release\s+2 starts lost in 40 plays/);
    });

    it("from 300 plays it leads with the share of starts lost, OK under 3%", async () => {
      world.release = { failures: 6, recovered: 0, plays: 300, days: 7 };
      const r = await run();
      expect(lineFor(r.out, "release")).toBe(
        "OK    release   2.0% of starts lost on this release's builds in the 7 of 7 days since 2026-09-21T15:50:00Z (6 lost / 300 plays; target <3%); 0 rescued by the retry or the mirror (0.0%)",
      );
    });

    it("WARNs at 3% lost, and only WARNs: a bad week is not an outage", async () => {
      world.release = { failures: 9, recovered: 0, plays: 300, days: 2.5 };
      const r = await run();
      expect(lineFor(r.out, "release")).toMatch(/^WARN\s+release\s+3\.0% of starts lost on this release's builds in the 2\.5 of 7 days/);
      expect(r.code).toBe(0);
    });

    it("a start the retry or the mirror rescued is shown beside the headline, not held to the target", async () => {
      // 20 failures on 300 plays read 6.7% before 2026-09-28. The listener lost 3 of them.
      world.release = { failures: 20, recovered: 17, plays: 300, days: 7 };
      const r = await run();
      expect(lineFor(r.out, "release")).toBe(
        "OK    release   1.0% of starts lost on this release's builds in the 7 of 7 days since 2026-09-21T15:50:00Z (3 lost / 300 plays; target <3%); 17 rescued by the retry or the mirror (5.7%)",
      );
    });

    it("says so when there have been no plays yet, rather than dividing by zero", async () => {
      world.release = { failures: 0, recovered: 0, plays: 0, days: 0.1 };
      const r = await run();
      expect(lineFor(r.out, "release")).toMatch(/^OK\s+release\s+no plays yet on this release's builds since the release/);
    });

    it("counts only the release's builds; old and untagged rows are shown beside it, not dropped", async () => {
      // 4 lost of 200 on the release. Mixed in, an old tab's rows would add 7 lost and 20 plays.
      world.releaseOther = [
        { build: "0ld0001", failures: 5, recovered: 2, plays: 12 },
        { build: null, failures: 4, recovered: 0, plays: 8 },
      ];
      const r = await run();
      expect(lineFor(r.out, "release")).toBe(
        "OK    release   4 starts lost in 200 plays on this release's builds so far, no verdict until 300 plays; 0 rescued by the retry or the mirror (7 of 7 days since 2026-09-21T15:50:00Z; target <3% lost); older builds: 7 lost, 2 rescued / 20 plays, counted apart",
      );
    });

    it("a build deployed after the release instant is the release; one deployed before is not", async () => {
      world.history = ["0ld0001 2026-09-20T10:00:00Z", "abc1234 2026-09-21T15:50:00Z", "d0c5678 2026-09-22T09:00:00Z"];
      world.releaseOther = [
        { build: "d0c5678", failures: 2, recovered: 1, plays: 100 },
        { build: "0ld0001", failures: 3, recovered: 0, plays: 3 },
      ];
      const r = await run();
      expect(lineFor(r.out, "release")).toBe(
        "OK    release   1.7% of starts lost on this release's builds in the 7 of 7 days since 2026-09-21T15:50:00Z (5 lost / 300 plays; target <3%); 1 rescued by the retry or the mirror (0.3%); older builds: 3 lost, 0 rescued / 3 plays, counted apart",
      );
    });

    it("an API without the build split still gets a line, and says it could not split", async () => {
      world.noBuildSplit = true;
      world.releaseOther = [{ build: null, failures: 1, recovered: 1, plays: 10 }];
      const r = await run();
      expect(lineFor(r.out, "release")).toMatch(
        /^OK\s+release\s+4 starts lost in 210 plays \(all builds: the API gave no build split\) so far, no verdict until 300 plays; 1 rescued/,
      );
    });

    it("WARNs, and asks the API nothing, when there is no baseline to measure from", async () => {
      world.releaseAt = null;
      const r = await run();
      expect(lineFor(r.out, "release")).toMatch(/^WARN\s+release\s+no '\*\*Release deployed:\*\*' timestamp/);
      expect(sinceAsked).toBeNull();
      expect(r.code).toBe(0);
    });
  });

  it("FAILs on a deployed commit that is not HEAD", async () => {
    world.deployedIsHead = false;
    const r = await run();
    expect(lineFor(r.out, "deploy")).toMatch(/^FAIL.*DRIFT.*1 commit\(s\) not deployed/);
    expect(r.code).not.toBe(0);
  });

  it("FAILs on any critical or high npm advisory", async () => {
    world.audit.high = 2;
    const r = await run();
    expect(lineFor(r.out, "audit")).toMatch(/^FAIL.*0 critical, 2 high/);
    expect(r.code).not.toBe(0);
  });

  it("FAILs when the sampler timer is not running", async () => {
    world.timerState = "inactive";
    const r = await run();
    expect(lineFor(r.out, "sampler")).toMatch(/^FAIL.*inactive/);
    expect(r.code).not.toBe(0);
  });

  it("FAILs when the last sample is too old, even with the timer active", async () => {
    world.sampleAgeS = 3600;
    const r = await run();
    expect(lineFor(r.out, "sampler")).toMatch(/^FAIL.*last sample/);
    expect(r.code).not.toBe(0);
  });

  it("FAILs when the backup is stale", async () => {
    world.backupOk = false;
    const r = await run();
    expect(lineFor(r.out, "backup")).toMatch(/^FAIL.*STALE/);
    expect(r.code).not.toBe(0);
  });

  it("WARNs, and still exits 0, when the backup's Mac copy was skipped", async () => {
    world.backupMacSkipped = true;
    const r = await run();
    const backupLines = r.out.split("\n").filter((l) => l.split(/\s+/)[1] === "backup");
    expect(backupLines[0]).toMatch(/^OK/);
    expect(backupLines[1]).toMatch(/^WARN.*off-box \(Mac\) copy skipped: Mac has 300MB free/);
    expect(r.code).toBe(0);
  });

  describe("nginx line", () => {
    it("is OK when the installed vhost is the versioned one", async () => {
      const r = await run();
      expect(lineFor(r.out, "nginx")).toBe("OK    nginx     vhost matches deploy/nginx/highdesert.conf");
    });

    it("WARNs — and only WARNs — when the installed vhost has drifted", async () => {
      // The realistic drift: someone removes the limit by hand in /etc.
      await writeFile(installedVhost, "server { location / { proxy_pass http://highdesert_app; } }\n");
      const r = await run();
      expect(lineFor(r.out, "nginx")).toBe(
        `WARN  nginx     ${installedVhost} differs from deploy/nginx/highdesert.conf`,
      );
      expect(r.code).toBe(0);
    });

    it("WARNs when there is no installed vhost to compare", async () => {
      await rm(installedVhost);
      const r = await run();
      expect(lineFor(r.out, "nginx")).toMatch(/^WARN .*no vhost at/);
    });
  });

  it("FAILs when the service is down", async () => {
    world.serviceActive = "failed";
    const r = await run();
    expect(lineFor(r.out, "service")).toMatch(/^FAIL/);
    expect(r.code).not.toBe(0);
  });

  it("only WARNs on a high failure rate — it is a product metric, not an outage", async () => {
    world.failures = 60;
    const r = await run();
    expect(lineFor(r.out, "failures")).toMatch(/^WARN.*20\.0%/);
    expect(r.code).toBe(0);
  });

  describe("steal line", () => {
    it("is the mean of the last three samples, not the day's Average row or older samples", async () => {
      const r = await run();
      expect(lineFor(r.out, "steal")).toMatch(/^OK\s+steal\s+5\.0% hypervisor steal over 30 min/);
    });
    it("WARNs above 20%", async () => {
      world.steal = [0, 20, 22, 24];
      const r = await run();
      expect(lineFor(r.out, "steal")).toMatch(/^WARN\s+steal\s+22\.0%/);
      expect(r.code).toBe(0);
    });
    it("is still OK at exactly 20%", async () => {
      world.steal = [20, 20, 20];
      expect(lineFor((await run()).out, "steal")).toMatch(/^OK\s+steal\s+20\.0%/);
    });
    it("FAILs above 50%, and exits non-zero", async () => {
      world.steal = [51, 51, 51];
      const r = await run();
      expect(lineFor(r.out, "steal")).toMatch(/^FAIL\s+steal\s+51\.0%/);
      expect(r.code).toBe(1);
    });
    it("WARNs — does not report 0% — when sysstat has no samples", async () => {
      world.steal = [];
      expect(lineFor((await run()).out, "steal")).toMatch(/^WARN\s+steal\s+no sysstat samples/);
    });
  });

  describe("memory line", () => {
    it("reports available memory and swap, OK at 15% or more", async () => {
      const r = await run();
      expect(lineFor(r.out, "memory")).toBe("OK    memory    37.5% available (2.9 of 7.6 GB); swap 2.0 of 12.0 GB used");
    });
    it("is still OK at exactly 15%", async () => {
      world.memory = { ...world.memory!, availKb: 1_200_000 };
      expect(lineFor((await run()).out, "memory")).toMatch(/^OK\s+memory\s+15\.0% available/);
    });
    it("WARNs under 15%, and exits 0", async () => {
      world.memory = { ...world.memory!, availKb: 1_040_000 };
      const r = await run();
      expect(lineFor(r.out, "memory")).toMatch(/^WARN\s+memory\s+13\.0% available .*\(WARN under 15%\)$/);
      expect(r.code).toBe(0);
    });
    it("FAILs under 5%, and exits non-zero", async () => {
      world.memory = { ...world.memory!, availKb: 392_000 };
      const r = await run();
      expect(lineFor(r.out, "memory")).toMatch(/^FAIL\s+memory\s+4\.9% available .*\(FAIL under 5%\)$/);
      expect(r.code).toBe(1);
    });
    it("WARNs when meminfo cannot be read, rather than reporting nothing", async () => {
      world.memory = null;
      expect(lineFor((await run()).out, "memory")).toMatch(/^WARN\s+memory\s+could not read MemAvailable/);
    });
  });

  describe("mirror and warm lines", () => {
    it("reports pins and their bytes, the fill cache, the manifest and 24h mirror plays", async () => {
      const r = await run();
      expect(lineFor(r.out, "mirror")).toMatch(
        /^OK\s+mirror\s+nginx: 3 pinned \(14\.0 GB\), fill cache 2\.0 GB, manifest 0123456789abcdef, 7 mirror play\(s\) in 24h$/,
      );
      expect(r.out).not.toMatch(/peer/);
      expect(lineFor(r.out, "warm")).toMatch(/^OK\s+warm\s+last run .* \(ok\): 120 pinned \(14\.0 GB\), 4 fetched, 0 failed$/);
    });
    it("FAILs when the manifest does not answer", async () => {
      world.mirrorManifest = null;
      const r = await run();
      expect(lineFor(r.out, "mirror")).toMatch(/^FAIL\s+mirror\s+.*\/mirror\/manifest did not answer with a manifest/);
      expect(r.code).toBe(1);
    });
    it("FAILs when the manifest lists no pins", async () => {
      world.mirrorManifest = { version: "e3b0c44298fc1c14", count: 0, pinned: 0, fileHashes: [] };
      const r = await run();
      expect(lineFor(r.out, "mirror")).toMatch(/^FAIL\s+mirror\s+the manifest lists no pinned episodes/);
      expect(r.code).toBe(1);
    });
    it("WARNs if the retired webtorrent gateway is running again", async () => {
      world.oldGatewayActive = "active";
      expect(lineFor((await run()).out, "mirror")).toMatch(/^WARN\s+mirror\s+highdesert-mirror \(the retired webtorrent gateway\) is running again/);
    });
    it("warm: WARNs STALE past 36h — a job that never ran cannot report its own absence", async () => {
      world.warm!.ageH = 37;
      const r = await run();
      expect(lineFor(r.out, "warm")).toMatch(/^WARN\s+warm\s+STALE: .*\(37h ago/);
      expect(r.code).toBe(0);
    });
    it("warm: WARNs when it skipped itself for steal", async () => {
      world.warm = { ...world.warm!, outcome: "skipped-steal", steal: 34.5 };
      expect(lineFor((await run()).out, "warm")).toMatch(/^WARN\s+warm\s+.*skipped itself: steal 34\.5%/);
    });
    it("warm: WARNs when any fetch failed", async () => {
      world.warm!.failed = 2;
      expect(lineFor((await run()).out, "warm")).toMatch(/^WARN\s+warm\s+.*2 failed$/);
    });
    it("warm: WARNs when it has never run", async () => {
      world.warm = null;
      expect(lineFor((await run()).out, "warm")).toMatch(/^WARN\s+warm\s+no .* never run/);
    });
    it("warm: WARNs when pins are below the target, with the shortfall and the disk", async () => {
      world.warm = {
        ...world.warm!,
        outcome: "stopped-at-floor",
        pinned: 318,
        bytes: 14.5 * 2 ** 30,
        targetPinned: 331,
        targetMissing: 13,
        targetBytes: 15 * 2 ** 30,
        freeBytes: 7.1 * 2 ** 30,
        floorBytes: 10 * 2 ** 30,
      };
      const r = await run();
      expect(lineFor(r.out, "warm")).toMatch(
        /^WARN\s+warm\s+pins below target: 318 of the top 331 pinned \(14\.5 GB of 15\.0 GB\); stopped-at-floor, disk free 7\.1 GB against a 10\.0 GB floor/,
      );
      expect(r.code).toBe(0);
    });
    it("warm: a status from before the target was recorded still WARNs on stopping at the floor", async () => {
      world.warm = { ...world.warm!, outcome: "stopped-at-floor" };
      expect(lineFor((await run()).out, "warm")).toMatch(/^WARN\s+warm\s+pins below target: stopped-at-floor/);
    });
    it("warm: OK when every top pin is in", async () => {
      world.warm = { ...world.warm!, targetPinned: 120, targetMissing: 0 };
      expect(lineFor((await run()).out, "warm")).toMatch(/^OK\s+warm\s/);
    });
  });

  it("presence: OK with the check's last line when the surfaces agree", async () => {
    const r = await run();
    expect(lineFor(r.out, "presence")).toMatch(/^OK\s+presence\s+surfaces agree in 3 view\(s\)$/);
  });

  it("presence: FAIL, and a non-zero exit, when the surfaces disagree", async () => {
    world.presence = { rc: 1, out: "desktop /stats: on-air says 10/5, status-bar says 8/3" };
    const r = await run();
    expect(lineFor(r.out, "presence")).toMatch(/^FAIL\s+presence\s+surfaces disagree: desktop \/stats: on-air says 10\/5/);
    expect(r.code).not.toBe(0);
  });

  it("presence: WARN, not FAIL, when the check itself cannot run", async () => {
    world.presence = { rc: 2, out: "could not load playwright" };
    const r = await run();
    expect(lineFor(r.out, "presence")).toMatch(/^WARN\s+presence\s+check did not run \(exit 2\): could not load playwright$/);
    expect(r.out).not.toMatch(/^FAIL/m);
  });

  describe("live line (the phone lines and the 10% rule)", () => {
    it("reports callers, messages, and hd-cpu-sample's 15-minute figure for highdesert-live", async () => {
      const r = await run();
      expect(lineFor(r.out, "live")).toMatch(
        /^OK\s+live\s+42 caller\(s\) connected, 17 message\(s\) in the last hour; CPU 3\.1% of one core over 15 min \(hd-cpu-sample\), limit 10%$/,
      );
      expect(r.code).toBe(0);
    });
    it("says when slow mode is on", async () => {
      world.liveHealth = { ...world.liveHealth, slowMode: true };
      expect(lineFor((await run()).out, "live")).toMatch(/^OK\s+live\s+.*in the last hour, slow mode on;/);
    });
    it("FAILs, and exits non-zero, when highdesert-live is over 10% — and judges its own row, not another unit's", async () => {
      world.cpu = { rc: 0, out: "highdesert 2.0\nhighdesert-live 10.4" };
      const r = await run();
      expect(lineFor(r.out, "live")).toMatch(/^FAIL\s+live\s+OVER THE 10% RULE: CPU 10\.4% of one core over 15 min \(hd-cpu-sample\)/);
      expect(r.code).toBe(1);
    });
    it("is OK at exactly 10%, and another unit over 10% is the cpu line's to report, not this one's", async () => {
      world.cpu = { rc: 0, out: "highdesert-mirror-warm 44.0\nhighdesert-live 10.0" };
      const r = await run();
      expect(lineFor(r.out, "live")).toMatch(/^OK\s+live\s+.*CPU 10\.0% of one core/);
      expect(lineFor(r.out, "cpu")).toMatch(/^FAIL\s+cpu\s+.*highdesert-mirror-warm 44\.0%/);
    });
    it("falls back to the service's own average while the sampler's window is partial (exit 3), and says so", async () => {
      world.cpu = { rc: 3, out: "only 120s of samples in the last 900s, need 810s" };
      world.liveHealth = { ...world.liveHealth, cpu: { pct: 12.5, windowS: 900 } };
      const r = await run();
      expect(lineFor(r.out, "live")).toMatch(/^FAIL\s+live\s+OVER THE 10% RULE: CPU 12\.5% .*\(the service's own average; hd-cpu-sample has no 15-min figure/);
      expect(r.code).toBe(1);
    });
    it("falls back too when the sampler has no row for the unit yet", async () => {
      world.cpu = { rc: 0, out: "highdesert 4.2" };
      expect(lineFor((await run()).out, "live")).toMatch(/^OK\s+live\s+.*CPU 2\.5% .*\(the service's own average/);
    });
    it("WARNs, never reports 0%, when neither source has a number", async () => {
      world.cpu = { rc: 3, out: "only 0s of samples" };
      world.liveHealth = { ...world.liveHealth, cpu: null };
      expect(lineFor((await run()).out, "live")).toMatch(/^WARN\s+live\s+.*CPU not measurable yet/);
    });
    it("FAILs when the service is down", async () => {
      world.liveActive = "inactive";
      const r = await run();
      expect(lineFor(r.out, "live")).toMatch(/^FAIL\s+live\s+highdesert-live is not active/);
      expect(r.code).toBe(1);
    });
    it("FAILs when the service is up but health does not answer", async () => {
      world.liveHealth = null;
      expect(lineFor((await run()).out, "live")).toMatch(/^FAIL\s+live\s+active, but .*did not answer/);
    });
  });

  describe("cpu line", () => {
    it("OK, naming the busiest unit, when every unit is under 10% of a core", async () => {
      const r = await run();
      expect(lineFor(r.out, "cpu")).toMatch(/^OK\s+cpu\s+every High Desert unit under 10% of a core over 15 min \(highest: highdesert 3\.2%\)$/);
    });
    it("FAILs, and exits non-zero, when any unit averages over 10%", async () => {
      world.cpu.out = "highdesert 3.2\nhighdesert-mirror-warm 46.8\nhighdesert-sample 10.4";
      const r = await run();
      expect(lineFor(r.out, "cpu")).toMatch(/^FAIL\s+cpu\s+over 10% of a core, 15-min mean: highdesert-mirror-warm 46\.8%, highdesert-sample 10\.4%$/);
      expect(r.code).toBe(1);
    });
    it("exactly 10% is not over", async () => {
      world.cpu.out = "highdesert 10.0";
      expect(lineFor((await run()).out, "cpu")).toMatch(/^OK\s+cpu/);
    });
    it("WARNs, not FAILs, while the sampler does not yet hold 15 minutes", async () => {
      world.cpu = { rc: 3, out: "only 240s of samples, need 810s" };
      const r = await run();
      expect(lineFor(r.out, "cpu")).toMatch(/^WARN\s+cpu\s+no 15-minute CPU figure \(exit 3\): only 240s of samples, need 810s$/);
      expect(r.out).not.toMatch(/^FAIL/m);
    });
  });

  describe("mutations line (the nightly full run holds the whole list)", () => {
    it("OK when the newest nightly run checked every shard and all went red", async () => {
      expect(lineFor((await run()).out, "mutations")).toMatch(
        /^OK\s+mutations\s+nightly full run on 0123456 \(.*\): every mutation red in all 4 shards$/,
      );
    });

    it("FAILs, and the command exits non-zero, when a mutation survived", async () => {
      world.mutations = { ageH: 8, conclusion: "failure", mutationCheck: ["success", "failure", "success", "success"] };
      const r = await run();
      expect(lineFor(r.out, "mutations")).toMatch(
        /^FAIL\s+mutations\s+nightly full run on 0123456 .*: 1 of 4 shard\(s\) had a mutation survive or go stale: https:\/\/github.com\/o\/r\/actions\/runs\/4242$/,
      );
      expect(r.code).not.toBe(0);
    });

    it("FAILs on survivors however old the run is", async () => {
      world.mutations = { ageH: 80, conclusion: "failure", mutationCheck: ["failure", "success", "success", "success"] };
      expect(lineFor((await run()).out, "mutations")).toMatch(/^FAIL\s+mutations/);
    });

    it("WARNs when the run broke before every shard checked", async () => {
      world.mutations = { ageH: 8, conclusion: "failure", mutationCheck: ["success", "success"] };
      expect(lineFor((await run()).out, "mutations")).toMatch(/^WARN\s+mutations\s+.* ended failure before every shard checked/);
      world.mutations = { ageH: 8, conclusion: "cancelled", mutationCheck: ["success", "success", "success", "success"] };
      expect(lineFor((await run()).out, "mutations")).toMatch(/^WARN\s+mutations\s+.* ended cancelled/);
    });

    it("WARNs when the nightly run has stopped running", async () => {
      world.mutations = { ageH: 40, conclusion: "success", mutationCheck: ["success", "success", "success", "success"] };
      expect(lineFor((await run()).out, "mutations")).toMatch(/^WARN\s+mutations\s+the last nightly full run was 40h ago/);
    });

    it("WARNs, never OK, with no run or no answer from GitHub", async () => {
      world.mutations = null;
      expect(lineFor((await run()).out, "mutations")).toMatch(/^WARN\s+mutations\s+no nightly full mutation run yet/);
      world.mutations = "unreadable";
      expect(lineFor((await run()).out, "mutations")).toMatch(/^WARN\s+mutations\s+could not read/);
    });
  });

  describe("scripts/nightly-mutations.sh (what the mutations line reads)", () => {
    const HELPER = path.resolve(__dirname, "../nightly-mutations.sh");
    const helper = async (list: unknown[], jobs: unknown) => {
      const gh = path.join(dir, "bin", "gh");
      await writeFile(path.join(dir, "list.json"), JSON.stringify(list));
      await writeFile(path.join(dir, "jobs.json"), JSON.stringify(jobs));
      await writeFile(
        gh,
        [
          "#!/bin/sh",
          `echo "$*" >> "${path.join(dir, "gh.log")}"`,
          `case "$1 $2" in`,
          `  "run list") cat "${path.join(dir, "list.json")}";;`,
          `  "run view") cat "${path.join(dir, "jobs.json")}";;`,
          "esac",
        ].join("\n"),
        { mode: 0o755 },
      );
      return new Promise<string>((resolve, reject) =>
        execFile("bash", [HELPER], { env: { ...process.env, HD_GH: gh } }, (err, out) => (err ? reject(err) : resolve(out))),
      );
    };

    it("asks for the newest finished scheduled run on main and reports each shard's mutation check", async () => {
      const out = await helper(
        [{ databaseId: 7, conclusion: "failure", createdAt: "2026-09-29T09:31:00Z", headSha: "abc", url: "u" }],
        {
          jobs: [
            { name: "mutations (1/4)", steps: [{ name: "Install dependencies", conclusion: "success" }, { name: "Mutation check", conclusion: "success" }] },
            { name: "mutations (2/4)", steps: [{ name: "Mutation check", conclusion: "failure" }] },
          ],
        },
      );
      expect(JSON.parse(out)).toEqual({
        databaseId: 7,
        conclusion: "failure",
        createdAt: "2026-09-29T09:31:00Z",
        headSha: "abc",
        url: "u",
        mutationCheck: ["success", "failure"],
      });
      const { readFile } = await import("node:fs/promises");
      const asked = await readFile(path.join(dir, "gh.log"), "utf8");
      expect(asked).toMatch(/run list .*--workflow mutations\.yml --event schedule --branch main --status completed --limit 1/);
      expect(asked).toMatch(/run view 7 /);
    });

    it("prints {} when there has never been a nightly run", async () => {
      expect(JSON.parse(await helper([], { jobs: [] }))).toEqual({});
    });
  });

  describe("digest line (the weekly report, scripts/digest.mjs)", () => {
    const W = { "2026-10-05": { sha: "abc1234", at: "2026-10-05T17:41:00Z" } };

    it("written and on the Mac: OK, saying which week", async () => {
      expect(lineFor((await run()).out, "digest")).toBe(
        "OK    digest    docs/digest/2026-10-05.md written 2026-10-05T17:41:00Z, on the Mac 2026-10-05T17:41:05Z",
      );
    });

    it("never run: WARN, naming the timer", async () => {
      world.digest = null;
      expect(lineFor((await run()).out, "digest")).toMatch(/^WARN\s+digest\s+the digest job has never run/);
    });

    it("not run for 36h: WARN (a skipped night leaves no other trace)", async () => {
      world.digest = { ageH: 40, due: "2026-10-05", written: W, copied: {}, error: null };
      expect(lineFor((await run()).out, "digest")).toMatch(/^WARN\s+digest\s+the digest job last ran 40h ago/);
    });

    it("the week's not written: WARN, with the job's error", async () => {
      world.digest = { ageH: 1, due: "2026-10-12", written: W, copied: {}, error: "git push: rejected" };
      expect(lineFor((await run()).out, "digest")).toBe("WARN  digest    the digest for 2026-10-12 is not written (last run: git push: rejected)");
    });

    it("before the first week: OK, saying when the first is", async () => {
      world.digest = { ageH: 1, due: null, firstDue: "2026-10-05", written: {}, copied: {}, error: null };
      expect(lineFor((await run()).out, "digest")).toBe("OK    digest    none due yet: the first is 2026-10-05, 17:40 UTC");
    });

    it("waiting for the Mac: OK for two days (it is often asleep), then WARN", async () => {
      const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
      world.digest = { ageH: 1, due: "2026-10-05", written: { "2026-10-05": { at: at(20) } }, copied: {}, error: "ssh: timed out" };
      expect(lineFor((await run()).out, "digest")).toMatch(/^OK\s+digest\s+docs\/digest\/2026-10-05\.md written .* \(not on the Mac yet; retried daily\)$/);
      world.digest = { ageH: 1, due: "2026-10-05", written: { "2026-10-05": { at: at(50) } }, copied: {}, error: "ssh: timed out" };
      expect(lineFor((await run()).out, "digest")).toMatch(/^WARN\s+digest\s+docs\/digest\/2026-10-05\.md written .*, not on the Mac after 50h \(last run: ssh: timed out\)$/);
    });
  });
});
