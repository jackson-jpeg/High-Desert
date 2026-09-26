import { describe } from "vitest";

/**
 * Tests that need a real Postgres read `TEST_DATABASE_URL`.
 *
 *   - CI provides one (a postgres:16 service; see .github/workflows/ci.yml).
 *   - On the VPS: `set -a; . /root/.high-desert-test.env; set +a` first. That
 *     points at `highdesert_test`, a separate database owned by a role that
 *     cannot touch the production one.
 *
 * Two guards, because a DB test that silently does not run is the exact
 * "check disconnected from its subject" this repo keeps paying for
 * (docs/disconnected-checks.md):
 *
 *   - In CI a missing URL is an error, not a skip.
 *   - The database name must end in `_test`, so a test can never be pointed at
 *     production by a stray DATABASE_URL.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "";

if (!TEST_DATABASE_URL && process.env.CI) {
  throw new Error("TEST_DATABASE_URL is required in CI: database tests would otherwise be skipped silently");
}

if (TEST_DATABASE_URL) {
  const name = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
  if (!name.endsWith("_test")) {
    throw new Error(`TEST_DATABASE_URL must name a *_test database, got "${name}"`);
  }
}

/** `describe` that runs only when a test database is configured. */
export const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
