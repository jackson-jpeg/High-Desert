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

interface World {
  timerState: string;
  sampleAgeS: number;
  sampleResult: string;
  serviceActive: string;
  audit: { critical: number; high: number };
  failures: number;
  plays: number;
  backupOk: boolean;
  deployedIsHead: boolean;
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
  deployedIsHead: true,
};

let dir: string;
let root: string;
let server: Server;
let api: string;
let world: World;

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
      ? "#!/bin/sh\necho 'DB BACKUP OK — fresh'\nexit 0\n"
      : "#!/bin/sh\necho 'DB BACKUP STALE — newest dump is 40h old'\nexit 1\n",
    { mode: 0o755 },
  );
  const head = await git("rev-parse", "--short", "HEAD");
  const deployed = world.deployedIsHead ? head : await git("rev-parse", "--short", "HEAD~1");
  await writeFile(path.join(root, ".deploy/deployed"), `${deployed} 2026-09-21T14:00:00Z\n`);

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
  world = { ...HEALTHY, audit: { ...HEALTHY.audit } };
  dir = await mkdtemp(path.join(tmpdir(), "hd-status-"));
  root = path.join(dir, "High-Desert");
  await mkdir(path.join(root, "deploy"), { recursive: true });
  await mkdir(path.join(root, ".deploy"));
  await mkdir(path.join(dir, "bin"));
  await copyFile(UNIT, path.join(root, "deploy/highdesert.service"));
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
});
