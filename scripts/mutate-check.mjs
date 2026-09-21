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
    find: "    window.addEventListener(\"hd:admin-prompt\", handler);",
    replace: "    void handler;",
    why: "hd:admin-prompt is the prompt's only way in; without the listener it is silently unreachable",
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
    find: "  window.dispatchEvent(new CustomEvent(\"hd:sort\", { detail: sort }));",
    replace: "  window.dispatchEvent(new CustomEvent(\"hd:sort\"));",
    why: "View > Sort items reach the library only through hd:sort's detail",
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
    find: "      \"no-restricted-syntax\": [\"error\", ...AUDIO_ELEMENT_RULES],",
    replace: "      \"no-restricted-syntax\": \"off\",",
    why: "the lint ban is what stops document.querySelector(\"audio\") and src = \"\" coming back",
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
