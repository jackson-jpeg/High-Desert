import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { clearGitEnv } from "../git-env";

/**
 * A git variable leaking into the suite turned throwaway test repositories
 * into writes on the real one (src/test-support/git-env.ts).
 */
describe("no GIT_* variable reaches the suite", () => {
  it("the canary GIT_DIR planted by vitest.config.mts is gone, and so is every GIT_*", () => {
    expect(process.env.GIT_DIR).toBeUndefined();
    expect(Object.keys(process.env).filter((k) => k.startsWith("GIT_"))).toEqual([]);
  });

  it("a child process a test spawns sees none either", () => {
    const out = execFileSync("env", [], { encoding: "utf8" });
    expect(out.split("\n").filter((l) => l.startsWith("GIT_"))).toEqual([]);
  });

  it("clearGitEnv removes every GIT_* and nothing else", () => {
    const env: Record<string, string | undefined> = {
      GIT_DIR: "/r/.git", GIT_WORK_TREE: "/r", GIT_INDEX_FILE: "i", GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.bare", GIT_CONFIG_VALUE_0: "true", PATH: "/bin", HOME: "/root", MY_GIT_DIR: "keep",
    };
    expect(clearGitEnv(env).sort()).toEqual(["GIT_CONFIG_COUNT", "GIT_CONFIG_KEY_0", "GIT_CONFIG_VALUE_0", "GIT_DIR", "GIT_INDEX_FILE", "GIT_WORK_TREE"]);
    expect(env).toEqual({ PATH: "/bin", HOME: "/root", MY_GIT_DIR: "keep" });
  });
});
