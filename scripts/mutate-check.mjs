#!/usr/bin/env node
/**
 * Does each test file actually observe the code it claims to test?
 *
 * Three separate defects in this repo had the same shape: a check with no
 * connection to its subject, passing confidently.
 *
 *   - `playback-watchdog.ts` supervised a media element whose listeners were
 *     never attached. It could see neither `progress` nor `canplay`, so it timed
 *     out every load and wrote 33 phantom failures against working episodes.
 *   - `restore-play.test.ts` declared its own `primeEpisode` and never imported
 *     the real one. It had already drifted: `notifySourceChanged()` could have
 *     been deleted and the suite stayed green.
 *   - `clear-field.test.ts` asserted a belief about Dexie against a hand-written
 *     model of Dexie, so it agreed with the belief by construction and would
 *     have gone on agreeing through any Dexie release, including a breaking one.
 *
 * "No test" is a visible gap — `docs/` counts those. A test that cannot observe
 * its subject is an *invisible* one, and it reads as coverage on every
 * dashboard. This script is the only thing that tells them apart.
 *
 * For each entry below: break one real line of production code, run only the
 * test file that claims to cover it, and require that it goes red. A mutation
 * that stays GREEN is the finding.
 *
 * The list is hand-curated on purpose. A generated mutant tells you a line is
 * unobserved; a chosen one tells you a *behaviour* is — and several of these are
 * the exact line of an incident this project has already had.
 *
 *   node scripts/mutate-check.mjs              # all
 *   node scripts/mutate-check.mjs streak dedup # substring filter on id
 *
 * Exits non-zero if any mutation survives.
 */

import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileP = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * `find` must appear EXACTLY ONCE in `file`, so a mutation cannot silently
 * become a no-op or hit the wrong call site as the code moves. That check is
 * enforced below and is the reason these are written as full lines.
 */
