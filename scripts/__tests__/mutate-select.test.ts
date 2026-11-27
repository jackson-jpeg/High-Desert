// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  MUTATIONS,
  RUN_ALL_WHEN_CHANGED,
  selectMutations,
  parseShard,
  changesSince,
  judgeRun,
  packageChangesTests,
} from "../mutate-check.mjs";

describe("judgeRun: a pass needs evidence the tests ran", () => {
  it("non-zero is red; zero with vitest's summary is GREEN; zero without it is NO-RUN", () => {
    expect(judgeRun(1, " Tests  1 failed | 3 passed (4)")).toBe("red");
    expect(judgeRun(0, " Test Files  1 passed (1)\n      Tests  4 passed (4)")).toBe("GREEN");
    // 2026-09-29: the runner went through the mutated scripts/heavy.sh, which
    // exited 0 without starting vitest.
    expect(judgeRun(0, "")).toBe("NO-RUN");
  });

  it("reads CI's coloured summary (2026-10-13: a survivor was reported as NO-RUN)", () => {
    const ci = "\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m21 passed\x1b[39m\x1b[22m\x1b[90m (21)\x1b[39m";
    expect(judgeRun(0, ci)).toBe("GREEN");
    expect(judgeRun(0, "\x1b[2m   Duration \x1b[22m 782ms")).toBe("NO-RUN");
  });
});

/**
 * Which mutations a CI run checks (.github/workflows/mutations.yml). A pull
 * request checks only what it touched; main and the nightly run check all of
 * them in four shards. The guarantee rests on two properties held here: the
 * shards of a run are disjoint and cover the whole list, and a PR's subset
 * never drops a mutation whose target, test or entry it changed.
 */

type M = (typeof MUTATIONS)[number];
const m = (id: string, file: string, test: string, extra: Partial<M> = {}): M =>
  ({ id, file, test, find: `find-${id}`, replace: `replace-${id}`, why: "", ...extra }) as M;

const LIST = [
  m("a", "src/a.ts", "src/__tests__/a.test.ts"),
  m("b", "src/b.ts", "src/__tests__/b.test.ts"),
  m("c", "src/a.ts", "src/__tests__/c.test.ts"),
  m("d", "scripts/d.sh", "scripts/__tests__/d.test.ts"),
];

describe("sharding", () => {
  it("four shards of the real list are disjoint and together are every mutation", () => {
    const shards = [1, 2, 3, 4].map((index) => selectMutations(MUTATIONS, { shard: { index, total: 4 } }));
    const ids = shards.flat().map((x) => x.id);
    expect(ids.length).toBe(MUTATIONS.length);
    expect(new Set(ids).size).toBe(MUTATIONS.length);
    // Balanced: no shard carries more than one extra.
    const sizes = shards.map((s) => s.length);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
  });

  it("shards a PR's subset the same way", () => {
    const changed = ["src/a.ts"];
    const all = selectMutations(LIST, { changed, base: LIST });
    const parts = [1, 2].map((index) => selectMutations(LIST, { changed, base: LIST, shard: { index, total: 2 } }));
    expect(parts.flat().map((x) => x.id).sort()).toEqual(all.map((x) => x.id).sort());
    expect(parts[0].map((x) => x.id)).not.toEqual(parts[1].map((x) => x.id));
  });

  it("parses i/n and refuses anything else", () => {
    expect(parseShard("3/4")).toEqual({ index: 3, total: 4 });
    for (const bad of ["0/4", "5/4", "4", "a/b", "", undefined]) expect(() => parseShard(bad as string)).toThrow();
  });
});

