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
} from "../mutate-check.mjs";

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
