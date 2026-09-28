/**
 * No git variable reaches the suite (vitest setupFiles, vitest.config.mts).
 *
 * 2026-09-28: the suite ran inside a git hook, which exports GIT_DIR and its
 * kin. Tests that build throwaway repositories (deploy.test.ts,
 * funnel-verdict.test.ts) then acted on the real repository instead: dozens of
 * commits on a branch, and `git init --bare` set `core.bare = true` under
 * /root/High-Desert, which stopped git there. So every run starts without any
 * GIT_* variable, whatever launched it, and child processes inherit that.
 *
 * vitest.config.mts plants a canary GIT_DIR in the test environment; the
 * guard test (src/test-support/__tests__/git-env.test.ts) fails if it survives,
 * which is how this file's wiring is observed.
 */

/** Removes every GIT_* variable from `env` in place, and returns the names removed. */
export function clearGitEnv(env: Record<string, string | undefined> = process.env): string[] {
  const removed = Object.keys(env).filter((k) => k.startsWith("GIT_"));
  for (const k of removed) delete env[k];
  return removed;
}

clearGitEnv();