describe("a pull request's subset", () => {
  it("picks the mutations whose target file changed", () => {
    expect(selectMutations(LIST, { changed: ["src/a.ts"], base: LIST }).map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("picks the mutations whose test file changed", () => {
    expect(selectMutations(LIST, { changed: ["scripts/__tests__/d.test.ts"], base: LIST }).map((x) => x.id)).toEqual(["d"]);
  });

  it("picks an entry that is new or edited since the base, and only that", () => {
    const base = LIST.slice(0, 3); // d is new
    const edited = LIST.map((x) => (x.id === "b" ? { ...x, find: "a different line" } : x));
    expect(selectMutations(edited, { changed: ["scripts/mutate-check.mjs"], base }).map((x) => x.id)).toEqual(["b", "d"]);
  });

  it("picks nothing for a change no mutation is about (docs)", () => {
    expect(selectMutations(LIST, { changed: ["docs/x.md"], base: LIST })).toEqual([]);
  });

  it("runs the whole list when a file every test depends on changed", () => {
    for (const f of RUN_ALL_WHEN_CHANGED) {
      expect(selectMutations(LIST, { changed: [f, "docs/x.md"], base: LIST }).map((x) => x.id)).toEqual(["a", "b", "c", "d"]);
    }
    expect(RUN_ALL_WHEN_CHANGED).toContain("package-lock.json");
  });

  it("with no `changed` (main, nightly) checks everything", () => {
    expect(selectMutations(MUTATIONS)).toHaveLength(MUTATIONS.length);
  });
});

describe("changesSince (the PR's diff and the base's list)", () => {
  let repo: string;
  const run = promisify(execFile);
  const git = (...a: string[]) => run("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...a], { cwd: repo });
  const listFile = (entries: { id: string }[]) =>
    `export const MUTATIONS = ${JSON.stringify(entries.map((e) => ({ file: "src/x.ts", test: "t.ts", find: "f", replace: "r", why: "", ...e })))};\n`;

  beforeAll(async () => {
    repo = await mkdtemp(path.join(tmpdir(), "mutate-select-"));
    await git("init", "-q", "-b", "main");
    await mkdir(path.join(repo, "scripts"));
    await writeFile(path.join(repo, "scripts/mutate-check.mjs"), listFile([{ id: "one" }]));
    await writeFile(path.join(repo, "a.txt"), "a");
    await git("add", "-A");
    await git("commit", "-qm", "base");
    await git("tag", "base");
    await writeFile(path.join(repo, "scripts/mutate-check.mjs"), listFile([{ id: "one" }, { id: "two" }]));
    await writeFile(path.join(repo, "b.txt"), "b");
    await git("add", "-A");
    await git("commit", "-qm", "pr");
  });
  afterAll(() => rm(repo, { recursive: true, force: true }));

  it("returns the files the PR changed and the list as the base had it", async () => {
    const { changed, base } = await changesSince("base", repo);
    expect(changed.sort()).toEqual(["b.txt", "scripts/mutate-check.mjs"]);
    expect(base.map((x: { id: string }) => x.id)).toEqual(["one"]);
  });

  it("keeps package.json only when a field that can change a test changed", async () => {
    const start = (await git("rev-parse", "HEAD")).stdout.trim();
    const pkg = (extra: object) => JSON.stringify({ name: "x", repository: { url: "a" }, devDependencies: { vitest: "1" }, ...extra });
    await writeFile(path.join(repo, "package.json"), pkg({}));
    await git("add", "-A");
    await git("commit", "-qm", "pkg");
    await git("tag", "pkg-base");
    await writeFile(path.join(repo, "package.json"), pkg({ repository: { url: "b" }, keywords: ["k"] }));
    await git("commit", "-qam", "metadata");
    expect((await changesSince("pkg-base", repo)).changed).not.toContain("package.json");
    await writeFile(path.join(repo, "package.json"), pkg({ devDependencies: { vitest: "2" } }));
    await git("commit", "-qam", "upgrade");
    expect((await changesSince("pkg-base", repo)).changed).toContain("package.json");
    await git("reset", "-q", "--hard", start);
  });

  it("a base with no list makes every entry new", async () => {
    await git("checkout", "-q", "--orphan", "empty");
    await git("rm", "-rq", "--cached", ".");
    await git("commit", "-q", "--allow-empty", "-m", "nothing");
    await git("tag", "empty-base");
    await git("checkout", "-q", "-f", "main");
    const { base } = await changesSince("empty-base", repo);
    expect(base).toEqual([]);
  });
});

describe("packageChangesTests", () => {
  const p = (o: object) => JSON.stringify(o);
  it("ignores metadata, counts what installs and how tests start, and treats unreadable as changed", () => {
    expect(packageChangesTests(p({ repository: "a", keywords: [] }), p({ repository: "b" }))).toBe(false);
    for (const k of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides", "scripts", "type", "engines"]) {
      expect(packageChangesTests(p({}), p({ [k]: { x: "1" } })), k).toBe(true);
    }
    expect(packageChangesTests(null, p({}))).toBe(true);
    expect(packageChangesTests("{", p({}))).toBe(true);
  });
});

/**
 * The nightly run (the lead, 2026-11-27): "files changed since the last green
 * run, plus anything their tests cover", and the last run's survivors again.
 */
describe("the nightly run's selection", () => {
  it("covered: a test whose imports reach a changed file brings its mutations in", () => {
    const covered = new Set(["src/__tests__/b.test.ts"]);
    const ids = (o: Parameters<typeof selectMutations>[1]) => selectMutations(LIST, o).map((x) => x.id);
    expect(ids({ changed: ["src/helper.ts"], base: LIST })).toEqual([]);
    expect(ids({ changed: ["src/helper.ts"], base: LIST, covered })).toEqual(["b"]);
  });

  it("also: named entries whatever changed, once each", () => {
    const ids = (o: Parameters<typeof selectMutations>[1]) => selectMutations(LIST, o).map((x) => x.id);
    expect(ids({ changed: ["src/b.ts"], base: LIST, also: ["d", "b", "gone"] })).toEqual(["b", "d"]);
  });

  describe("testsReaching (scripts/lib/import-closure.mjs)", () => {
    let root: string;
    beforeAll(async () => {
      root = await mkdtemp(path.join(tmpdir(), "hd-closure-"));
      const put = async (f: string, text: string) => {
        await mkdir(path.dirname(path.join(root, f)), { recursive: true });
        await writeFile(path.join(root, f), text);
      };
      await put("src/lib/deep.ts", "export const deep = 1;\n");
      await put("src/lib/mid.ts", 'import { deep } from "./deep";\nexport const mid = deep;\n');
      await put("src/lib/index.ts", 'export * from "./mid";\n');
      await put("src/lib/lone.ts", "export const lone = 1;\n");
      await put("src/__tests__/via-alias.test.ts", 'import { mid } from "@/lib";\n');
      await put("src/__tests__/via-mock.test.ts", 'vi.mock("../lib/deep");\nconst x = await import("../lib/lone");\n');
      await put("src/__tests__/none.test.ts", 'import { it } from "vitest";\nimport x from "react";\n');
      await put("src/__tests__/cycle.test.ts", 'import "./cycle-a";\n');
      await put("src/__tests__/cycle-a.ts", 'import "./cycle-b";\n');
      await put("src/__tests__/cycle-b.ts", 'import "./cycle-a";\n');
    });
    afterAll(() => rm(root, { recursive: true, force: true }));
    const tests = ["src/__tests__/via-alias.test.ts", "src/__tests__/via-mock.test.ts", "src/__tests__/none.test.ts", "src/__tests__/cycle.test.ts"];

    it("follows @/ and relative imports, index files, export-from, vi.mock and import(), through any depth", async () => {
      const { testsReaching } = await import("../lib/import-closure.mjs");
      expect([...testsReaching(["src/lib/deep.ts"], tests, root)].sort()).toEqual(["src/__tests__/via-alias.test.ts", "src/__tests__/via-mock.test.ts"]);
      expect([...testsReaching(["src/lib/lone.ts"], tests, root)]).toEqual(["src/__tests__/via-mock.test.ts"]);
    });

    it("a changed test reaches itself; packages and cycles end the walk", async () => {
      const { testsReaching } = await import("../lib/import-closure.mjs");
      expect([...testsReaching(["src/__tests__/none.test.ts"], tests, root)]).toEqual(["src/__tests__/none.test.ts"]);
      expect([...testsReaching(["src/elsewhere.ts"], tests, root)]).toEqual([]);
    });

    it("control: on this repo, a store's test reaches the store", async () => {
      const { testsReaching } = await import("../lib/import-closure.mjs");
      const root2 = path.resolve(__dirname, "../..");
      const reached = testsReaching(["src/stores/player-store.ts"], ["src/stores/__tests__/player-store.test.ts", "scripts/__tests__/digest.test.ts"], root2);
      expect([...reached]).toEqual(["src/stores/__tests__/player-store.test.ts"]);
    });
  });

  it("with nothing to check, mutate-check still writes a verdict (total 0) for the nightly run", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hd-empty-verdict-"));
    try {
      const out = path.join(dir, "v.json");
      await promisify(execFile)(process.execPath, [path.resolve(__dirname, "../mutate-check.mjs"), "--changed-from", "HEAD", "--json", out, "no-such-mutation-id-xyz"], {
        cwd: path.resolve(__dirname, "../.."),
      });
      const v = JSON.parse(await import("node:fs/promises").then((f) => f.readFile(out, "utf8")));
      expect(v).toMatchObject({ exit: 0, total: 0, red: 0, skipped: [], survived: [] });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