const MUTATIONS = [
  {
    id: "duration-sanity",
    test: "src/audio/__tests__/duration-sanity.test.ts",
    file: "src/audio/duration-sanity.ts",
    find: 'if (actual <= MIN_PLAYABLE_SECONDS) return "empty";',
    replace: 'if (false) return "empty";',
    why: "the absolute floor — the only thing judged at loadedmetadata",
  },
  {
    id: "watchdog-activation",
    test: "src/audio/__tests__/playback-watchdog.test.ts",
    file: "src/audio/playback-watchdog.ts",
    find: "if (wanted && !hasUserActivation()) {",
    replace: "if (false) {",
    why: "the retry must not tear the element down when play() cannot succeed",
  },
  {
    id: "viz-cycle",
    test: "src/audio/visualizations/__tests__/registry.test.ts",
    file: "src/audio/visualizations/index.ts",
    find: "return VISUALIZATION_META[(idx + 1) % VISUALIZATION_META.length];",
    replace: "return VISUALIZATION_META[idx];",
    why: "cycling to the next visualization actually advances",
  },
  {
    id: "dedup-key",
    test: "src/db/__tests__/deduplicate.test.ts",
    file: "src/db/deduplicate.ts",
    find: "return `archive:${base}|${file}`;",
    replace: "return `archive:${base}`;",
    why: "THE incident: archiveIdentifier is the collection and is identical for every episode. Keying on it alone deleted 1,312 of 1,313 rows",
  },
  {
    id: "reconcile-tombstones",
    test: "src/db/__tests__/reconcile.test.ts",
    file: "src/db/seed.ts",
    find: "return !!hash && !localHashes.has(hash) && !tombstones.has(hash);",
    replace: "return !!hash && !localHashes.has(hash);",
    why: "a deliberately deleted episode must stay deleted, not be resurrected",
  },
  {
    id: "global-install",
    test: "src/hooks/__tests__/global-listeners.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "if (next === 1) globalRelease.set(key, install());",
    replace: "if (next === 99) globalRelease.set(key, install());",
    why: "THE incident: a shared ref counter meant four of five installs never ran, in any browser, for four months",
  },
  {
    id: "heartbeat-playing",
    test: "src/hooks/__tests__/listening-heartbeat.test.ts",
    file: "src/hooks/usePresence.ts",
    find: "if (!playing || !currentEpisode) return null;",
    replace: "if (!currentEpisode) return null;",
    why: "the episode rides the heartbeat only while actually playing — otherwise a paused tab holds a show on air",
  },
  {
    id: "restored-play-count",
    test: "src/hooks/__tests__/play-reporting.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "if (firstPlay && ep) countListen(ep);",
    replace: "if (false && ep) countListen(ep);",
    why: "THE incident: a listen started from the restored player reported nothing and never appeared on air",
  },
  {
    id: "prime-preload",
    test: "src/hooks/__tests__/restore-play.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: 'audio.preload = "none";',
    replace: 'audio.preload = "metadata";',
    why: "priming the restored element must cost no network until someone presses play",
  },
  {
    id: "file-size-floor",
    test: "src/lib/utils/__tests__/format-size.test.ts",
    file: "src/lib/utils/format.ts",
    find: 'if (mb < 1) return "<1 MB";',
    replace: 'if (false) return "<1 MB";',
    why: "sub-megabyte files read as '<1 MB', not '0 MB'",
  },
  {
    id: "retry-429",
    test: "src/lib/utils/__tests__/retry.test.ts",
    file: "src/lib/utils/retry.ts",
    find: "if (res.status === 429) {",
    replace: "if (false) {",
    why: "a rate-limited response is retried rather than returned as the answer",
  },
  {
    id: "search-operator-strip",
    test: "src/lib/utils/__tests__/search-parser.test.ts",
    file: "src/lib/utils/search-parser.ts",
    find: "result.text = remaining.trim();",
    replace: "result.text = input.trim();",
    why: "`guest:hoagland ufo` must search for 'ufo', not for the whole raw string",
  },
  {
    id: "streak-today",
    test: "src/lib/utils/__tests__/streak.test.ts",
    file: "src/lib/utils/streak.ts",
    find: "} else if (d === 0) {",
    replace: "} else if (false) {",
    why: "not having listened yet today must not break a streak",
  },
  {
    id: "filename-show-name",
    test: "src/services/archive/__tests__/filename-parser.test.ts",
    file: "src/services/archive/filename-parser.ts",
    find: 'showName = showName.replace(/\\s+with\\s+Art\\s+Bell/i, "").trim();',
    replace: "showName = showName.trim();",
    why: "'Coast to Coast AM with Art Bell' normalises to the show, not the host",
  },
  {
    id: "clear-field-delete",
    test: "src/services/episodes/__tests__/clear-field.test.ts",
    file: "src/services/episodes/management.ts",
    find: "delete row[key];",
    replace: "row[key] = undefined;",
    why: "un-favouriting must remove the key, not store undefined under it",
  },
  // deleteEpisode gets one mutation per distinct behaviour rather than one for
  // the module. It writes to five tables, all user data lives only in the
  // visitor's IndexedDB with no server backup, and its batch form is what
  // deleted 1,312 of 1,313 episodes. A single anchor here would leave two of
  // the three properties unobserved.
  {
    id: "delete-tombstone",
    test: "src/services/episodes/__tests__/delete-episode.test.ts",
    file: "src/services/episodes/management.ts",
    find: "await addTombstone(episode.fileHash);",
    replace: "await Promise.resolve();",
    why: "without the tombstone, reconcileLibrary() restores an episode the user deliberately deleted",
  },
  {
    id: "delete-cascade-history",
    test: "src/services/episodes/__tests__/delete-episode.test.ts",
    file: "src/services/episodes/management.ts",
    find: 'await db.history.where("episodeId").equals(id).delete();',
    replace: "await Promise.resolve();",
    why: "history rows must not outlive the episode they point at",
  },
  {
    id: "delete-playlist-scrub",
    test: "src/services/episodes/__tests__/delete-episode.test.ts",
    file: "src/services/episodes/management.ts",
    find: "episodeIds: pl.episodeIds.filter((eid) => eid !== id),",
    replace: "episodeIds: pl.episodeIds,",
    why: "a deleted episode must leave the playlists that held it, or they point at a missing row",
  },
  {
    id: "verification-marker",
    test: "src/app/api/playback-event/__tests__/verification-marker.test.ts",
    file: "src/app/api/playback-event/route.ts",
    find: "if (det?.toUpperCase().includes(VERIFICATION_MARKER)) {",
    replace: "if (false) {",
    why: "a verification row must not be able to reach the dataset that decides the five-second floor",
  },
  {
    id: "rate-limit-boundary",
    test: "src/lib/utils/__tests__/rate-limit.test.ts",
    file: "src/lib/utils/rate-limit.ts",
    find: "if (entry.timestamps.length >= maxRequests) {",
    replace: "if (entry.timestamps.length > maxRequests) {",
    why: "off by one here lets an extra request through every window on every public route",
  },
  {
    id: "rate-limit-sliding",
    test: "src/lib/utils/__tests__/rate-limit.test.ts",
    file: "src/lib/utils/rate-limit.ts",
    // Two-space indent: the identical line inside cleanup() is indented four.
    find: "\n  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);",
    replace: "\n  entry.timestamps = entry.timestamps.slice();",
    why: "the window must slide — without expiry a caller is locked out permanently after one burst",
  },
  // The Zustand stores. One mutation per store, each aimed at the behaviour
  // that is not obvious from reading the setter.
  {
    id: "admin-hydrate-gate",
    test: "src/stores/__tests__/admin-store.test.ts",
    file: "src/stores/admin-store.ts",
    find: "if (readAdmin()) set({ isAdmin: true });",
    replace: "set({ isAdmin: true });",
    why: "hydrate must consult localStorage, not promote every visitor to admin on mount",
  },
  {
    id: "context-menu-position",
    test: "src/stores/__tests__/context-menu-store.test.ts",
    file: "src/stores/context-menu-store.ts",
    find: "show: (x, y, items) => set({ open: true, position: { x, y }, items }),",
    replace: "show: (x, y, items) => set({ open: true, items }),",
    why: "the menu opens where the pointer is, not where the last one was",
  },
  {
    id: "dial-position-finite",
    test: "src/stores/__tests__/radio-dial-store.test.ts",
    file: "src/stores/radio-dial-store.ts",
    find: "setPosition: (pos) => set({ position: Number.isFinite(pos) ? pos : 0, subStationIndex: 0 }),",
    replace: "setPosition: (pos) => set({ position: pos, subStationIndex: 0 }),",
    why: "one NaN into the dial position and the tuning strip vanishes with nothing on screen to say why",
  },
  {
    id: "scanner-error-cap",
    test: "src/stores/__tests__/scanner-store.test.ts",
    file: "src/stores/scanner-store.ts",
    find: "[...state.errorMessages, message].slice(-100)",
    replace: "[...state.errorMessages, message]",
    why: "a scan that fails on every file must not grow an unbounded array in memory",
  },
  {
    id: "scraper-error-cap",
    test: "src/stores/__tests__/scraper-store.test.ts",
    file: "src/stores/scraper-store.ts",
    find: "s.errorMessages.length < 200",
    replace: "s.errorMessages.length < 999999",
    why: "the scrape keeps the first 200 messages — the opposite end from scanner-store, deliberately",
  },
  {
    id: "search-set-identity",
    test: "src/stores/__tests__/search-store.test.ts",
    file: "src/stores/search-store.ts",
    find: "set((s) => ({ addingIds: new Set(s.addingIds).add(id) })),",
    replace: "set((s) => ({ addingIds: s.addingIds.add(id) })),",
    why: "mutating the Set in place leaves the reference unchanged, so the row's spinner never clears",
  },
  {
    id: "sleep-fade-source",
    test: "src/stores/__tests__/sleep-timer-store.test.ts",
    file: "src/stores/sleep-timer-store.ts",
    find: "player.setVolume((next / FADE_SECONDS) * fadeFrom);",
    replace: "player.setVolume((next / FADE_SECONDS) * player.volume);",
    why: "THE incident: reading the live volume feeds the fade its own output — setVolume writes preMuteVolume, so the ramp compounds to ~2% and is then 'restored' as the listener's setting",
  },
  {
    id: "toast-error-not-mirrored",
    test: "src/stores/__tests__/toast-store.test.ts",
    file: "src/stores/toast-store.ts",
    find: 'if (type !== "error" && typeof window !== "undefined") {',
    replace: 'if (typeof window !== "undefined") {',
    why: "an error must not be mirrored into the one-line status ticker, where the next message scrolls it away",
  },
  {
    id: "allowlist-gate",
    test: "src/services/stats/__tests__/allowlist.test.ts",
    file: "src/services/stats/allowlist.ts",
    find: "return KEYS.has(id);",
    replace: "return true;",
    why: "without the gate, /api/stats/play creates a row per distinct string sent to it",
  },
  {
    id: "catalog-key",
    test: "src/services/stats/__tests__/catalog.test.ts",
    file: "src/services/stats/catalog.ts",
    find: "const key = communityKey(ep);",
    replace: "const key = ep.fileName;",
    why: "the catalog must key episodes exactly as the allowlist generator does, or the export returns raw ids",
  },
  {
    id: "deploy-staging-dist",
    test: "scripts/__tests__/deploy.test.ts",
    file: "scripts/deploy.sh",
    find: 'HD_DIST_DIR="$STAGING" $BUILD_CMD || BUILD_OK=0',
    replace: 'HD_DIST_DIR="$LIVE" $BUILD_CMD || BUILD_OK=0',
    why: "next build empties its distDir first — building into the live .next is the outage where a failed build left the site serving deleted chunks",
  },
  {
    id: "deploy-zero-chunks",
    test: "scripts/__tests__/deploy.test.ts",
    file: "scripts/deploy.sh",
    find: "    if (( total == 0 )); then",
    replace: "    if false; then",
    why: "a page with no chunks used to verify as \"0 broken chunks\" and print success",
  },
  {
    id: "deploy-never-up",
    test: "scripts/__tests__/deploy.test.ts",
    file: "scripts/deploy.sh",
    find: "  if (( ! up )); then",
    replace: "  if false; then",
    why: "a server that never came up must fail verification, not fall through the wait loop",
  },
  {
    id: "deploy-auto-rollback",
    test: "scripts/__tests__/deploy.test.ts",
    file: "scripts/deploy.sh",
    find: "  swap_back  # undo the failed deploy",
    replace: "  :  # undo the failed deploy",
    why: "a deploy that fails verification must put the previous build back, not leave a broken one live",
  },
  {
    id: "csp-no-eval",
    test: "src/lib/__tests__/security-headers.test.ts",
    file: "src/lib/csp.ts",
    find: "`script-src 'self' 'unsafe-inline'${dev ? \" 'unsafe-eval'\" : \"\"}`,",
    replace: "`script-src 'self' 'unsafe-inline' 'unsafe-eval'`,",
    why: "production must not ship 'unsafe-eval' (HD-030)",
  },
  {
    id: "image-optimizer-off",
    test: "src/lib/__tests__/security-headers.test.ts",
    file: "next.config.ts",
    find: "  images: { unoptimized: true },",
    replace: "  images: { unoptimized: false },",
    why: "/_next/image is the endpoint behind GHSA-2xp9-vwfh-vxw4, and nothing here uses it",
  },
  {
    id: "scanner-metadata-tags",
    test: "src/services/scanner/__tests__/metadata.test.ts",
    file: "src/services/scanner/metadata.ts",
    find: "if (common.title) result.title = common.title;",
    replace: "if (false) result.title = common.title;",
    why: "the music-metadata v11 migration still reads tags from a real MP3",
  },
  {
    id: "backup-retention",
    test: "scripts/__tests__/backup-db.test.ts",
    file: "scripts/backup-db.sh",
    find: 'done < <(find "$BACKUP_DIR" -maxdepth 1 -name \'highdesert-*.dump\' -mtime "+$((RETENTION_DAYS - 1))")',
    replace: 'done < <(find "$BACKUP_DIR" -maxdepth 1 -name \'highdesert-*.dump\' -mtime "+99999")',
    why: "dumps older than the 14-day window are deleted, or /root/backups grows until the disk fills",
    needs: "TEST_DATABASE_URL",
  },
  {
    id: "backup-mac-floor",
    test: "scripts/__tests__/backup-db.test.ts",
    file: "scripts/backup-db.sh",
    find: "  elif (( free_mb < MAC_MIN_FREE_MB )); then",
    replace: "  elif false; then",
    why: "never push a backup onto a Mac with under 5 GB free — the same floor repo-bundle enforces",
    needs: "TEST_DATABASE_URL",
  },
  {
    id: "backup-status-stale",
    test: "scripts/__tests__/backup-db.test.ts",
    file: "scripts/backup-status.sh",
    find: "if (( age_s > MAX_AGE_H * 3600 )); then",
    replace: "if false; then",
    why: "a missed night writes nothing; an old newest dump is the only trace it leaves",
  },
  {
    id: "unit-loopback",
    test: "scripts/__tests__/service-unit.test.ts",
    file: "deploy/highdesert.service",
    find: "ExecStart=/usr/bin/node /root/High-Desert/node_modules/.bin/next start -H 127.0.0.1 -p 3003",
    replace: "ExecStart=/usr/bin/node /root/High-Desert/node_modules/.bin/next start -p 3003",
    why: "listening on * exposes the app past nginx, where X-Forwarded-For is spoofable (HD-026)",
  },
  {
    id: "unit-protect-home",
    test: "scripts/__tests__/service-unit.test.ts",
    file: "deploy/highdesert.service",
    find: "ProtectHome=read-only",
    replace: "ProtectHome=no",
    why: "ProtectSystem=strict does not cover /root; without this the app can write its own source",
  },
  {
    id: "json-body-object",
    test: "src/app/api/__tests__/null-body.test.ts",
    file: "src/lib/utils/json-body.ts",
    find: "  if (typeof body !== \"object\" || body === null || Array.isArray(body)) {",
    replace: "  if (false) {",
    why: "a JSON body of null was an unhandled 500 on every POST stats route (HD-028)",
  },
  {
    id: "sample-prunes-weeks",
    test: "src/app/api/stats/sample/__tests__/maintenance.test.ts",
    file: "src/app/api/stats/sample/route.ts",
    find: "      prunedWeeks = await pruneOldWeeks();",
    replace: "      prunedWeeks = 0;",
    why: "pruneOldWeeks() was defined and never called; weekly_plays grew forever (HD-029)",
  },
  {
    id: "catalog-failure-not-cached",
    test: "src/services/stats/__tests__/catalog-retry.test.ts",
    file: "src/services/stats/catalog.ts",
    find: "    return null;",
    replace: "    return new Map();",
    why: "a failed catalog read used to be cached as an empty map until restart (HD-031)",
  },
  {
    id: "pool-statement-timeout",
    test: "src/services/stats/__tests__/store.db.test.ts",
    file: "src/services/stats/store.ts",
    find: "    statement_timeout: STATEMENT_TIMEOUT_MS,",
    replace: "    // statement_timeout removed",
    why: "one slow statement must not hold one of eight pool connections indefinitely (HD-031)",
    needs: "TEST_DATABASE_URL",
  },
  {
    id: "rollup-plays-index",
    test: "src/services/stats/__tests__/store.db.test.ts",
    file: "src/services/stats/store.ts",
    find: "      WHERE played_at >= ((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::timestamp",
    replace: "      WHERE (played_at AT TIME ZONE 'UTC')::date >= ((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::timestamp",
    why: "wrapping played_at in an expression makes every rollup seq-scan the never-pruned play_events (HD-020)",
    needs: "TEST_DATABASE_URL",
  },
  {
    id: "rollup-samples-index",
    test: "src/services/stats/__tests__/store.db.test.ts",
    file: "src/services/stats/store.ts",
    find: "      WHERE sampled_at >= ((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::timestamp",
    replace: "      WHERE (sampled_at AT TIME ZONE 'UTC')::date >= ((now() AT TIME ZONE 'UTC')::date - ($1::int - 1))::timestamp",
    why: "the same expression-wrapped predicate on listener_samples (HD-020)",
    needs: "TEST_DATABASE_URL",
  },
  {
    id: "status-drift",
    test: "scripts/__tests__/status.test.ts",
    file: "scripts/status.sh",
    find: 'elif [[ "$deployed_ref" != "$head_ref" ]]; then',
    replace: "elif false; then",
    why: "a commit on main that was never deployed is invisible unless something compares them",
  },
  {
    id: "status-audit",
    test: "scripts/__tests__/status.test.ts",
    file: "scripts/status.sh",
    find: "elif (( crit + high > 0 )); then",
    replace: "elif false; then",
    why: "the critical Next.js advisory went unnoticed because nothing looked",
  },
  {
    id: "status-sampler",
    test: "scripts/__tests__/status.test.ts",
    file: "scripts/status.sh",
    find: 'if [[ "$timer_state" != active ]]; then',
    replace: "if false; then",
    why: "the sampler is the only writer of traffic history; a stopped timer records nothing and says nothing",
  },
];

