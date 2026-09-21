// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

/**
 * scripts/deploy.sh, driven for real against a throwaway project directory, a
 * stub systemctl and a fake server.
 *
 * The properties under test are the ones whose absence has already cost users
 * a working site, or would have:
 *
 *   - a failed build leaves the live build exactly where it was, and nothing
 *     is restarted;
 *   - "verified" means a server answered, every page returned 200, every page
 *     referenced at least one chunk, and every chunk returned 200 — a dead
 *     server used to verify as "0 broken chunks";
 *   - a deploy that fails verification puts the previous build back.
 *
 * The fake server decides what to serve by reading `.next/marker` in the
 * project directory on every request, so it serves whichever build deploy.sh
 * has renamed into place — the same way `next start` reads `.next` from disk.
 */

const SCRIPT = path.resolve(__dirname, "../deploy.sh");

type Mode = "good" | "no-chunks" | "bad-chunk" | "page-500";

interface Harness {
  root: string;
  port: number;
  server: Server | null;
  systemctlLog: string;
}

let h: Harness;

function run(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(
      "bash",
      [SCRIPT, ...args],
      {
        env: {
          ...process.env,
          HD_ROOT: h.root,
          HD_PORT: String(h.port),
          HD_SYSTEMCTL: path.join(h.root, "..", "systemctl-stub"),
          HD_BUILD_CMD: `bash ${path.join(h.root, "..", "fake-build.sh")}`,
          HD_WAIT_SECS: "3",
          HD_STAGE_DIR: path.join(h.root, "..", "stage"),
          ...env,
        },
        timeout: 60_000,
      },
      (err, stdout, stderr) => {
        const code = err ? ((err as { code?: number }).code ?? 1) : 0;
        resolve({ code: typeof code === "number" ? code : 1, out: stdout + stderr });
      },
    );
  });
}

