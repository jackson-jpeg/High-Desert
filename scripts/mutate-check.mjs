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
    id: "persist-after-user-write",
    test: "src/db/__tests__/persist.test.ts",
    file: "src/db/persist.ts",
    find: "if (USER_EPISODE_FIELDS.some((f) => f in changed)) afterCommit(trans);",
    replace: "if (false) afterCommit(trans);",
    why: "HD-010: a favourite, rating or saved position must ask for persistent storage — otherwise the library stays evictable",
  },
  {
    id: "persist-once-per-profile",
    test: "src/db/__tests__/persist.test.ts",
    file: "src/db/persist.ts",
    find: "if (await db.userPrefs.where(\"key\").equals(PERSIST_REQUESTED_PREF).first()) {",
    replace: "if (false) {",
    why: "HD-010: persist() is asked once per profile, never again after a reload",
  },
  {
    id: "persist-not-on-seed",
    test: "src/db/__tests__/persist.test.ts",
    file: "src/db/persist.ts",
    find: "if (!trans.storeNames.includes(\"episodes\")) afterCommit(trans);",
    replace: "afterCommit(trans);",
    why: "HD-010: the seed restoring shipped playlists is not the listener's write and must not spend the one request",
  },
  {
    id: "cache-serialized",
    test: "src/audio/__tests__/cache.test.ts",
    file: "src/audio/cache.ts",
    find: "const run = writeQueue.then(() => writeOne(fileHash, blob)).catch((err): CacheWriteResult => {",
    replace: "const run = Promise.resolve().then(() => writeOne(fileHash, blob)).catch((err): CacheWriteResult => {",
    why: "HD-010: parallel OPFS writes all see the same free space and overrun the quota together",
  },
  {
    id: "cache-quota-fraction",
    test: "src/audio/__tests__/cache.test.ts",
    file: "src/audio/cache.ts",
    find: "return usage + bytes > quota * CACHE_QUOTA_FRACTION ? \"over-quota\" : \"ok\";",
    replace: "return \"ok\";",
    why: "HD-010: the audio cache must leave headroom for the library it shares a quota with; eviction takes the whole origin",
  },
  {
    id: "cache-no-partial",
    test: "src/audio/__tests__/cache.test.ts",
    file: "src/audio/cache.ts",
    find: "try { await dir?.removeEntry(key); } catch { /* never created */ }",
    replace: "",
    why: "a failed write must not leave a truncated file to be served later as a valid cache hit",
  },
  {
    id: "user-data-one-transaction",
    test: "src/services/user-data/__tests__/portable.test.ts",
    file: "src/services/user-data/portable.ts",
    find: "return db.transaction(\"rw\", TABLES(), fn);",
    replace: "return fn();",
    why: "HD-010: an import that fails part-way must leave the profile exactly as it was",
  },
  {
    id: "user-data-keep-local-rating",
    test: "src/services/user-data/__tests__/portable.test.ts",
    file: "src/services/user-data/portable.ts",
    find: "if (incoming.rating && !ep.rating) { change.rating = incoming.rating; summary.ratings++; }",
    replace: "if (incoming.rating) { change.rating = incoming.rating; summary.ratings++; }",
    why: "HD-010: import merges — a rating the profile already has is kept, never overwritten",
  },
  {
    id: "user-data-history-dedupe",
    test: "src/services/user-data/__tests__/portable.test.ts",
    file: "src/services/user-data/portable.ts",
    find: "      if (existing.has(key)) continue;\n      existing.add(key);\n      newHistory.push(",
    replace: "      newHistory.push(",
    why: "HD-010: importing the same file twice must not double the listener's history",
  },
  {
    id: "user-data-playlist-merge",
    test: "src/services/user-data/__tests__/portable.test.ts",
    file: "src/services/user-data/portable.ts",
    find: "      if (!mine) {",
    replace: "      if (true) {",
    why: "HD-010: a playlist that exists already gains the file's episodes rather than being duplicated",
  },
  {
    id: "user-data-by-filehash",
    test: "src/services/user-data/__tests__/portable.test.ts",
    file: "src/services/user-data/portable.ts",
    find: "      const row: ExportedEpisode = { fileHash: ep.fileHash };",
    replace: "      const row: ExportedEpisode = { fileHash: String(ep.id) };",
    why: "HD-010: episodes travel by fileHash; a local id means another show on another profile",
  },
  {
    id: "catalog-export-no-personal",
    test: "src/db/__tests__/catalog-export.test.ts",
    file: "src/db/catalog-export.ts",
    find: "  \"aiStatus\",",
    replace: "  \"aiStatus\", \"favoritedAt\", \"rating\",",
    why: "HD-025: the admin's favourites and ratings were shipped in the seed to every new visitor",
  },
  {
    id: "catalog-export-no-local",
    test: "src/db/__tests__/catalog-export.test.ts",
    file: "src/db/catalog-export.ts",
    find: "    .filter((ep) => ep.source !== \"local\")",
    replace: "    .filter(() => true)",
    why: "HD-025: a scanned local file carries a path on the admin's disk and is playable by nobody else",
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
    find: "if (firstPlay && ep) countListen(ep, id);",
    replace: "if (false && ep) countListen(ep, id);",
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
    find: "player.setVolume((leftS / FADE_SECONDS) * fadeFrom);",
    replace: "player.setVolume((leftS / FADE_SECONDS) * player.volume);",
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
    id: "turbopack-root",
    test: "src/lib/__tests__/security-headers.test.ts",
    file: "next.config.ts",
    find: "  turbopack: { root: __dirname },",
    replace: "  turbopack: {},",
    why: "without it Next infers /root as the workspace (a live lockfile for other services lives there) and warns on every start",
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
    find: "(( free_mb < need_mb )); then",
    replace: "(( free_mb < 5120 )); then",
    why: "the Mac floor is the dump's size plus 500 MB, not a fixed 5 GB — a fixed floor strands every backup on a Mac whose disk is permanently tight",
    needs: "TEST_DATABASE_URL",
  },
  {
    id: "backup-mac-floor-skip",
    test: "scripts/__tests__/backup-db.test.ts",
    file: "scripts/backup-db.sh",
    find: "(( free_mb < need_mb )); then",
    replace: "false; then",
    why: "a dump that does not fit must not be pushed onto the Mac",
    needs: "TEST_DATABASE_URL",
  },
  {
    id: "backup-status-mac-warn",
    test: "scripts/__tests__/backup-db.test.ts",
    file: "scripts/backup-status.sh",
    find: '  if [[ "$mac" == skipped* ]]; then',
    replace: "  if false; then",
    why: "a skipped Mac copy must surface as a WARN line, not vanish into an OK",
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
    id: "status-backup-warn",
    test: "scripts/__tests__/status.test.ts",
    file: "scripts/status.sh",
    find: '  [[ -n "$backup_warn" ]] && line WARN backup "$backup_warn"',
    replace: "  :",
    why: "a skipped Mac copy is a WARN in highdesert-status — visible, never a queue item, never a FAIL",
  },
  {
    id: "status-sampler",
    test: "scripts/__tests__/status.test.ts",
    file: "scripts/status.sh",
    find: 'if [[ "$timer_state" != active ]]; then',
    replace: "if false; then",
    why: "the sampler is the only writer of traffic history; a stopped timer records nothing and says nothing",
  },
  {
    id: "sleep-pauses-engine",
    test: "src/stores/__tests__/sleep-timer-store.test.ts",
    file: "src/stores/sleep-timer-store.ts",
    find: "      pauseEngine();\n",
    replace: "",
    why: "HD-001: the timer must pause the element itself; the store saying 'paused' is what the old code achieved while the show played all night",
  },
  {
    id: "sleep-wall-clock",
    test: "src/stores/__tests__/sleep-timer-store.test.ts",
    file: "src/stores/sleep-timer-store.ts",
    find: "const leftMs = deadline - Date.now();",
    replace: "const leftMs = (get().remaining - 1) * 1000;",
    why: "HD-024: counting ticks lets a throttled background tab stretch a 30-minute timer indefinitely",
  },
  {
    id: "start-generation-catch",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "        if (!isCurrentStart(id)) return;\n        if (isAbortError(err)) return;\n        console.error(\"[player] Playback failed:\", err);",
    replace: "        if (isAbortError(err)) return;\n        console.error(\"[player] Playback failed:\", err);",
    why: "HD-003: a superseded start's refusal was charged to the watchdog, which spent a retry tearing down the element for a show the listener had left",
  },
  {
    id: "start-generation-success",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "        // replaced. Its success is not ours to announce or count.\n        if (!isCurrentStart(id)) return;\n",
    replace: "        // replaced. Its success is not ours to announce or count.\n",
    why: "HD-003: a superseded start that resolves late must not count a listen or claim to be playing",
  },
  {
    id: "start-generation-entry",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "      // caller was still resolving this one. Touch nothing.\n      if (!isCurrentStart(id)) return;\n",
    replace: "      // caller was still resolving this one. Touch nothing.\n",
    why: "HD-003: a start superseded while its handler resolved the URL must not load over the newer one",
  },
  {
    id: "abort-not-failure",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "        if (isAbortError(err)) return;\n        console.error(\"[player] Playback failed:\", err);",
    replace: "        console.error(\"[player] Playback failed:\", err);",
    why: "HD-003: an AbortError is load()/pause() interrupting play() — the listener changing course, not a failure",
  },
  {
    id: "abort-event-not-error",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "    const onAbort = () => {\n      setBuffering(false);\n    };",
    replace: "    const onAbort = () => {\n      setBuffering(false);\n      if (isWatching()) noteError(\"network-error\");\n    };",
    why: "the queued `abort` of a replaced fetch lands after the next show arms the watchdog; treating it as an error charged a phantom failure to the new show",
  },
  {
    id: "pause-disarms-unsettled-load",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "    if (isWatching() && !isListenCounted()) disarmWatchdog();\n",
    replace: "",
    why: "a show paused before its load settled must not time out into a failure dialog nobody is waiting for",
  },
  {
    id: "counted-listen-flag",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "const firstPlay = !isListenCounted() && !isWatching();",
    replace: "const firstPlay = audio.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && !isWatching();",
    why: "HD-024: a seek while paused drops readyState, so pause-scrub-resume counted a brand new listen",
  },
  {
    id: "finished-starts-over",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/audio/play-session.ts",
    find: "  if (pos >= duration - FINISHED_WITHIN_S || pos >= duration * FINISHED_FRACTION) {",
    replace: "  if (false) {",
    why: "HD-004: a finished show resumed in its last seconds, ended at once, and the queue moved on — 'the show didn't start'",
  },
  {
    id: "ended-clears-position",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: ".update(finished.id, { playbackPosition: 0, updatedAt: Date.now() })",
    replace: ".update(finished.id, { updatedAt: Date.now() })",
    why: "HD-004: nothing reset the saved position at the end of a show",
  },
  {
    id: "seek-held-for-metadata",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/audio/engine.ts",
    find: "    pendingSeek = null;\n    audio.currentTime = clampToDuration(audio, t);\n  });",
    replace: "    pendingSeek = null;\n    void t;\n  });",
    why: "HD-024: a seek before the element has a timeline must be applied on loadedmetadata, or scrubbing a restored show does nothing",
  },
  {
    id: "next-escapes-repeat-one",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/stores/player-store.ts",
    find: "if (!opts?.manual && repeat === \"one\" && queueIndex >= 0 && queueIndex < queue.length) {",
    replace: "if (repeat === \"one\" && queueIndex >= 0 && queueIndex < queue.length) {",
    why: "HD-024: in repeat-one, Next handed back the same track — a button that did nothing",
  },
  {
    id: "mediasession-pause-explicit",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "      [\"pause\", () => pausePlayback()],",
    replace: "      [\"pause\", () => togglePlay()],",
    why: "HD-032: a toggle inverts whenever the store is out of step with the element — a lock-screen pause that starts the show",
  },
  {
    id: "mediasession-play-explicit",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "      [\"play\", () => void resumePlayback()],",
    replace: "      [\"play\", () => void togglePlay()],",
    why: "HD-032: the lock screen's play must play",
  },
  {
    id: "position-save-caught",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "    .catch((err) => {\n      console.warn(\"[player] Failed to save position:\", err);\n    });",
    replace: "    ;",
    why: "HD-032: the position save ran in an interval with no catch — an unhandled rejection on every tick",
  },
  {
    id: "position-save-on-pause",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "          savePosition();\n",
    replace: "",
    why: "HD-016: with a 30 s interval, the pause position must be written at the pause",
  },
  {
    id: "position-save-cadence",
    test: "src/hooks/__tests__/global-listeners.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "export const POSITION_SAVE_MS = 30_000;",
    replace: "export const POSITION_SAVE_MS = 5_000;",
    why: "HD-016: every save re-runs full-table live queries; at 5 s that is ~2,000 rebuilds per show",
  },
  {
    id: "seek-immutable",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "          usePlayerStore.getState().patchCurrentEpisode({ playbackPosition: clamped });",
    replace: "          ep.playbackPosition = clamped;",
    why: "HD-032: writing into the store's object changes state with no set(), invisible to subscribers",
  },
  {
    id: "blob-not-revoked-before-retry",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "        if (isWatching()) {\n          noteError(\"play-rejected\");\n        } else {\n          usePlayerStore.getState().setLoadState(\"failed\");\n          setError(\"Playback failed. The audio source may be unavailable.\");",
    replace: "        if (isObjectUrl) URL.revokeObjectURL(url);\n        if (isWatching()) {\n          noteError(\"play-rejected\");\n        } else {\n          usePlayerStore.getState().setLoadState(\"failed\");\n          setError(\"Playback failed. The audio source may be unavailable.\");",
    why: "HD-033: revoking the object URL before the watchdog's retry re-assigns it guarantees the retry fails",
  },
  {
    id: "object-url-owned-on-retry",
    test: "src/hooks/__tests__/play-session.test.ts",
    file: "src/hooks/useAudioPlayer.ts",
    find: "    (objectUrl !== \"\" && objectUrl !== store.objectUrl)\n",
    replace: "    false\n",
    why: "HD-033: a re-picked file for the same show must be owned by the store, or it is never revoked",
  },
  {
    id: "watchdog-blob-no-buster",
    test: "src/audio/__tests__/playback-watchdog.test.ts",
    file: "src/audio/playback-watchdog.ts",
    find: "  if (/^(blob|data):/i.test(url)) return url;\n",
    replace: "",
    why: "HD-033: `blob:…?hd_retry=1` names nothing, so a local file's retry could never work",
  },
  {
    id: "watchdog-superseded-giveup",
    test: "src/audio/__tests__/playback-watchdog.test.ts",
    file: "src/audio/playback-watchdog.ts",
    find: "  // over the attempt that replaced it and raise the dialog on the wrong show.\n  if (current) current.settled = true;\n",
    replace: "  // over the attempt that replaced it and raise the dialog on the wrong show.\n",
    why: "HD-003: a superseded retry's rejection gave up on its replacement — clearing its timers and opening the dialog over the wrong show",
  },
  {
    id: "bookmark-seeks-engine",
    test: "src/components/player/__tests__/bookmark-markers.test.tsx",
    file: "src/components/player/BookmarkMarkers.tsx",
    find: "              usePlayerStore.getState().setPosition(seekEngine(bm.position));",
    replace: "              usePlayerStore.getState().setPosition(bm.position);",
    why: "HD-012: moving only the store moved nothing — the next position tick overwrote it",
  },
  {
    id: "scan-preview-clears-timers",
    test: "src/audio/__tests__/scan-preview.test.ts",
    file: "src/audio/scan-preview.ts",
    find: "    const mine = ++generation;\n\n    clearAll();\n",
    replace: "    const mine = ++generation;\n\n",
    why: "HD-014: a new preview left the last one's fade timers running against a dead element",
  },
  {
    id: "scan-preview-no-empty-src",
    test: "src/audio/__tests__/scan-preview.test.ts",
    file: "src/audio/scan-preview.ts",
    find: "  el.removeAttribute(\"src\");\n  el.load();\n}",
    replace: "  el.src = \"\";\n}",
    why: "HD-014: `src = \"\"` fetches the HTML page and tries to decode it as audio",
  },
  {
    id: "scan-preview-seek-on-metadata",
    test: "src/audio/__tests__/scan-preview.test.ts",
    file: "src/audio/scan-preview.ts",
    find: "        if (offset > 0) el.currentTime = offset;",
    replace: "        void offset;",
    why: "HD-014: the preview offset must be applied once the element has a timeline",
  },
  {
    id: "audio-player-no-position",
    test: "src/components/player/__tests__/render-pressure.test.tsx",
    file: "src/components/player/AudioPlayer.tsx",
    find: "  // `position` is deliberately NOT selected here — see PositionReadouts.tsx.",
    replace: "  usePlayerStore((s) => s.position);",
    why: "HD-017: selecting position re-rendered the whole player four times a second",
  },
  {
    id: "shell-no-timer-state",
    test: "src/components/desktop/__tests__/shell-render-pressure.test.tsx",
    file: "src/components/desktop/DesktopShell.tsx",
    find: "  // No timer-driven state in the shell. The clock and the caller rotation live in <StatusBar>.",
    replace: "  const [, setShellClock] = useState(\"\"); useEffect(() => { const id = setInterval(() => setShellClock(String(Date.now())), 30000); return () => clearInterval(id); }, []);",
    why: "HD-018: a 30 s clock held in the shell re-rendered every menu and nav tab on each tick",
  },
  {
    id: "status-bar-clock-ticks",
    test: "src/components/desktop/__tests__/shell-render-pressure.test.tsx",
    file: "src/components/desktop/StatusBar.tsx",
    find: "    const id = setInterval(tick, STATUS_TICK_MS);",
    replace: "    const id = setInterval(() => {}, STATUS_TICK_MS);",
    why: "the render-count test must see the clock move, or a status bar that stopped ticking passes it",
  },
  {
    id: "status-bar-caller-rotates",
    test: "src/components/desktop/__tests__/shell-render-pressure.test.tsx",
    file: "src/components/desktop/StatusBar.tsx",
    find: "        setCallerIdx((prev) => (prev + 1) % CALLER_MESSAGES.length);",
    replace: "        setCallerIdx((prev) => prev);",
    why: "the caller line rotates every 30 s — the second of the two intervals the shell no longer owns",
  },
  {
    id: "admin-prompt-listener",
    test: "src/components/desktop/__tests__/admin-prompt-dialog.test.tsx",
    file: "src/components/desktop/AdminPromptDialog.tsx",
    find: '  useHdEvent("admin-prompt", () => setOpen(true));',
    replace: "  void setOpen;",
    why: "the admin-prompt event is the prompt's only way in; without the listener it is silently unreachable",
  },
  {
    id: "admin-prompt-wrong-password",
    test: "src/components/desktop/__tests__/admin-prompt-dialog.test.tsx",
    file: "src/components/desktop/AdminPromptDialog.tsx",
    find: "      setError(\"Wrong password\");",
    replace: "      setError(\"\");",
    why: "a refused password must say so, not leave the dialog sitting there unchanged",
  },
  {
    id: "shell-menus-sort-detail",
    test: "src/hooks/__tests__/shell-menus.test.tsx",
    file: "src/hooks/useShellMenus.ts",
    find: "  const sort = (mode: SortMode) => openLibrary({ sort: mode });",
    replace: "  const sort = (mode: SortMode) => openLibrary({ q: mode });",
    why: "View > Sort items reach the library only through the ?sort= intent (HD-013)",
  },
  {
    id: "shell-menus-admin-gate",
    test: "src/hooks/__tests__/shell-menus.test.tsx",
    file: "src/hooks/useShellMenus.ts",
    find: "    ...(isAdmin\n      ? [{",
    replace: "    ...(true\n      ? [{",
    why: "the Library menu (Clear Library, Deduplicate) is admin-only",
  },
  {
    id: "text-scale-persists",
    test: "src/hooks/__tests__/text-scale-preference.test.tsx",
    file: "src/hooks/useTextScalePreference.ts",
    find: "    await setPreference(\"text-scale\", value);",
    replace: "    void value;",
    why: "a text size that is applied but not written to Dexie is gone on the next visit",
  },
  {
    id: "text-scale-loads",
    test: "src/hooks/__tests__/text-scale-preference.test.tsx",
    file: "src/hooks/useTextScalePreference.ts",
    find: "      if (v === \"1.15\" || v === \"1.3\") applyTextScale(v);",
    replace: "      void v;",
    why: "the stored text size must be applied at mount, not only when changed",
  },
  {
    id: "lint-bans-audio-lookup",
    test: "src/lib/__tests__/eslint-rules.test.ts",
    file: "eslint.config.mjs",
    find: "      \"no-restricted-syntax\": [\"error\", ...AUDIO_ELEMENT_RULES, ...HD_EVENT_NAME_RULES],",
    replace: "      \"no-restricted-syntax\": \"off\",",
    why: "the lint ban is what stops document.querySelector(\"audio\") and src = \"\" coming back",
  },
  {
    id: "event-routes-listener",
    test: "src/lib/__tests__/event-routes.test.ts",
    file: "src/components/desktop/DesktopShell.tsx",
    find: '  useHdEvent("toggle-shortcuts", () => setShortcutsOpen((prev) => !prev));',
    replace: "  void setShortcutsOpen;",
    why: "an instruction emitted with no listener mounted on its route is HD-013; the route test must see a listener go (HD-019)",
  },
  {
    id: "event-routes-hd013",
    test: "src/lib/__tests__/event-routes.test.ts",
    file: "src/components/desktop/StatusBar.tsx",
    find: '  const handleGhostClick = useCallback(() => openLibrary({ q: "ghost to ghost" }), [openLibrary]);',
    replace: '  const handleGhostClick = useCallback(() => emit("filter-tag", "ghost to ghost"), []);',
    why: "a library event fired from the shell reaches nothing on /stats — HD-013 exactly; only the per-route check can see it",
  },
  {
    id: "intent-parse-sort",
    test: "src/lib/library/__tests__/intents.test.ts",
    file: "src/lib/library/intents.ts",
    find: "  if (sort !== null && (SORT_MODES as readonly string[]).includes(sort)) intent.sort = sort as SortMode;",
    replace: "  if (sort) intent.sort = sort as SortMode;",
    why: "an unknown ?sort= must be ignored, not handed to the library as a SortMode (HD-013)",
  },
  {
    id: "intent-parse-shuffle",
    test: "src/lib/library/__tests__/intents.test.ts",
    file: "src/lib/library/intents.ts",
    find: "  if (shuffle !== null && (SHUFFLE_SCOPES as readonly string[]).includes(shuffle)) {",
    replace: "  if (shuffle !== null) {",
    why: "a hand-edited ?shuffle= must not start audio the listener did not ask for (HD-013)",
  },
  {
    id: "intent-reader-clears",
    test: "src/hooks/__tests__/library-intents.test.tsx",
    file: "src/components/library/LibraryIntentReader.tsx",
    find: "    window.history.replaceState(null, \"\", `${pathname}${withoutIntentParams(search)}`);",
    replace: "    void withoutIntentParams;",
    why: "an intent left in the URL shuffles again on every reload (HD-013)",
  },
  {
    id: "intent-shuffle-waits",
    test: "src/hooks/__tests__/library-intents.test.tsx",
    file: "src/hooks/library/useLibraryIntents.ts",
    find: "    if (p.shuffle && allEpisodes && (allEpisodes.length > 0 || seedSettled)) {",
    replace: "    if (p.shuffle) {",
    why: "a shuffle arriving with a cold page must wait for the catalog, not shuffle nothing (HD-013)",
  },
  {
    id: "library-find-scoped",
    test: "src/hooks/__tests__/library-intents.test.tsx",
    file: "src/hooks/library/useLibrarySearchShortcuts.ts",
    find: '    return () => window.removeEventListener("keydown", handler);',
    replace: "    return () => {};",
    why: "Ctrl/Cmd+F must be the browser's again once the library is gone — HD-013's find hijack",
  },
  {
    id: "library-shortcuts-key-ownership",
    test: "src/hooks/__tests__/library-intents.test.tsx",
    file: "src/hooks/library/useLibrarySearchShortcuts.ts",
    find: "      if (isKeyOwnedByTarget(e)) return;",
    replace: "      if (false) return;",
    why: "/ and Q typed into a focused button, dialog or editable must not be taken by the library (HD-011)",
  },
  {
    id: "sort-intent-beats-stored",
    test: "src/hooks/library/__tests__/sort-intent.test.tsx",
    file: "src/hooks/library/useLibraryFilters.ts",
    find: "        if (live && !sortChosen.current && isSortMode(stored)) setSortModeState(stored);",
    replace: "        if (live && isSortMode(stored)) setSortModeState(stored);",
    why: "a ?sort= intent is the visitor's newest choice; a stored sort arriving later must not undo it",
  },
  {
    id: "view-menu-oldest-first",
    test: "src/hooks/__tests__/shell-menus.test.tsx",
    file: "src/hooks/useShellMenus.ts",
    find: '        { label: "Sort by Date — Oldest First", onClick: () => sort("date-asc") },',
    replace: '        { label: "Sort by Date — Oldest First", onClick: () => sort("date") },',
    why: "View > Oldest First must ask the library for date-asc, the only oldest-first sort",
  },
  {
    id: "lint-e2e-fixtures-import",
    test: "src/lib/__tests__/eslint-rules.test.ts",
    file: "eslint.config.mjs",
    find: '    files: ["e2e/**/*.ts"],',
    replace: '    files: ["e2e/nowhere/*.ts"],',
    why: "a spec that bypasses e2e/fixtures.ts writes real plays to the server it runs against",
  },
  {
    id: "events-transport-name",
    test: "src/lib/__tests__/events.test.tsx",
    file: "src/lib/events.ts",
    find: "  return `hd:${type}`;",
    replace: "  return type;",
    why: "the transport must stay window + hd:<key>, which the e2e helpers and any outside listener speak (HD-019)",
  },
  {
    id: "events-hook-subscribes-once",
    test: "src/lib/__tests__/events.test.tsx",
    file: "src/lib/events.ts",
    find: "  useEffect(() => onHdEvent(type, (detail) => onEvent(detail)), [type]);",
    replace: "  useEffect(() => onHdEvent(type, handler), [type, handler]);",
    why: "useHdEvent must hear with the latest handler without re-subscribing on every render (HD-019)",
  },
  {
    id: "lint-bans-hd-event-names",
    test: "src/lib/__tests__/eslint-rules.test.ts",
    file: "eslint.config.mjs",
    find: '    selector: "Literal[value=/^hd:/]",',
    replace: '    selector: "Literal[value=/^hd-never:/]",',
    why: "a raw new CustomEvent(\"hd:…\") outside events.ts is an untyped, unchecked intent — HD-013's shape (HD-019)",
  },
  {
    id: "lint-hd-events-home",
    test: "src/lib/__tests__/eslint-rules.test.ts",
    file: "eslint.config.mjs",
    find: '    files: ["src/lib/events.ts"],',
    replace: '    files: ["src/lib/nowhere.ts"],',
    why: "events.ts itself must be allowed to spell the names, or the ban cannot be obeyed",
  },
  {
    id: "failure-window-advisory",
    test: "src/services/stats/__tests__/store.db.test.ts",
    file: "src/services/stats/store.ts",
    find: "               AND NOT (kind = ANY($3)))                AS failures,",
    replace: "               AND $3::text[] IS NOT NULL)               AS failures,",
    needs: "TEST_DATABASE_URL",
    why: "the release window would count advisory rows — reports that never stopped playback — as failed starts",
  },
  {
    id: "failure-window-seven-days",
    test: "src/app/api/stats/failures/__tests__/since-window.test.ts",
    file: "src/app/api/stats/failures/route.ts",
    find: "new Date(Math.min(since.getTime() + WINDOW_MS, Date.now()))",
    replace: "new Date(Date.now())",
    why: "the release window would never close, and turn back into the trailing rate it exists to replace",
  },
  {
    id: "status-release-since",
    test: "scripts/__tests__/status.test.ts",
    file: "scripts/status.sh",
    find: "failures?days=7&since=$release_at\"",
    replace: "failures?days=7&since=2026-01-01T00:00:00Z\"",
    why: "the release line must measure from the timestamp the baseline doc records, not some other instant",
  },
  {
    id: "status-release-target",
    test: "scripts/__tests__/status.test.ts",
    file: "scripts/status.sh",
    find: "'BEGIN { exit !(x >= t) }' && level=WARN",
    replace: "'BEGIN { exit !(x > t) }' && level=WARN",
    why: "a release sitting exactly at the 3% target would read OK",
  },
  // HD-018: the library list pipeline and facets, out of library/page.tsx.
  {
    id: "library-filter-guest",
    test: "src/lib/library/__tests__/filter-episodes.test.ts",
    file: "src/lib/library/filter-episodes.ts",
    find: "list = list.filter((ep) => ep.guestName === guestFilter);",
    replace: "list = list.filter(() => true);",
    why: "clicking a guest in the browse panel must narrow the list to that guest",
  },
  {
    id: "library-filter-bookmark",
    test: "src/lib/library/__tests__/filter-episodes.test.ts",
    file: "src/lib/library/filter-episodes.ts",
    find: "list = list.filter((ep) => bookmarkedIds?.has(ep.id!));",
    replace: "list = list.filter(() => true);",
    why: "has:bookmark reads the bookmark set, the one criterion that is not a field on the row",
  },
  {
    id: "library-filter-text-tags",
    test: "src/lib/library/__tests__/filter-episodes.test.ts",
    file: "src/lib/library/filter-episodes.ts",
    find: "ep.aiTags?.some((tag) => tag.toLowerCase().includes(q)),",
    replace: "false,",
    why: "free text searches AI tags as well as titles",
  },
  {
    id: "library-sort-series-part",
    test: "src/lib/library/__tests__/filter-episodes.test.ts",
    file: "src/lib/library/filter-episodes.ts",
    find: "return partA - partB || (a.airDate ?? \"\").localeCompare(b.airDate ?? \"\");",
    replace: "return (a.airDate ?? \"\").localeCompare(b.airDate ?? \"\");",
    why: "a series plays in part order, which is not always air order",
  },
  {
    id: "traffic-two-scales",
    test: "src/lib/library/__tests__/traffic.test.ts",
    file: "src/lib/library/traffic.ts",
    find: "const peakPlays = Math.max(1, ...points.map((p) => p.plays));",
    replace: "const peakPlays = peakPresence;",
    why: "plays and presence are on separate scales, or a play spike pins the presence lines to the floor",
  },
  {
    id: "traffic-night-band-merge",
    test: "src/lib/library/__tests__/traffic.test.ts",
    file: "src/lib/library/traffic.ts",
    find: "if (night && runStart < 0) runStart = i;",
    replace: "if (night) runStart = i;",
    why: "a night run is one band, not a picket fence of per-bucket stripes",
  },
  {
    id: "traffic-tick-dedupe",
    test: "src/lib/library/__tests__/traffic.test.ts",
    file: "src/lib/library/traffic.ts",
    find: "if (seen.has(t.label)) return false;",
    replace: "if (seen.has(t.label)) return true;",
    why: "a short window at hour resolution must not print the same tick label five times",
  },
  {
    id: "traffic-hour-profile-local",
    test: "src/lib/library/__tests__/traffic.test.ts",
    file: "src/lib/library/traffic.ts",
    find: "const offset = -Math.round(timezoneOffsetMinutes / 60);",
    replace: "const offset = 0;",
    why: "the hour profile answers in the visitor's local hours, not UTC",
  },
  {
    id: "traffic-hour-unsampled-dash",
    test: "src/lib/library/__tests__/traffic.test.ts",
    file: "src/lib/library/traffic.ts",
    find: "return bar.samples === 0 ? 3 : Math.max(4, (bar.online / peak) * 100);",
    replace: "return Math.max(4, (bar.online / peak) * 100);",
    why: "an hour never sampled is drawn differently from one watched and found empty",
  },
  {
    id: "episode-detail-draft-clears",
    test: "src/lib/library/__tests__/episode-detail.test.ts",
    file: "src/lib/library/episode-detail.ts",
    find: "title: draft.title || undefined,",
    replace: "title: draft.title,",
    why: "an emptied edit field clears the value rather than storing an empty string",
  },
  {
    id: "episode-detail-play-stats-completed",
    test: "src/lib/library/__tests__/episode-detail.test.ts",
    file: "src/lib/library/episode-detail.ts",
    find: "else if (pct >= 100) parts.push(\"completed\");",
    replace: "else if (pct >= 100) parts.push(`${pct}% heard`);",
    why: "a finished show reads completed, not 100% heard",
  },
  {
    id: "episode-detail-progress-nearly-done",
    test: "src/lib/library/__tests__/episode-detail.test.ts",
    file: "src/lib/library/episode-detail.ts",
    find: "nearlyDone: pos / dur > 0.9,",
    replace: "nearlyDone: false,",
    why: "a show past 90% is drawn as nearly finished",
  },
  {
    id: "episode-detail-series-order",
    test: "src/lib/library/__tests__/episode-detail.test.ts",
    file: "src/lib/library/episode-detail.ts",
    find: "return partA - partB || (a.airDate ?? \"\").localeCompare(b.airDate ?? \"\");",
    replace: "return (a.airDate ?? \"\").localeCompare(b.airDate ?? \"\");",
    why: "the series list shows parts in part order, which is not always air order",
  },
  {
    id: "episode-detail-share-by-key",
    test: "src/lib/library/__tests__/episode-detail.test.ts",
    file: "src/lib/library/episode-detail.ts",
    find: "? `${origin}/library?ep=${encodeURIComponent(shareKey)}`",
    replace: "? `${origin}/library`",
    why: "a shared link carries the community key, the only id that resolves in someone else's browser",
  },
  {
    id: "library-facets-count",
    test: "src/lib/library/__tests__/facets.test.ts",
    file: "src/lib/library/facets.ts",
    find: "if (ep.aiCategory) bump(categoryCounts, ep.aiCategory);",
    replace: "if (ep.aiCategory) categoryCounts.set(ep.aiCategory, 1);",
    why: "the single pass must still count, not just collect, or every facet reads 1 and the ranking is arbitrary",
  },
  {
    id: "library-facets-favorites",
    test: "src/lib/library/__tests__/facets.test.ts",
    file: "src/lib/library/facets.ts",
    find: "if (ep.favoritedAt) favCount++;",
    replace: "",
    why: "the Favorites chip appears once the listener has a favourite — absent from the seed, so only the layered equivalence test sees it",
  },
  {
    id: "keys-owner-button",
    test: "src/lib/utils/__tests__/key-ownership.test.ts",
    file: "src/lib/utils/key-ownership.ts",
    find: '  "button",\n  "a[href]",',
    replace: '  "a[href]",',
    why: "HD-011: without BUTTON a focused button loses Enter/Space to the page — the layout's Space toggled playback and the library's Enter played the selection",
  },
  {
    id: "keys-library-guard",
    test: "src/hooks/library/__tests__/library-keys.test.tsx",
    file: "src/hooks/library/useLibraryKeyboard.ts",
    find: "      if (isKeyOwnedByTarget(e)) return;\n",
    replace: "",
    why: "HD-011: the library must consult the guard, or Enter on any focused button (including the dialog's Delete) plays the selected episode",
  },
  {
    id: "keys-radio-guard",
    test: "src/components/radio/__tests__/radio-keys.test.tsx",
    file: "src/components/radio/RadioDial.tsx",
    find: "      if (isKeyOwnedByTarget(e)) return;\n",
    replace: "",
    why: "HD-011: the dial captured Enter and Space everywhere, so its own Seek/Scan buttons could not be pressed from the keyboard",
  },
  {
    id: "keys-single-delete-confirm",
    test: "src/hooks/library/__tests__/library-keys.test.tsx",
    file: "src/hooks/library/useLibraryKeyboard.ts",
    find: "onRequestDelete([selectedEpisode.id!]);",
    replace: "void import(\"@/services/episodes/management\").then((m) => m.deleteEpisode(selectedEpisode.id!));",
    why: "HD-011: admin Backspace/Delete deleted the selected episode outright — no confirmation, no undo, no server backup",
  },
  {
    id: "keys-detail-delete-confirm",
    test: "src/hooks/library/__tests__/library-keys.test.tsx",
    file: "src/components/library/DetailSheet.tsx",
    find: "onDelete: (ep: Episode) => onRequestDelete([ep.id!]),",
    replace: "onDelete: (ep: Episode) => { void import(\"@/services/episodes/management\").then((m) => m.deleteEpisode(ep.id!)); },",
    why: "HD-011: the detail panel's Delete was a second unconfirmed single-delete path",
  },
  {
    id: "keys-context-delete-confirm",
    test: "src/hooks/library/__tests__/library-keys.test.tsx",
    file: "src/hooks/library/useLibraryActions.ts",
    find: "setPendingDelete([episode.id!]);",
    replace: "await deleteEpisode(episode.id!);",
    why: "HD-011: the row context menu's Delete was a third unconfirmed single-delete path",
  },
  {
    id: "keys-button-owns-arrows",
    test: "src/lib/utils/__tests__/key-ownership.test.ts",
    file: "src/lib/utils/key-ownership.ts",
    find: "const NAVIGATION_OWNERS = [\n",
    replace: "const NAVIGATION_OWNERS = [\n  \"button\",\n",
    why: "HD-011: arrows go to elements that navigate with them; a button that owned arrows is a dead zone after every mouse click",
  },
  {
    id: "keys-button-owns-arrows-radio",
    test: "src/components/radio/__tests__/radio-keys.test.tsx",
    file: "src/lib/utils/key-ownership.ts",
    find: "const NAVIGATION_OWNERS = [\n",
    replace: "const NAVIGATION_OWNERS = [\n  \"button\",\n",
    why: "HD-011: after clicking Scan or Seek (which focuses the button) the arrows must still tune the dial",
  },
  {
    id: "keys-button-owns-arrows-library",
    test: "src/hooks/library/__tests__/library-keys.test.tsx",
    file: "src/lib/utils/key-ownership.ts",
    find: "const NAVIGATION_OWNERS = [\n",
    replace: "const NAVIGATION_OWNERS = [\n  \"button\",\n",
    why: "HD-011: Chromium focuses a button on click; Shift+Arrow must still move the list's selection from there",
  },
  // The library rail is a projection of the list (docs/timeline-rail.md).
  {
    id: "rail-reverse",
    test: "src/lib/library/__tests__/rail-groups.test.ts",
    file: "src/lib/library/rail-groups.ts",
    find: "return groups.length > 1 ? groups : [];",
    replace: "return groups.length > 1 ? groups.reverse() : [];",
    why: "the user report itself: a rail running the opposite way to the list it sits beside",
  },
  {
    id: "rail-overscan",
    test: "src/components/library/__tests__/timeline-rail.test.tsx",
    file: "src/components/library/TimelineView.tsx",
    find: "const firstRow = visibleStartIndex;",
    replace: "const firstRow = virtualItems[0]?.index ?? 0;",
    why: "HD-035: the active group read from an overscan row five rows above the screen",
  },
  {
    id: "rail-click-top",
    test: "src/components/library/__tests__/timeline-rail.test.tsx",
    file: "src/components/library/TimelineView.tsx",
    find: "(group: RailGroup) => scrollToIndex(group.firstIndex, \"start\"),",
    replace: "(group: RailGroup) => scrollToIndex(group.firstIndex),",
    why: "a rail entry means the start of its group; centring it leaves the previous group active",
  },
  {
    id: "rail-scrubber-hides",
    test: "src/components/library/__tests__/year-scrubber.test.tsx",
    file: "src/hooks/useWakeFlag.ts",
    find: "timer.current = setTimeout(() => setAwake(false), idleMs);",
    replace: "timer.current = setTimeout(() => {}, idleMs);",
    why: "the phone scrubber overlays the cards' right edge; one that never hides covers content for good",
  },
  {
    id: "rail-scrubber-index",
    test: "src/components/library/__tests__/year-scrubber.test.tsx",
    file: "src/lib/library/rail-groups.ts",
    find: "const slot = Math.floor(((clientY - trackTop) / trackHeight) * count);",
    replace: "const slot = Math.round(((clientY - trackTop) / trackHeight) * count);",
    why: "the group a drag jumps to must be the label under the finger, not the next one down",
  },
  {
    id: "library-sort-date-asc",
    test: "src/lib/library/__tests__/filter-episodes.test.ts",
    file: "src/lib/library/filter-episodes.ts",
    find: "return a.airDate.localeCompare(b.airDate);",
    replace: "return b.airDate.localeCompare(a.airDate);",
    why: "oldest first must actually be oldest first",
  },
  {
    id: "library-sort-persist",
    test: "src/hooks/library/__tests__/sort-persistence.test.tsx",
    file: "src/hooks/library/useLibraryFilters.ts",
    find: "setPreference(SORT_PREF_KEY, mode).catch(() => {});",
    replace: "",
    why: "the visitor's chosen sort must survive a reload",
  },
  // HD-035, the rest.
  {
    id: "virtual-list-callback-ref",
    test: "src/hooks/__tests__/virtual-list-height.test.tsx",
    file: "src/hooks/useVirtualList.ts",
    find: "  }, [container]);",
    replace: "  }, []);",
    why: "a scroller that mounts after an empty first render must still be observed",
  },
  {
    id: "library-empty-in-progress",
    test: "src/lib/library/__tests__/list-state.test.ts",
    file: "src/lib/library/list-state.ts",
    find: "if (sortMode === \"progress\" && !seriesFilter) return \"nothing-in-progress\";",
    replace: "",
    why: "an empty In Progress view told a full library 'No episodes yet'",
  },
  // HD-021/022/023 and the radio tabs: accessibility (nav/a11y).
  {
    id: "listbox-activedescendant",
    test: "src/components/library/__tests__/episode-listbox.test.tsx",
    file: "src/components/library/TimelineView.tsx",
    find: "            aria-activedescendant={activeRendered ? optionIdFor(activeEpisode) : undefined}",
    replace: "            aria-activedescendant={undefined}",
    why: "focus stays on the listbox; without aria-activedescendant a screen reader hears nothing as the arrows move (HD-021)",
  },
  {
    id: "listbox-selected-one-row",
    test: "src/components/library/__tests__/episode-listbox.test.tsx",
    file: "src/components/library/EpisodeCard.tsx",
    find: "      aria-selected={isSelected}",
    replace: "      aria-selected={true}",
    why: "aria-selected on every row (it was on the selected and the playing row) tells a screen reader nothing (HD-021)",
  },
  {
    id: "listbox-setsize",
    test: "src/components/library/__tests__/episode-listbox.test.tsx",
    file: "src/components/library/TimelineView.tsx",
    find: "                  setSize={episodes.length}",
    replace: "                  setSize={virtualItems.length}",
    why: "a virtualised list must announce the whole list's size, not the rendered window's (HD-021)",
  },
  {
    id: "listbox-plain-arrows",
    test: "src/components/library/__tests__/episode-listbox.test.tsx",
    file: "src/hooks/library/useLibraryKeyboard.ts",
    find: '      } else if (e.code === "ArrowDown" && (e.shiftKey || inList)) {',
    replace: '      } else if (e.code === "ArrowDown" && e.shiftKey) {',
    why: "a focused listbox answers plain Down; Shift+Arrow alone was undiscoverable (HD-021)",
  },
  {
    id: "listbox-scrolls-active-into-view",
    test: "src/components/library/__tests__/episode-listbox.test.tsx",
    file: "src/components/library/TimelineView.tsx",
    find: "      scroller.scrollTop = bottom - scroller.clientHeight;",
    replace: "      void bottom;",
    why: "the list is virtualised: an active row scrolled past is not in the DOM, and aria-activedescendant names nothing (HD-021)",
  },
  {
    id: "palette-focus-trap",
    test: "src/components/__tests__/modal-focus.test.tsx",
    file: "src/components/CommandPalette.tsx",
    find: "        onKeyDown={trap.onKeyDown}",
    replace: '        data-untrapped=""',
    why: "the palette must hold Tab and own Escape — it had no trap, and Tab walked into the page behind (HD-022)",
  },
  {
    id: "focus-trap-escape-stops",
    test: "src/components/__tests__/modal-focus.test.tsx",
    file: "src/hooks/useFocusTrap.ts",
    find: "      e.stopPropagation();",
    replace: "      void 0;",
    why: "Escape in a modal must not also reach the library's window handler and close the detail panel behind it (HD-022)",
  },
  {
    id: "lint-text-opacity-floor",
    test: "src/lib/__tests__/eslint-rules.test.ts",
    file: "eslint-rules/text-opacity.mjs",
    find: "export const TEXT_OPACITY_FLOOR = 85;",
    replace: "export const TEXT_OPACITY_FLOOR = 50;",
    why: "the floor is /85 — text-bevel-dark/85 is 4.89:1 on raised-surface, and below it fails AA (HD-023)",
  },
  {
    id: "lint-text-opacity-wired",
    test: "src/lib/__tests__/eslint-rules.test.ts",
    file: "eslint.config.mjs",
    find: '      "hd/text-opacity-floor": "error",',
    replace: '      "hd/text-opacity-floor": "off",',
    why: "a contrast rule that is not switched on is indistinguishable from a codebase that obeys it (HD-023)",
  },
  {
    id: "radio-year-tabs-arrows",
    test: "src/components/radio/__tests__/year-tabs.test.tsx",
    file: "src/components/radio/YearTabs.tsx",
    find: "      onKeyDown={handleKeyDown}",
    replace: '      data-no-keys=""',
    why: "the guard gives a tablist its arrows; with no handler, after clicking a year the arrows did nothing",
  },
  {
    id: "cn-hd-font-sizes",
    test: "src/lib/utils/__tests__/cn.test.ts",
    file: "src/lib/utils/cn.ts",
    find: "const merge = extendTailwindMerge(HD_MERGE_CONFIG);",
    replace: "const merge = extendTailwindMerge({});",
    why: "plain twMerge read text-hd-* as a colour and dropped the size from 46 cn() calls",
  },
  {
    id: "boot-screen-pointer-events",
    test: "src/app/__tests__/boot-script.test.ts",
    file: "src/app/boot-script.ts",
    find: "el.style.pointerEvents = 'none';",
    replace: "",
    why: "the fading boot screen swallowed the first tap for 400ms",
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