const filters = process.argv.slice(2);
const selected = filters.length
  ? MUTATIONS.filter((m) => filters.some((f) => m.id.includes(f) || m.test.includes(f)))
  : MUTATIONS;

if (selected.length === 0) {
  console.error(`No mutation matches ${filters.join(", ")}`);
  process.exit(2);
}

/**
 * Refuse to run against uncommitted changes in any file we are about to break.
 * The in-memory restore below is the primary safety net; this is the one that
 * survives the process being killed mid-run, because `git checkout --` can then
 * put things back.
 */
async function assertClean(files) {
  const { stdout } = await execFileP("git", ["status", "--porcelain", "--", ...files], {
    cwd: ROOT,
  });
  if (stdout.trim() !== "") {
    console.error("Refusing to run: uncommitted changes in files this would mutate.\n");
    console.error(stdout);
    console.error("Commit or stash first — a crash mid-run would lose them.");
    process.exit(2);
  }
}

function runVitest(testFile) {
  return new Promise((resolve) => {
    const child = spawn(
      "npx",
      ["vitest", "run", testFile, "--reporter=dot", "--silent"],
      { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
    );
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, out }));
  });
}

const targets = [...new Set(selected.map((m) => m.file))];
await assertClean(targets);

/** Every file we have touched, so a signal can put them all back. */
const originals = new Map();