async function marker(dir: string): Promise<string | null> {
  try {
    return (await readFile(path.join(h.root, dir, "marker"), "utf8")).trim();
  } catch {
    return null;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function git(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile("git", args, { cwd: h.root }, (err, out) => (err ? reject(err) : resolve(out.trim()))),
  );
}

/** Serve pages according to the `marker` of whichever build is live. */
function startServer(): Promise<void> {
  const server = createServer(async (req, res) => {
    const mode = ((await marker(".next")) ?? "good").split(":")[0] as Mode;
    const url = req.url ?? "/";
    if (url.startsWith("/_next/static/chunks/")) {
      const ok = !(mode === "bad-chunk" && url.includes("broken"));
      res.writeHead(ok ? 200 : 404).end("//js");
      return;
    }
    if (mode === "page-500") {
      res.writeHead(500).end("error");
      return;
    }
    const scripts =
      mode === "no-chunks"
        ? ""
        : mode === "bad-chunk"
          ? '<script src="/_next/static/chunks/app-1.js"></script><script src="/_next/static/chunks/broken-2.js"></script>'
          : '<script src="/_next/static/chunks/app-1.js"></script>';
    res.writeHead(200, { "content-type": "text/html" }).end(`<html>${scripts}</html>`);
  });
  h.server = server;
  return new Promise((resolve) => server.listen(h.port, "127.0.0.1", () => resolve()));
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
  const port = (s.address() as AddressInfo).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

beforeEach(async () => {
  const base = await mkdtemp(path.join(tmpdir(), "hd-deploy-"));
  const root = path.join(base, "High-Desert");
  await mkdir(root);
  h = { root, port: await freePort(), server: null, systemctlLog: path.join(base, "systemctl.log") };

  await writeFile(path.join(base, "systemctl-stub"), `#!/bin/sh\necho "$@" >> "${h.systemctlLog}"\n`, {
    mode: 0o755,
  });
  // A build that writes a registration chunk carrying HEAD's short sha, like the
  // real one, plus a marker naming what the fake server should serve. The
  // behaviour of the *new* build comes from $FAKE_BUILD.
  await writeFile(
    path.join(base, "fake-build.sh"),
    [
      "set -e",
      // next build empties its distDir before compiling. That is the whole
      // reason a build must never target the live directory.
      'rm -rf "$HD_DIST_DIR"',
      'if [ "$FAKE_BUILD" = "fail" ]; then echo "Type error: nope" >&2; exit 1; fi',
      'mkdir -p "$HD_DIST_DIR/static/chunks"',
      'echo "register(\\"/sw.js?v=$(git rev-parse --short HEAD)\\")" > "$HD_DIST_DIR/static/chunks/reg.js"',
      'echo "${FAKE_BUILD:-good}:new" > "$HD_DIST_DIR/marker"',
    ].join("\n"),
  );

  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await writeFile(path.join(root, ".gitignore"), "/node_modules\n/.next*\n/.deploy\n");
  await git("init", "-q");
  await git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init");

  // Dependencies already match the lockfile, so deploy takes the in-place path.
  const { createHash } = await import("node:crypto");
  await mkdir(path.join(root, "node_modules"));
  await writeFile(
    path.join(root, "node_modules/.hd-lock-sha256"),
    createHash("sha256").update("{}\n").digest("hex") + "\n",
  );

  // The currently-live build.
  await mkdir(path.join(root, ".next"));
  await writeFile(path.join(root, ".next/marker"), "good:old\n");
});

afterEach(async () => {
  if (h.server) await new Promise<void>((r) => h.server!.close(() => r()));
  await rm(path.dirname(h.root), { recursive: true, force: true });
});

async function restarts(): Promise<number> {
  try {
    return (await readFile(h.systemctlLog, "utf8")).split("\n").filter((l) => l.startsWith("restart")).length;
  } catch {
    return 0;
  }
}

describe("deploy.sh --verify-only", () => {
  it("passes when every page is 200 and every chunk loads", async () => {
    await startServer();
    const r = await run(["--verify-only"]);
    expect(r.out).toContain("chunks=1");
    expect(r.code).toBe(0);
  });

  it("fails when no server is listening", async () => {
    const r = await run(["--verify-only"]);
    expect(r.out).toContain("never answered");
    expect(r.code).not.toBe(0);
  });

  it("fails when pages reference no chunks at all", async () => {
    await writeFile(path.join(h.root, ".next/marker"), "no-chunks:old\n");
    await startServer();
    const r = await run(["--verify-only"]);
    expect(r.out).toContain("references no chunks");
    expect(r.code).not.toBe(0);
  });

  it("fails when a referenced chunk is missing", async () => {
    await writeFile(path.join(h.root, ".next/marker"), "bad-chunk:old\n");
    await startServer();
    const r = await run(["--verify-only"]);
    expect(r.out).toContain("404 /_next/static/chunks/broken-2.js");
    expect(r.code).not.toBe(0);
  });

  it("fails when a page is not 200, even if it links chunks", async () => {
    await writeFile(path.join(h.root, ".next/marker"), "page-500:old\n");
    await startServer();
    const r = await run(["--verify-only"]);
    expect(r.out).toContain("did not return 200");
    expect(r.code).not.toBe(0);
  });
});

describe("deploy.sh", () => {
  it("a failed build leaves the live build in place and restarts nothing", async () => {
    await startServer();
    const r = await run([], { FAKE_BUILD: "fail" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("live site is untouched");
    expect(await marker(".next")).toBe("good:old");
    expect(await exists(path.join(h.root, ".next.prev"))).toBe(false);
    expect(await exists(path.join(h.root, ".next-staging"))).toBe(false);
    expect(await restarts()).toBe(0);
  });

  it("a good build is swapped in, the old one kept as .next.prev", async () => {
    await startServer();
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(await marker(".next")).toBe("good:new");
    expect(await marker(".next.prev")).toBe("good:old");
    expect(await restarts()).toBe(1);
  });

  it("a build that fails verification is rolled back automatically", async () => {
    await startServer();
    const r = await run([], { FAKE_BUILD: "no-chunks" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("rolled back");
    expect(await marker(".next")).toBe("good:old");
    expect(await restarts()).toBe(2);
  });

  it("refuses a dirty tree", async () => {
    await writeFile(path.join(h.root, "uncommitted.txt"), "x");
    const r = await run([]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Uncommitted changes");
    expect(await marker(".next")).toBe("good:old");
  });
});

describe("deploy.sh --rollback", () => {
  it("swaps the previous build back in and restarts", async () => {
    await startServer();
    expect((await run([])).code).toBe(0);
    const r = await run(["--rollback"]);
    expect(r.code).toBe(0);
    expect(await marker(".next")).toBe("good:old");
    expect(await marker(".next.prev")).toBe("good:new");
    expect(await restarts()).toBe(2);
  });

  it("refuses when there is no previous build", async () => {
    const r = await run(["--rollback"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("no previous build");
    expect(await marker(".next")).toBe("good:old");
  });
});
