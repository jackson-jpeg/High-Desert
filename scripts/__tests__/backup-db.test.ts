// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_DATABASE_URL, describeDb } from "../../src/test-support/test-db";

/**
 * scripts/backup-db.sh and scripts/backup-status.sh, run for real.
 *
 * The dump tests use the real pg_dump/pg_restore against TEST_DATABASE_URL and
 * read the dumped rows back out, so "a backup was written" means the data is
 * in it. The Mac leg runs against stub ssh/rsync — what matters there is the
 * decision (copy, or skip and say why), not the transport.
 */

const BACKUP = path.resolve(__dirname, "../backup-db.sh");
const STATUS = path.resolve(__dirname, "../backup-status.sh");

let dir: string;
let backupDir: string;
let statusFile: string;
let rsyncLog: string;

function sh(
  script: string,
  env: Record<string, string>,
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile("bash", [script], { env: { ...process.env, ...env }, timeout: 60_000 }, (err, stdout, stderr) => {
      const code = err ? Number((err as { code?: number }).code ?? 1) : 0;
      resolve({ code, out: stdout + stderr });
    });
  });
}

function backupEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    DATABASE_URL: TEST_DATABASE_URL,
    HD_BACKUP_DIR: backupDir,
    HD_BACKUP_STATUS: statusFile,
    HD_BACKUP_LOG: path.join(dir, "backup.log"),
    HD_BACKUP_MAC_HOST: "fakemac",
    HD_BACKUP_MAC_DEST: "/fake/dest",
    HD_BACKUP_SSH: path.join(dir, "ssh-stub"),
    HD_BACKUP_RSYNC: path.join(dir, "rsync-stub"),
    FAKE_FREE_MB: "99999",
    ...extra,
  };
}

function statusEnv(): Record<string, string> {
  return { HD_BACKUP_DIR: backupDir, HD_BACKUP_STATUS: statusFile };
}

async function dumps(): Promise<string[]> {
  return (await readdir(backupDir)).filter((f) => /^highdesert-.*\.dump$/.test(f)).sort();
}

async function age(file: string, hours: number): Promise<void> {
  const t = new Date(Date.now() - hours * 3600_000);
  await utimes(path.join(backupDir, file), t, t);
}

