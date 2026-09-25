#!/usr/bin/env node
/**
 * highdesert-live — the phone lines. 127.0.0.1:3005, behind nginx's
 * /live-api/ location (deploy/nginx/highdesert.conf). Its own unit
 * (deploy/highdesert-live.service) so a web deploy never drops the chat.
 *
 * Environment (/root/.high-desert-live.env, chmod 600, read by systemd):
 *   LIVE_DATABASE_URL    postgres URL for the highdesert_live role
 *   CHAT_CLIENT_SECRET   HMAC key for client_ref (64 hex chars)
 *   LIVE_ADMIN_TOKEN     admin credential (64 hex chars)
 * Unit-set:
 *   LIVE_PORT (3005), LIVE_HOST (127.0.0.1), LIVE_BLOCKLIST (path),
 *   LIVE_ORIGINS (comma-separated; default https://highdesert.space,https://www.highdesert.space)
 * Never set in the unit:
 *   LIVE_LOAD_TEST=1     honour x-live-test-client from loopback (scripts/load.mjs)
 */

import http from "node:http";
import path from "node:path";
import pg from "pg";
import { createLiveApp, DEFAULT_ORIGINS } from "./lib/app.mjs";
import { watchedBlocklist } from "./lib/moderation/blocklist.mjs";

const env = process.env;
const port = Number(env.LIVE_PORT ?? 3005);
const host = env.LIVE_HOST ?? "127.0.0.1";
const databaseUrl = env.LIVE_DATABASE_URL ?? env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[live] LIVE_DATABASE_URL is not set");
  process.exit(1);
}

const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: Number(env.LIVE_DB_POOL ?? 8),
  statement_timeout: 5_000,
  idleTimeoutMillis: 30_000,
});
pool.on("error", (err) => console.error(`[live] pg pool: ${err.message}`));

const blocklistFile = env.LIVE_BLOCKLIST ?? path.resolve(import.meta.dirname, "../../data/chat-blocklist.txt");
const blocklist = watchedBlocklist(blocklistFile, {
  onReload: ({ entries, errors, version }) => {
    console.log(`[live] blocklist v${version}: ${entries.length} term(s) from ${blocklistFile}`);
    for (const e of errors) console.error(`[live] blocklist: ${e}`);
  },
});
blocklist.reload();
process.on("SIGHUP", () => blocklist.reload());

const loadTest = env.LIVE_LOAD_TEST === "1";
if (loadTest) console.warn("[live] LIVE_LOAD_TEST=1: x-live-test-client is honoured from loopback. Never in production.");

const app = createLiveApp({
  pool,
  clientSecret: env.CHAT_CLIENT_SECRET ?? "",
  adminToken: env.LIVE_ADMIN_TOKEN ?? "",
  origins: env.LIVE_ORIGINS ? env.LIVE_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS,
  blocklist: () => blocklist.get(),
  loadTest,
});
if (!env.LIVE_ADMIN_TOKEN) console.warn("[live] LIVE_ADMIN_TOKEN is not set: admin actions are disabled");

const server = http.createServer((req, res) => app.handle(req, res));
// Streams are long-lived by design; nginx's proxy_read_timeout is the bound.
server.requestTimeout = 0;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 65_000;
server.listen(port, host, () => console.log(`[live] listening on ${host}:${port}`));

let stopping = false;
function stop(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`[live] ${signal}: closing`);
  app.close();
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5_000).unref();
}
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
