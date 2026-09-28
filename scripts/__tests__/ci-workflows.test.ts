// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The mutation guarantee lives in two YAML files now: a pull request checks
 * only the mutations it touched, so the whole list is held by the full run on
 * main and the nightly one (.github/workflows/mutations.yml), and
 * highdesert-status reads the nightly run by its workflow file, event and step
 * name (scripts/nightly-mutations.sh). Each assertion below is one of those
 * couplings; break one and the guarantee is quietly gone while CI stays green.
 */

const read = (f: string) => readFileSync(path.resolve(__dirname, "../../.github/workflows", f), "utf8");
const mutations = read("mutations.yml");
const ci = read("ci.yml");
const helper = readFileSync(path.resolve(__dirname, "../nightly-mutations.sh"), "utf8");

describe("mutations.yml", () => {
  it("runs on pull requests, on main, nightly and by hand", () => {
    expect(mutations).toMatch(/^on:\n\s+pull_request:\n\s+push:\n\s+branches: \[main\]\n\s+schedule:\n\s+- cron: "\d+ \d+ \* \* \*"\n\s+workflow_dispatch:/m);
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

  it("is what highdesert-status reads: this file, the schedule event, main, and the step name", () => {
    expect(helper).toMatch(/--workflow mutations\.yml --event schedule --branch main/);
    expect(helper).toMatch(/select\(\.name == "Mutation check"\)/);
    expect(mutations).toMatch(/^\s+- name: Mutation check$/m);
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
});
