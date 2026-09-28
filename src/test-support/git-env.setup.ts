// vitest setupFiles: every test run, and every process it spawns, starts
// without a GIT_* variable (src/test-support/git-env.ts).
import { clearGitEnv } from "./git-env";

clearGitEnv();
