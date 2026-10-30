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
 *   - a deploy that fails verification puts the previous build back;
 *   - the schema is applied only once the new build has passed, right before
 *     the switch: a failed build leaves the database untouched, and a failed
 *     schema swaps nothing (2026-10-12);
 *   - route types from earlier builds are gone before the build reads them.
 *
 * No test here can reach a real database: every run sets HD_SCHEMA_CMD to a
 * stub and HD_ENV_FILE to a path that does not exist.
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
          HD_HEAVY: path.join(h.root, "..", "heavy-stub"),
          HD_SCHEMA_CMD: path.join(h.root, "..", "schema-stub"),
          HD_ENV_FILE: path.join(h.root, "..", "no-such-env"),
          HD_RETURNING_CMD: `bash ${path.join(h.root, "..", "returning-stub")}`,
          HD_RETURNING_DIR: path.join(h.root, "..", "returning"),
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
      // tsc reads these (tsconfig.json): a stale route there fails the build.
      'if [ -e .next/types ] || [ -e .next-dev/types ]; then echo "Type error: stale route types" >&2; exit 1; fi',
      'if [ "$FAKE_BUILD" = "fail" ]; then echo "Type error: nope" >&2; exit 1; fi',
      'mkdir -p "$HD_DIST_DIR/static/chunks"',
      'echo "register(\\"/sw.js?v=$(git rev-parse --short HEAD)\\")" > "$HD_DIST_DIR/static/chunks/reg.js"',
      'echo "${FAKE_BUILD:-good}:new" > "$HD_DIST_DIR/marker"',
    ].join("\n"),
  );

  // The box-wide turn semaphore (scripts/heavy.sh): logs what took a turn, then
  // runs it. `npm ci` is faked here: it only has to leave a node_modules.
  await writeFile(
    path.join(base, "heavy-stub"),
    [
      "#!/bin/bash",
      `echo "$*" >> "${path.join(base, "heavy.log")}"`,
      'while [ "$1" != "--" ]; do shift; done; shift',
      'if [ "$1" = npm ]; then mkdir -p node_modules; exit 0; fi',
      'exec "$@"',
    ].join("\n"),
    { mode: 0o755 },
  );

  // The schema step: records what was live and whether a staged build existed
  // at the moment it ran. $FAKE_SCHEMA=fail makes it fail.
  await writeFile(
    path.join(base, "schema-stub"),
    [
      "#!/bin/bash",
      `echo "file=$1 staged=$([ -d .next-staging ] && echo yes || echo no) live=$(cat .next/marker)" >> "${path.join(base, "schema.log")}"`,
      'if [ "$FAKE_SCHEMA" = "fail" ]; then echo "ERROR: syntax error" >&2; exit 3; fi',
    ].join("\n"),
    { mode: 0o755 },
  );

  // The returning-visitor check: records its mode, browser and what was live;
  // $FAKE_RETURNING_<MODE> (prime/revisit/check) is its exit code.
  await writeFile(
    path.join(base, "returning-stub"),
    [
      "#!/bin/bash",
      `echo "$1 $3 live=$(cat .next/marker)" >> "${path.join(base, "returning.log")}"`,
      'var="FAKE_RETURNING_${1^^}"; exit "${!var:-0}"',
    ].join("\n"),
    { mode: 0o755 },
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

  it("the build takes its turn on the box through heavy", async () => {
    // Memory fell to 13% on 2026-09-28 with five builds and test runs at once
    // (docs/memory-2026-09-28.md); a deploy's build now waits for a slot.
    await startServer();
    expect((await run([])).code).toBe(0);
    const log = await readFile(path.join(h.root, "..", "heavy.log"), "utf8");
    expect(log).toContain(`--label high-desert bash -- bash ${path.join(h.root, "..", "fake-build.sh")}`);
  });

  it("with a changed lockfile, npm ci and the build both take their turn", async () => {
    await startServer();
    await writeFile(path.join(h.root, "package-lock.json"), '{"changed":true}\n');
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "deps");
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(await marker(".next")).toBe("good:new");
    const log = (await readFile(path.join(h.root, "..", "heavy.log"), "utf8")).split("\n");
    expect(log.some((l) => l.includes("--label high-desert npm -- npm ci"))).toBe(true);
    expect(log.some((l) => l.includes("-- bash ") && l.includes("fake-build.sh"))).toBe(true);
  });

  it("every deploy is appended to .deploy/history; a failed build adds nothing", async () => {
    // The release line counts rows from the builds deployed since the release
    // (scripts/status.sh), so this log is its input.
    await startServer();
    const history = async () =>
      (await readFile(path.join(h.root, ".deploy/history"), "utf8").catch(() => "")).split("\n").filter(Boolean);
    expect((await run([], { FAKE_BUILD: "fail" })).code).not.toBe(0);
    expect(await history()).toEqual([]);
    expect((await run([])).code).toBe(0);
    expect((await run([])).code).toBe(0);
    const head = await git("rev-parse", "--short", "HEAD");
    const lines = await history();
    expect(lines).toHaveLength(2);
    for (const l of lines) expect(l).toMatch(new RegExp(`^${head} \\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ$`));
    // The last line is what .deploy/deployed says is live.
    expect((await readFile(path.join(h.root, ".deploy/deployed"), "utf8")).trim()).toBe(lines[1]);
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

async function schemaRuns(): Promise<string[]> {
  return (await readFile(path.join(h.root, "..", "schema.log"), "utf8").catch(() => "")).split("\n").filter(Boolean);
}

async function commitSchema(sql: string): Promise<void> {
  await mkdir(path.join(h.root, "scripts"), { recursive: true });
  await writeFile(path.join(h.root, "scripts/schema.sql"), sql);
  await git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "schema");
}

describe("deploy.sh: the schema", () => {
  it("a failed build leaves the schema untouched", async () => {
    await commitSchema("ALTER TABLE t ADD COLUMN IF NOT EXISTS c text;\n");
    await startServer();
    const r = await run([], { FAKE_BUILD: "fail" });
    expect(r.code).not.toBe(0);
    expect(await schemaRuns()).toEqual([]);
    expect(await exists(path.join(h.root, ".deploy/schema-applied"))).toBe(false);
    expect(await marker(".next")).toBe("good:old");
  });

  it("control: a passing build applies it once, after the build and before the switch", async () => {
    await commitSchema("ALTER TABLE t ADD COLUMN IF NOT EXISTS c text;\n");
    await startServer();
    expect((await run([])).code).toBe(0);
    // The new build was staged and the old one still live when it ran.
    expect(await schemaRuns()).toEqual(["file=scripts/schema.sql staged=yes live=good:old"]);
    // Unchanged on the next deploy: not applied again.
    expect((await run([])).code).toBe(0);
    expect(await schemaRuns()).toHaveLength(1);
    // Changed: applied again.
    await commitSchema("ALTER TABLE t ADD COLUMN IF NOT EXISTS d text;\n");
    expect((await run([])).code).toBe(0);
    expect(await schemaRuns()).toHaveLength(2);
  });

  it("a schema that fails swaps nothing and restarts nothing", async () => {
    await commitSchema("NOT SQL;\n");
    await startServer();
    const r = await run([], { FAKE_SCHEMA: "fail" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("Nothing was");
    expect(await marker(".next")).toBe("good:old");
    expect(await exists(path.join(h.root, ".next-staging"))).toBe(false);
    expect(await exists(path.join(h.root, ".deploy/schema-applied"))).toBe(false);
    expect(await restarts()).toBe(0);
  });
});

describe("deploy.sh: stale route types", () => {
  it("are cleared before the build, which then passes; the live build is otherwise kept", async () => {
    await mkdir(path.join(h.root, ".next/types"), { recursive: true });
    await writeFile(path.join(h.root, ".next/types/routes.d.ts"), "declare const gone: '/radio';\n");
    await mkdir(path.join(h.root, ".next-dev/types"), { recursive: true });
    await writeFile(path.join(h.root, ".next-dev/types/routes.d.ts"), "x\n");
    await startServer();
    const r = await run([]);
    expect(r.code).toBe(0);
    expect(r.out).toContain("removed .next/types");
    expect(await exists(path.join(h.root, ".next-dev/types"))).toBe(false);
    expect(await marker(".next")).toBe("good:new");
    expect(await marker(".next.prev")).toBe("good:old");
  });
});

describe("deploy.sh: the returning visitor (2026-10-14)", () => {
  const log = () => readFile(path.join(h.root, "..", "returning.log"), "utf8").catch(() => "");

  it("primes on the old build before the swap, in Chromium and WebKit, and revisits on the new one", async () => {
    await startServer();
    const r = await run([]);
    expect(r.code, r.out).toBe(0);
    expect((await log()).trim().split("\n")).toEqual([
      "prime chromium live=good:old",
      "prime webkit live=good:old",
      "revisit chromium live=good:new",
      "revisit webkit live=good:new",
    ]);
    expect(await marker(".next")).toBe("good:new");
  });

  it("a returning visitor whose Library does not load rolls the deploy back", async () => {
    await startServer();
    const r = await run([], { FAKE_RETURNING_REVISIT: "1" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("rolled back");
    expect(await marker(".next")).toBe("good:old");
  });

  it("control: a check that could not run (exit 2) warns and the deploy stands", async () => {
    await startServer();
    const r = await run([], { FAKE_RETURNING_PRIME: "2", FAKE_RETURNING_REVISIT: "2" });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("could not run; not judged");
    expect(await marker(".next")).toBe("good:new");
  });

  it("--verify-only runs it too, and fails on a page failure", async () => {
    await startServer();
    expect((await run(["--verify-only"])).code).toBe(0);
    expect(await log()).toContain("check chromium");
    expect((await run(["--verify-only"], { FAKE_RETURNING_CHECK: "1" })).code).not.toBe(0);
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

// What highdesert-status reads (scripts/status.sh): .deploy/attempt says how
// the last deploy ended, .deploy/deployed which build serves. Before
// 2026-10-30 a failed deploy left no trace, and a rollback left `deployed`
// naming the build it had just taken down.
describe("deploy.sh: the records highdesert-status reads", () => {
  const ISO = "\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\dZ";
  const state = (f: string) => readFile(path.join(h.root, ".deploy", f), "utf8").then((s) => s.trim(), () => null);
  const deployedRef = async () => (await state("deployed"))?.split(" ")[0] ?? null;
  async function commit(name: string): Promise<string> {
    await writeFile(path.join(h.root, `${name}.txt`), name);
    await git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
    await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", name);
    return git("rev-parse", "--short", "HEAD");
  }

  it("a failed build is a failed deploy, with its reason; the next good deploy clears it", async () => {
    await startServer();
    const head = await git("rev-parse", "--short", "HEAD");
    expect((await run([], { FAKE_BUILD: "fail" })).code).not.toBe(0);
    expect(await state("attempt")).toMatch(new RegExp(`^${head} ${ISO} failed Build failed\\. The live site is untouched\\.$`));
    expect((await run([])).code).toBe(0);
    expect(await state("attempt")).toMatch(new RegExp(`^${head} ${ISO} ok$`));
  });

  it("while it runs, the record is 'running' with the deploy's pid", async () => {
    await startServer();
    const during = path.join(h.root, "..", "attempt-during-build");
    const build = path.join(h.root, "..", "build-and-look.sh");
    await writeFile(build, `cp .deploy/attempt "${during}"\nexec bash "${path.join(h.root, "..", "fake-build.sh")}"\n`);
    expect((await run([], { HD_BUILD_CMD: `bash ${build}` })).code).toBe(0);
    const head = await git("rev-parse", "--short", "HEAD");
    expect((await readFile(during, "utf8")).trim()).toMatch(new RegExp(`^${head} ${ISO} running \\d+$`));
  });

  it("a deploy rolled back after verification is a failed deploy, and `deployed` names the build that serves", async () => {
    await startServer();
    const a = await git("rev-parse", "--short", "HEAD");
    expect((await run([])).code).toBe(0);
    const b = await commit("b");
    expect((await run([], { FAKE_BUILD: "no-chunks" })).code).not.toBe(0);
    expect(await marker(".next")).toBe("good:new"); // a's build, back in place
    expect(await state("attempt")).toMatch(new RegExp(`^${b} ${ISO} failed Deploy of ${b} failed verification and was rolled back\\.`));
    expect(await deployedRef()).toBe(a);
  });

  it("--rollback swaps the record with the build, both ways", async () => {
    await startServer();
    const a = await git("rev-parse", "--short", "HEAD");
    expect((await run([])).code).toBe(0);
    const b = await commit("b");
    expect((await run([])).code).toBe(0);
    expect(await deployedRef()).toBe(b);
    expect((await run(["--rollback"])).code).toBe(0);
    expect(await deployedRef()).toBe(a);
    expect((await run(["--rollback"])).code).toBe(0);
    expect(await deployedRef()).toBe(b);
  });

  it("after a rollback and a new deploy, a rollback restores the build live before that deploy", async () => {
    await startServer();
    const a = await git("rev-parse", "--short", "HEAD");
    expect((await run([])).code).toBe(0);
    await commit("b");
    expect((await run([])).code).toBe(0);
    expect((await run(["--rollback"])).code).toBe(0); // a serves; b is in .next.prev
    const c = await commit("c");
    expect((await run([])).code).toBe(0); // c serves; a is in .next.prev
    expect(await deployedRef()).toBe(c);
    expect((await run(["--rollback"])).code).toBe(0);
    expect(await deployedRef()).toBe(a);
  });

  it("with no .deploy/previous (deploys before it existed), the history's build before the last is the one restored; with neither, no record", async () => {
    await startServer();
    const a = await git("rev-parse", "--short", "HEAD");
    expect((await run([])).code).toBe(0);
    await commit("b");
    expect((await run([])).code).toBe(0);
    await rm(path.join(h.root, ".deploy/previous"));
    expect((await run(["--rollback"])).code).toBe(0);
    expect(await deployedRef()).toBe(a);

    await rm(path.join(h.root, ".deploy/previous"));
    await writeFile(path.join(h.root, ".deploy/history"), "");
    expect((await run(["--rollback"])).code).toBe(0);
    expect(await state("deployed")).toBeNull();
  });

  it("a refusal is not a deploy: a dirty tree leaves no record", async () => {
    await writeFile(path.join(h.root, "uncommitted.txt"), "x");
    expect((await run([])).code).not.toBe(0);
    expect(await state("attempt")).toBeNull();
  });
});
