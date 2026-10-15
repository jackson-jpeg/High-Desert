// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Both workflows are manual only since 2026-10-15 (checks run on the VPS, the
 * whole mutation list weekly through scripts/weekly-mutations.sh). What is
 * still held here: nothing pushed or scheduled runs them, and a run by hand
 * still checks everything it used to.
 */

const read = (f: string) => readFileSync(path.resolve(__dirname, "../../.github/workflows", f), "utf8");
const mutations = read("mutations.yml");
const ci = read("ci.yml");
/** The trigger names under a workflow's top-level `on:`. */
const onBlock = (yml: string) => {
  const m = /^on:\n((?:[ \t]+.*\n|\n)*)/m.exec(yml);
  if (!m) return [];
  return [...m[1].matchAll(/^  ([a-z_]+):/gm)].map((x) => x[1]);
};

describe("mutations.yml", () => {
  it("runs only by hand: no push, pull request or schedule (checks run on the VPS)", () => {
    expect(onBlock(mutations)).toEqual(["workflow_dispatch"]);
  });

  it("splits into as many shards as the matrix has, and every shard reports", () => {
    const shards = /shard: \[([\d, ]+)\]/.exec(mutations)![1].split(",").map((s) => Number(s.trim()));
    expect(shards).toEqual([1, 2, 3, 4]);
    const totals = [...mutations.matchAll(/--shard \$\{\{ matrix\.shard \}\}\/(\d+)/g)].map((m) => Number(m[1]));
    expect(totals.length).toBe(2);
    for (const t of totals) expect(t).toBe(shards.length);
    expect(mutations).toMatch(/fail-fast: false/);
  });

  it("narrows only a pull request; main and the nightly run check the whole list", () => {
    const step = mutations.slice(mutations.indexOf("- name: Mutation check"));
    expect(step).toMatch(/if \[ "\$\{\{ github\.event_name \}\}" = pull_request \]; then\n\s+node scripts\/mutate-check\.mjs --shard \$\{\{ matrix\.shard \}\}\/4 --changed-from HEAD\^1\n\s+else\n\s+node scripts\/mutate-check\.mjs --shard \$\{\{ matrix\.shard \}\}\/4\n\s+fi/);
    expect(mutations).toMatch(/fetch-depth: 2/);
  });

  it("never cancels the nightly run, and a merge cannot cancel it", () => {
    expect(mutations).toMatch(/group: mutations-\$\{\{ github\.event_name == 'schedule' && 'nightly' \|\|/);
    expect(mutations).toMatch(/cancel-in-progress: \$\{\{ github\.event_name != 'schedule' \}\}/);
  });

  it("gives the database-backed mutations their database (NO-ENV fails in CI otherwise)", () => {
    expect(mutations).toMatch(/TEST_DATABASE_URL: postgres:\/\//);
    expect(mutations).toMatch(/-f scripts\/schema\.sql/);
  });
});

describe("dependabot.yml", () => {
  const dep = readFileSync(path.resolve(__dirname, "../../.github/dependabot.yml"), "utf8");
  const npm = dep.slice(dep.indexOf("package-ecosystem: npm"), dep.indexOf("package-ecosystem: github-actions"));

  it("puts every minor and patch update in one weekly PR, and that group comes first", () => {
    expect(npm).toMatch(/interval: weekly/);
    expect(npm).toMatch(/groups:\n(?:\s*#.*\n)*\s+minor-and-patch:\n\s+patterns: \["\*"\]\n\s+update-types: \["minor", "patch"\]\n/);
  });

  it("keeps majors out of it: every other group is majors only", () => {
    const groups = npm.slice(npm.indexOf("groups:"));
    const types = [...groups.matchAll(/update-types: \[([^\]]*)\]/g)].map((m) => m[1]);
    expect(types[0]).toBe('"minor", "patch"');
    expect(types.length).toBeGreaterThan(1);
    for (const t of types.slice(1)) expect(t).toBe('"major"');
    // A group with no update-types would take majors and minors together.
    expect((groups.match(/patterns:/g) ?? []).length).toBe(types.length);
  });
});

describe("ci.yml", () => {
  it("runs only by hand: no push, pull request or schedule (checks run on the VPS)", () => {
    expect(onBlock(ci)).toEqual(["workflow_dispatch"]);
  });

  it("no longer runs the mutation check itself", () => {
    expect(ci).not.toMatch(/test:mutations|mutate-check/);
  });

  it("cancels a superseded run on the same PR or branch", () => {
    expect(ci).toMatch(/group: ci-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}\n\s+cancel-in-progress: true/);
  });

  it("still lints, typechecks, tests, builds, checks the CSP and runs Playwright", () => {
    for (const step of ["npm run lint", "npm run typecheck", "npm run test", "npm run build", "npm run check:csp", "npm run test:e2e"]) {
      expect(ci).toContain(step);
    }
  });

  it("checks the show pages in the browser job, after the build and against its running server", () => {
    const browser = ci.slice(ci.indexOf("  browser:"));
    const build = browser.indexOf("npm run build");
    const csp = browser.indexOf("npm run check:csp -- http://127.0.0.1:3000");
    const seo = browser.indexOf("npm run check:seo -- http://127.0.0.1:3000");
    expect(build).toBeGreaterThan(0);
    expect(csp).toBeGreaterThan(build);
    expect(seo).toBeGreaterThan(csp);
  });
});
