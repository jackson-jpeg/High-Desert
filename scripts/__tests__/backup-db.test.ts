// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, stat, utimes } from "node:fs/promises";
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
    // Never GitHub from a test: the offsite leg has its own block below, against a local bare repo.
    HD_BACKUP_OFFSITE: "",
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
  // FAKE_FREE_OVER_DUMP_MB answers relative to the dump this run just wrote
  // (its size in whole MB, plus that many), so the floor tests hold whatever
  // the test database weighs. A fixed figure assumed a dump under 1 MB, and the
  // shared test database grew past it.
  await writeFile(
    path.join(dir, "ssh-stub"),
    [
      "#!/bin/sh",
      'for a in "$@"; do case "$a" in *df*)',
      '  if [ -n "$FAKE_FREE_OVER_DUMP_MB" ]; then',
      '    newest=""',
      '    for f in "$HD_BACKUP_DIR"/highdesert-*.dump; do',
      '      [ -e "$f" ] || continue',
      '      if [ -z "$newest" ] || [ "$f" -nt "$newest" ]; then newest="$f"; fi',
      "    done",
      '    bytes=$(stat -c %s "$newest")',
      "    echo $(( (bytes + 1048575) / 1048576 + FAKE_FREE_OVER_DUMP_MB ))",
      '  else echo "$FAKE_FREE_MB"; fi',
      "  exit 0;; esac; done",
      "exit 0",
      "",
    ].join("\n"),
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

  // The floor is the dump's own size (whole MB, rounded up) plus 500 MB, not a
  // fixed number of gigabytes. The Mac's free space is answered relative to the
  // dump the run wrote, so these hold at any dump size.
  async function dumpMb(): Promise<number> {
    const [file] = await dumps();
    return Math.ceil((await stat(path.join(backupDir, file))).size / 1048576);
  }

  it("skips the Mac copy, with a warning, when the Mac lacks room for the dump plus 500 MB", async () => {
    const r = await sh(BACKUP, backupEnv({ FAKE_FREE_OVER_DUMP_MB: "499" }));
    expect(r.code).toBe(0);
    expect(await rsyncCalls()).toHaveLength(0);
    expect(await dumps()).toHaveLength(1);
    const mb = await dumpMb();
    expect(r.out).toContain(`WARN skipped: Mac has ${mb + 499}MB free, needs ${mb + 500}MB (dump + 500MB)`);
    const status = await sh(STATUS, statusEnv());
    expect(status.code).toBe(0);
    expect(status.out).toMatch(/^DB BACKUP OK/);
    expect(status.out).toContain(`WARN  off-box (Mac) copy skipped: Mac has ${mb + 499}MB free`);
  });

  it("copies to a Mac with far less than 5 GB free when the dump fits", async () => {
    const r = await sh(BACKUP, backupEnv({ FAKE_FREE_OVER_DUMP_MB: "500" }));
    expect(r.code).toBe(0);
    expect(await dumpMb()).toBeLessThan(5120 - 500); // else this would not test the fixed floor
    expect(await rsyncCalls()).toHaveLength(1);
    const status = await sh(STATUS, statusEnv());
    expect(status.out).not.toMatch(/^WARN/m);
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

/**
 * The encrypted off-box copy (scripts/backup-offsite.sh), run for real: real
 * age, a real dump from the test database, pushed to a local bare repository
 * standing in for GitHub, then cloned, decrypted and restored.
 */
describeDb("backup-offsite.sh (encrypted copy, restore test)", () => {
  const marker = `offsite-test-${process.pid}-${Date.now()}`;
  let bare: string;
  let key: string;
  let pub: string;

  const run = (cmd: string, args: string[], env: Record<string, string> = {}) =>
    new Promise<{ code: number; out: string }>((resolve) =>
      execFile(cmd, args, { env: { ...process.env, ...env }, timeout: 60_000, maxBuffer: 64 << 20 }, (err, out, errOut) =>
        resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, out: String(out) + String(errOut) }),
      ),
    );
  const offsiteEnv = (extra: Record<string, string> = {}) =>
    backupEnv({
      HD_BACKUP_OFFSITE: path.resolve(__dirname, "../backup-offsite.sh"),
      HD_OFFSITE_RECIPIENT: pub,
      HD_OFFSITE_IDENTITY: key,
      HD_OFFSITE_REMOTE: bare,
      HD_OFFSITE_WORK: path.join(dir, "offsite"),
      ...extra,
    });
  async function cloned(): Promise<{ files: string[]; commits: number; at: string }> {
    const at = path.join(dir, `clone-${Math.random().toString(36).slice(2)}`);
    await run("git", ["clone", "-q", bare, at]);
    const log = await run("git", ["-C", at, "rev-list", "--count", "HEAD"]);
    return { files: (await readdir(at)).filter((f) => f !== ".git").sort(), commits: Number(log.out.trim()), at };
  }

  beforeEach(async () => {
    await psql(`INSERT INTO play_events (episode_id, played_at) VALUES ('${marker}', '2001-01-01T00:00:00Z')`);
    bare = path.join(dir, "remote.git");
    await run("git", ["init", "-q", "--bare", "-b", "main", bare]);
    key = path.join(dir, "age.key");
    pub = path.join(dir, "age.pub");
    await run("age-keygen", ["-o", key]);
    const r = await run("age-keygen", ["-y", key]);
    await writeFile(pub, r.out.trim() + "\n");
  });
  afterEach(async () => {
    await psql(`DELETE FROM play_events WHERE episode_id = '${marker}'`);
  });

  it("pushes the dump encrypted, and the pushed copy restores the rows", async () => {
    const r = await sh(BACKUP, offsiteEnv());
    expect(r.code, r.out).toBe(0);
    const status = await readFile(statusFile, "utf8");
    expect(status).toMatch(/offsite_result=ok, 1 kept \(1 new, 0 dropped\), restore test ok/);
    const { files, at } = await cloned();
    const [enc] = files.filter((f) => f.endsWith(".dump.age"));
    expect(files).toEqual(expect.arrayContaining(["README.md", enc, enc.replace(/\.age$/, ".sha256")]));
    // Ciphertext: the marker is nowhere in what was pushed.
    expect((await readFile(path.join(at, enc))).includes(Buffer.from(marker))).toBe(false);
    // The restore: decrypt the pushed copy, then pg_restore reads the row back.
    const plain = path.join(dir, "restored.dump");
    expect((await run("age", ["-d", "-i", key, "-o", plain, path.join(at, enc)])).code).toBe(0);
    const sql = await run("pg_restore", ["--data-only", "--table=play_events", "-f", "-", plain]);
    expect(sql.out).toContain(marker);
  });

  it("keeps what the VPS keeps and no history: a pruned dump leaves the repo, one commit", async () => {
    expect((await sh(BACKUP, offsiteEnv())).code).toBe(0);
    const [first] = await dumps();
    await age(first, 15 * 24);
    await new Promise((res) => setTimeout(res, 1100)); // a new stamp
    expect((await sh(BACKUP, offsiteEnv())).code).toBe(0);
    const { files, commits } = await cloned();
    expect(files.filter((f) => f.endsWith(".age"))).toEqual([`${(await dumps())[0]}.age`]);
    expect(files.some((f) => f.startsWith(first))).toBe(false);
    expect(commits).toBe(1);
  });

  it("a copy that does not decrypt to its dump fails the leg, and the status says so", async () => {
    expect((await sh(BACKUP, offsiteEnv())).code).toBe(0);
    const [d] = await dumps();
    const enc = path.join(dir, "offsite", "files", `${d}.age`);
    const other = path.join(dir, "other");
    await writeFile(other, "not the dump");
    await run("age", ["-R", pub, "-o", enc, other]);
    // The next run makes a newer dump, so the bad copy is not the newest: every
    // copy is checked, not only the one pg_restore reads (CI found this).
    await new Promise((res) => setTimeout(res, 1100));
    const r = await sh(BACKUP, offsiteEnv());
    expect(r.code).toBe(0); // the VPS dump stands; the leg is a warning
    expect(await readFile(statusFile, "utf8")).toMatch(/offsite_result=skipped: failed: .* decrypts to different bytes/);
    const s = await sh(STATUS, statusEnv());
    expect(s.out).toMatch(/WARN  encrypted off-box \(GitHub\) copy skipped: failed/);
  });
});

