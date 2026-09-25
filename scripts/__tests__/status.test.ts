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
  release: { failures: number; plays: number; days: number };
  /** What the stub presence check prints and exits with. */
  presence: { rc: number; out: string };
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
  warm: { ageH: number; outcome: string; pinned: number; bytes: number; fetched: number; failed: number; steal?: number } | null;
  /** peakOnline / peakListening /api/stats/traffic answers per range; a missing range answers no peaks. */
  peaks: Partial<Record<"24h" | "7d" | "30d", { online: number; listening: number }>>;
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
  release: { failures: 4, plays: 200, days: 7 },
  presence: { rc: 0, out: "surfaces agree in 3 view(s)" },
  // The oldest sample is high on purpose: only the last three (30 min) count.
  steal: [90, 4, 5, 6],
  oldGatewayActive: "inactive",
  mirrorManifest: { version: "0123456789abcdef", count: 3, pinned: 3, fileHashes: ["archive:c:a.mp3", "archive:c:b.mp3", "archive:c:c.mp3"] },
  pinnedBytes: 14 * 2 ** 30,
  fillCacheBytes: 2 * 2 ** 30,
  mirrorPlays24h: 7,
  cpu: { rc: 0, out: "highdesert 3.2\nhighdesert-live 3.1\nhighdesert-sample 0.4\nhighdesert-mirror-warm 0.0\nhighdesert-backup 0.0" },
  warm: { ageH: 5, outcome: "ok", pinned: 120, bytes: 14 * 2 ** 30, fetched: 4, failed: 0 },
  peaks: { "24h": { online: 4, listening: 2 }, "7d": { online: 9, listening: 5 }, "30d": { online: 9, listening: 6 } },
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
  const warmFile = path.join(dir, "warm-status.json");
  if (world.warm) {
    const { ageH, ...rest } = world.warm;
    await writeFile(warmFile, JSON.stringify({ at: new Date(Date.now() - ageH * 3_600_000).toISOString(), ...rest }));
  } else {
    await rm(warmFile, { force: true });
  }
  const head = await git("rev-parse", "--short", "HEAD");
  const deployed = world.deployedIsHead ? head : await git("rev-parse", "--short", "HEAD~1");
  await writeFile(path.join(root, ".deploy/deployed"), `${deployed} 2026-09-21T14:00:00Z\n`);
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
            window: { from: from.toISOString(), to: to.toISOString(), ...world.release },
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
    it("measures from the timestamp in docs/reliability-baseline.md, and is OK under 3%", async () => {
      const r = await run();
      expect(sinceAsked).toBe("2026-09-21T15:50:00Z");
      expect(lineFor(r.out, "release")).toBe(
        "OK    release   2.0% of starts failed in the 7 of 7 days since 2026-09-21T15:50:00Z (4 failures / 200 plays; target <3%)",
      );
    });

    it("WARNs at 3% — and only WARNs: a bad week is not an outage", async () => {
      world.release = { failures: 6, plays: 200, days: 2.5 };
      const r = await run();
      expect(lineFor(r.out, "release")).toMatch(/^WARN\s+release\s+3\.0% of starts failed in the 2\.5 of 7 days/);
      expect(r.code).toBe(0);
    });

    it("says so when there have been no plays yet, rather than dividing by zero", async () => {
      world.release = { failures: 0, plays: 0, days: 0.1 };
      const r = await run();
      expect(lineFor(r.out, "release")).toMatch(/^OK\s+release\s+no plays yet since the release/);
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
});
