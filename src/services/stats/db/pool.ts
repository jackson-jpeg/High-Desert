/**
 * The connection pool every stats module shares. One pool per process: the
 * modules in this directory import `pool()` from here, and `getPool()` is what
 * tests use to inspect the connection itself.
 */

import { Pool } from "pg";

let _pool: Pool | null = null;

/**
 * Server-side cap on any one statement. Every query here is an index lookup or
 * a small aggregate that completes in milliseconds; one that runs for seconds
 * is a bug or a lock pile-up, and with `max: 8` connections it would starve
 * the public routes of the pool while it ran. Postgres cancels it instead, the
 * route returns 503, and the pool keeps serving.
 */
export const STATEMENT_TIMEOUT_MS = 10_000;

export function pool(): Pool {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured");
  }
  _pool = new Pool({
    connectionString,
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: STATEMENT_TIMEOUT_MS,
  });
  // A pool-level error (e.g. the server restarting) must not take the process down.
  _pool.on("error", (err) => {
    console.error("[stats/store] idle client error:", err.message);
  });
  return _pool;
}

/** The shared pool. For tests that need to inspect the connection itself. */
export function getPool(): Pool {
  return pool();
}
