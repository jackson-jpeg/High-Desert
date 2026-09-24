// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, copyFile } from "node:fs/promises";
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
      res.end(JSON.stringify({ playsInRange: world.plays }));
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
});
