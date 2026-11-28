# Handoff 2026-11-28 (overnight): Missed it? Play from the start

The lead's overnight mandate (06:22 UTC): ship the biggest listener-facing
improvement left, phone first at 390 then 1280, mutations through heavy,
shots to the Mac's `~/Downloads/highdesert-night/`, one fyi.

## How it was picked

- The UI plan's pushes 1 to 6 are all live; nothing listed is left.
- **The 30-day numbers.** Live has 58% of plays (3,929 of 7,996 by surface),
  so the Live screen comes first.
- **The phone lines (116 calls in 30 days, read for friction).** On
  2026-11-23 one caller wrote "wish I'd caught Harlot with y'all", and
  another was "listening to it now on YouTube". Tonight's log named every
  show the station had aired and gave no way to hear one. That is the change.
- **Considered and held:**
  - The phone Library still opens newest first (December 2015 specials).
    Desktop opens on Most played since round 2, and phones are left alone
    by rule until the look split's verdict (2026-12-02). Queued for then.
- **Found, not a listener problem:**
  - Desktop show-page "arrivals" (1,346 in 7 days, 2,063 in 30, the largest
    arrival bucket) are a bot farm. Six desktop Chrome user agents (versions
    148 to 150, while real visitors run 158) are spread evenly across rotating
    residential and cloud addresses (nginx log, `POST /api/stats/view` with a
    `/show/` referer).
  - They are counted as arrivals and views: the not-audience filter checks the
    user agent only. Show-page plays (20 in 7 days) are therefore not "1.5% of
    visitors"; the real denominator is unknown.
  - Not fixed tonight: filtering on browser version is fragile. Raised in
    the fyi.

## What shipped (`51bdc70`, `381ff50`)

1. **Play from the start in Tonight's log.**
   - Every show that has aired gets a small "▶ Play from the start" under
     its line. Both looks, phone (44 px target) and desktop.
   - It plays the listener's own row from 0:00 (`playSlotFromStart`).
   - Tuned in, it leaves the station, as any pick does.
   - It is counted as a `library` play, never `live`.
   - Shows on the air or still to come get nothing, and the phone hero keeps
     its one button.
   - Account: `docs/live-qa.md`, "Missed it? Play from the start".
2. **The Request Line's herald was headed "From the archive"** in the lines
   (seen on production: "FROM THE ARCHIVE · Tonight's request, from
   Late-Shift Skywatcher."). The herald comes as reason `request`;
   `isStationNotice()` heads it "From the station" in Night and Notepad.
3. **A date bomb in `report.db.test.ts`** (mine, push 6):
   - It recorded a finish "today" and assumed today falls before
     FINISHES_SINCE (2026-11-28), so it broke on that date.
   - It now uses fixed dates.
   - The suite caught it tonight. The nightly mutation run at 20:30 would
     have read it as a broken test.

## Checks

- **Tests:**
  - New: `log-replay.test.tsx`, the replay test in `live-station.test.tsx`
    (phone and desktop, both looks), and the `playSlotFromStart` block in
    `browser-station.test.ts`.
  - Mutations: `log-replay-*` (5) and `station-notice-request-herald`, all
    red. The `report-` group (17) is red against the fixed test.
- **Lint, typecheck and suite:**
  - Lint and typecheck are clean (6 warnings in files not touched).
  - The full suite: 3,344 passed.
  - 13 files failed only because the worktree's `services/live` had no
    `node_modules`. After `npm ci --prefix services/live` in the worktree
    they pass (332 tests).
  - The one real failure was the date bomb above.
- **On the build (worktree, e2e database, port 3471):**
  - check:seo is clean.
  - check:csp shows no CSP violations; only the chat's `/live-api` 404s on a
    bare `next start`, as before.
  - `e2e/a11y.spec.ts` + `e2e/live-phone.spec.ts`: 72 passed, 8 skipped by
    the specs' project filters.
  - A real-browser click-through at 390, both looks: tune in, tap the
    aired John Lear show. The station let go, the element asked archive.org
    for that file from byte 0, and the player played it.
- **Production:** below, after the deploy.

## Hook blocks this session

- The auto-mode classifier gave no verdict on one Bash call (worktree
  `npm ci --prefix services/live` plus a vitest run), because the pipefail
  hook had rewritten it. Reissued exactly as the hook rewrote it; it ran.

## Production (deployed `381ff50`, 2026-11-28 08:1x UTC)

- `deploy.sh`: clean. The returning visitor passed in Chromium and WebKit
  (8e36f67 to 381ff50, the old worker in control).
- check:csp: 9 routes, no CSP violations, no console errors, no em dashes.
- check:seo: 50 pages, 900 internal links, no findings.
- Station notices went up before (201) and after (201), the second naming
  the new button.
- **The button itself cannot show yet on production.** The station day
  2026-11-28 began at midnight Pacific (08:00 UTC), and its first show ends
  at 11:18 UTC, so nothing has aired today. The read-back (shots and the
  click-through at 390) is queued for 11:21 UTC, before peak; its result is
  below.
- **The production click-through runs with the chat's writes answered in the
  page** (`/live-api/tuned|messages|requests`). The first production run
  started before that line was added; nginx shows no `/live-api/tuned` from
  it, so nothing was posted to the room.

## Noticed, for later

- Just after midnight Pacific, Tonight's log has nothing aired, so a
  listener who missed last night's shows has no way to them here until the
  first show of the day ends. A "Last night" fold under the log (yesterday's
  frozen day from `live_days`) would close that.

## Files

- Shots are on the Mac in `~/Downloads/highdesert-night/`.
  - `before/` (production): Live, Library and Tonight's log, 390 and 1280,
    both looks.
  - `after/` (the local build): Tonight's log, 390 and 1280, both looks, and
    the player after a replay at 390.
- Worktree `/root/hd-night` (branch `log-replay`, merged) is removed when
  the session ends.
