// @vitest-environment node
import { it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_DATABASE_URL, describeDb } from "../../src/test-support/test-db";

/**
 * scripts/live-setup.sh --link, run for real against the test database.
 *
 * Its first production run failed at exactly this step: the nonce was inserted
 * with `psql -v h=… -c "… (:'h', …)"`, and psql does not interpolate variables
 * in a -c string, so the statement was a syntax error and no link was ever
 * minted (the role creation had the same bug). Only running the script against
 * a real psql could have shown it. `id` and `scp` are stubbed — root is not
 * what is under test, and the Mac is "unreachable", so the link is staged.
 */

const SCRIPT = path.resolve(__dirname, "../live-setup.sh");

let dir: string;
let links: string;

function psql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("psql", [TEST_DATABASE_URL, "-Atqc", sql], (err, stdout, stderr) =>
      err ? reject(new Error(stderr || String(err))) : resolve(stdout.trim()),
    );
  });
}

function link(): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [SCRIPT, "--link"],
      {
        env: {
          ...process.env,
          PATH: `${path.join(dir, "bin")}:${process.env.PATH}`,
          HD_APP_ENV_FILE: path.join(dir, "app.env"),
          HD_LIVE_ENV_FILE: path.join(dir, "live.env"),
          HD_LIVE_LINK_DIR: links,
        },
        timeout: 60_000,
      },
      (err, stdout, stderr) => resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, out: stdout + stderr }),
    );
  });
}

describeDb("scripts/live-setup.sh --link", () => {
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hd-live-setup-"));
    links = path.join(dir, "links");
    await mkdir(path.join(dir, "bin"));
    for (const [name, body] of [
      ["id", 'echo 0'],
      ["scp", "exit 1"],
    ]) {
      await writeFile(path.join(dir, "bin", name), `#!/bin/sh\n${body}\n`);
      await chmod(path.join(dir, "bin", name), 0o755);
    }
    await writeFile(path.join(dir, "app.env"), `DATABASE_URL=${TEST_DATABASE_URL}\n`);
    // A long-lived token that must never appear in the link file.
    await writeFile(path.join(dir, "live.env"), `LIVE_ADMIN_TOKEN=${"ab".repeat(32)}\n`);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("stores the nonce's hash, stages a link carrying the nonce and not the token", async () => {
    const r = await link();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/staged at/);

    const files = await readdir(links);
    expect(files).toHaveLength(1);
    const text = await readFile(path.join(links, files[0]), "utf8");
    const m = /\/live-api\/admin\/signin-page#([0-9a-f]{64})\b/.exec(text);
    expect(m, text).not.toBeNull();
    const nonce = m![1];
    expect(text).not.toContain("ab".repeat(32));

    const hash = createHash("sha256").update(nonce).digest("hex");
    try {
      const row = await psql(
        `SELECT expires_at > now() + interval '23 hours' AND expires_at <= now() + interval '24 hours' FROM live_admin_nonces WHERE hash = '${hash}'`,
      );
      expect(row, "the nonce's hash is stored, valid for 24 hours").toBe("t");
      // Only the hash: the nonce itself is nowhere in the table.
      expect(await psql(`SELECT count(*) FROM live_admin_nonces WHERE hash = '${nonce}'`)).toBe("0");
    } finally {
      await psql(`DELETE FROM live_admin_nonces WHERE hash = '${hash}'`);
    }
  });
});