async function restoreAll() {
  for (const [file, text] of originals) {
    await writeFile(path.join(ROOT, file), text, "utf8");
  }
  originals.clear();
}

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    await restoreAll();
    console.error(`\n[mutate-check] interrupted — restored ${targets.length} file(s)`);
    process.exit(130);
  });
}

const results = [];

console.log(`\n[mutate-check] ${selected.length} mutation(s)\n`);

for (const m of selected) {
  // Some tests need a real database. Without one they skip — and a skipped
  // test observes nothing, so the mutation would "survive" for the wrong
  // reason. Say so plainly instead; in CI, where the database is provided,
  // a missing one is a failure rather than a skip.
  if (m.needs && !process.env[m.needs]) {
    const verdict = process.env.CI ? "NO-ENV" : "skipped";
    results.push({ ...m, verdict, detail: `${m.needs} is not set` });
    console.log(`  ${verdict === "skipped" ? "skip  " : "NO-ENV"} ${m.id.padEnd(24)} needs ${m.needs}`);
    continue;
  }
  const abs = path.join(ROOT, m.file);
  const original = await readFile(abs, "utf8");
  const hits = original.split(m.find).length - 1;

  if (hits !== 1) {
    results.push({ ...m, verdict: "STALE", detail: `found ${hits}x, expected exactly 1` });
    console.log(`  STALE  ${m.id.padEnd(24)} anchor found ${hits}x in ${m.file}`);
    continue;
  }

  originals.set(m.file, original);
  try {
    await writeFile(abs, original.replace(m.find, m.replace), "utf8");
    const { code } = await runVitest(m.test);
    const verdict = code === 0 ? "GREEN" : "red";
    results.push({ ...m, verdict });
    console.log(
      `  ${verdict === "red" ? "red   " : "GREEN "} ${m.id.padEnd(24)} ${m.test}`,
    );
  } finally {
    await writeFile(abs, original, "utf8");
    originals.delete(m.file);
  }
}

const skipped = results.filter((r) => r.verdict === "skipped");
const survivors = results.filter((r) => r.verdict !== "red" && r.verdict !== "skipped");
if (skipped.length) {
  console.log(
    `\n[mutate-check] ${skipped.length} mutation(s) NOT CHECKED — their tests need a database.` +
      `\n  On the VPS: set -a; . /root/.high-desert-test.env; set +a  (CI always runs them)`,
  );
}

console.log("");
if (survivors.length === 0) {
  console.log(
    `[mutate-check] all ${results.length - skipped.length} checked mutations went red. Every test observes its subject.\n`,
  );
  process.exit(0);
}

console.log("═".repeat(72));
console.log(`  ${survivors.length} MUTATION(S) SURVIVED — these tests cannot see their subject`);
console.log("═".repeat(72));
for (const s of survivors) {
  console.log(`\n  ${s.id}  [${s.verdict}]`);
  console.log(`    test      ${s.test}`);
  console.log(`    mutated   ${s.file}`);
  console.log(`      -       ${s.find}`);
  console.log(`      +       ${s.replace}`);
  console.log(`    guards    ${s.why}`);
  if (s.detail) console.log(`    note      ${s.detail}`);
}
console.log("");
process.exit(1);