async function rsyncCalls(): Promise<string[]> {
  try {
    return (await readFile(rsyncLog, "utf8")).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function psql(sql: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("psql", [TEST_DATABASE_URL, "-tAc", sql], (err, out) => (err ? reject(err) : resolve(out.trim()))),
  );
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "hd-backup-"));
  backupDir = path.join(dir, "backups");
  statusFile = path.join(dir, "state", "STATUS");
  rsyncLog = path.join(dir, "rsync.log");
  await mkdir(backupDir, { recursive: true });
  // `ssh host "df -m / | …"` prints free MB; `ssh host mkdir …` succeeds.
  await writeFile(
    path.join(dir, "ssh-stub"),
    '#!/bin/sh\nfor a in "$@"; do case "$a" in *df*) echo "$FAKE_FREE_MB"; exit 0;; esac; done\nexit 0\n',
    { mode: 0o755 },
  );
  await writeFile(path.join(dir, "rsync-stub"), `#!/bin/sh\necho "$@" >> "${rsyncLog}"\n`, { mode: 0o755 });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describeDb("backup-db.sh", () => {
  const marker = `backup-test-${process.pid}-${Date.now()}`;

  beforeEach(async () => {
    // Dated far in the past so it sits outside the traffic rollup window that
    // src/services/stats/__tests__/store.db.test.ts measures in parallel.
    await psql(`INSERT INTO play_events (episode_id, played_at) VALUES ('${marker}', '2001-01-01T00:00:00Z')`);
  });
  afterEach(async () => {
    await psql(`DELETE FROM play_events WHERE episode_id = '${marker}'`);
  });

  it("writes a dump that restores the permanent tables' rows", async () => {
    const r = await sh(BACKUP, backupEnv());
    expect(r.code).toBe(0);
    const [dump] = await dumps();
    expect(dump).toBeDefined();

    const restored = await new Promise<string>((resolve, reject) =>
      execFile(
        "pg_restore",
        ["--data-only", "--table=play_events", "--file=-", path.join(backupDir, dump)],
        { maxBuffer: 64 * 1024 * 1024 },
        (err, out) => (err ? reject(err) : resolve(out)),
      ),
    );
    expect(restored).toContain(marker);
    expect(await readFile(statusFile, "utf8")).toContain("result=OK");
  });

  it("deletes dumps past the retention window and keeps the rest", async () => {
    for (const [name, hours] of [
      ["highdesert-20000101T000000Z.dump", 15 * 24],
      ["highdesert-20000102T000000Z.dump", 20 * 24],
      ["highdesert-20000103T000000Z.dump", 10 * 24],
    ] as const) {
      await writeFile(path.join(backupDir, name), "old");
      await age(name, hours);
    }
    const r = await sh(BACKUP, backupEnv());
    expect(r.code).toBe(0);
    const left = await dumps();
    expect(left).toContain("highdesert-20000103T000000Z.dump");
    expect(left).not.toContain("highdesert-20000101T000000Z.dump");
    expect(left).not.toContain("highdesert-20000102T000000Z.dump");
    expect(left).toHaveLength(2);
  });

  it("copies to the Mac when it has room", async () => {
    const r = await sh(BACKUP, backupEnv({ FAKE_FREE_MB: "99999" }));
    expect(r.code).toBe(0);
    const calls = await rsyncCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("fakemac:/fake/dest/");
    expect(await readFile(statusFile, "utf8")).toMatch(/mac_result=ok/);
  });

  it("skips the Mac copy, with a warning, when the Mac is under 5 GB free", async () => {
    const r = await sh(BACKUP, backupEnv({ FAKE_FREE_MB: "2921" }));
    expect(r.code).toBe(0);
    expect(await rsyncCalls()).toHaveLength(0);
    expect(r.out).toContain("WARN skipped: Mac has 2921MB free");
    expect(await dumps()).toHaveLength(1);
  });

  it("reports FAILED and leaves no dump when pg_dump cannot connect", async () => {
    const bad = new URL(TEST_DATABASE_URL);
    bad.password = "wrong-password";
    const r = await sh(BACKUP, backupEnv({ DATABASE_URL: bad.toString() }));
    expect(r.code).not.toBe(0);
    expect(await dumps()).toHaveLength(0);
    expect(await readFile(statusFile, "utf8")).toContain("result=FAILED");
  });
});

describe("backup-status.sh", () => {
  async function fakeRun(file: string, hoursOld: number, result = "OK"): Promise<void> {
    await writeFile(path.join(backupDir, file), "dump");
    await age(file, hoursOld);
    await mkdir(path.dirname(statusFile), { recursive: true });
    await writeFile(statusFile, `result=${result}\ndetail=x\nmac_result=ok\nmac_last_ok_epoch=0\n`);
  }

  it("is OK with a recent dump", async () => {
    await fakeRun("highdesert-20260921T173000Z.dump", 2);
    const r = await sh(STATUS, statusEnv());
    expect(r.out).toContain("DB BACKUP OK");
    expect(r.code).toBe(0);
  });

  it("is STALE once the newest dump is older than 36 hours", async () => {
    await fakeRun("highdesert-20260919T173000Z.dump", 37);
    const r = await sh(STATUS, statusEnv());
    expect(r.out).toContain("DB BACKUP STALE");
    expect(r.code).not.toBe(0);
  });

  it("is STALE when there is no dump at all", async () => {
    const r = await sh(STATUS, statusEnv());
    expect(r.out).toContain("DB BACKUP STALE");
    expect(r.code).not.toBe(0);
  });

  it("is FAILED when the last run failed, even with a fresh older dump", async () => {
    await fakeRun("highdesert-20260921T173000Z.dump", 2, "FAILED");
    const r = await sh(STATUS, statusEnv());
    expect(r.out).toContain("DB BACKUP FAILED");
    expect(r.code).not.toBe(0);
  });
});
