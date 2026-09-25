# High Desert — handoff, 2026-09-25

Two mandates, both closed out: **"Close out the audit and make outages graceful"**
and **"Live Broadcast"**, plus the urgent mirror-CPU interrupt in between. All of
it is merged, deployed, pushed and measured on production. `highdesert-status`
is all OK apart from one WARN that needs you (below).

## Needs you (one thing, optional)

**`release` WARN (4.2%, target <3%).** Two of the three failures in the release
window, and five plays, are rows the iOS Simulator verification wrote through the
real site before the harness intercepted stats writes. The cleanup SQL is written
and a dump has already been taken. The auto-mode classifier refused to let me run
it, twice, so it is yours to run if you want it:

```
! set -a; . /root/.high-desert.env; set +a; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /tmp/claude-0/-root-High-Desert/71dc9c8a-c03b-4b20-ae21-11dbb4af7bd0/scratchpad/sim-rows-cleanup.sql
```

- It removes plays 2313, 2315, 2316, 2318 and 2321, and failures 521 and 522.
- Restore point: `/root/backups/highdesert/manual-before-sim-cleanup-20260925T164144Z.dump`.
- Without it, the WARN ages out of the 7-day window by itself.

**Admin sign-in for the phone lines** is in your Mac's `~/Downloads`:
`highdesert-live-admin-signin-2026-09-25T21-17-44Z.md`. It works once, until
21:17 UTC tomorrow, and signs that browser in for 30 days. For a fresh link, run
`bash scripts/live-setup.sh --link` on the VPS.

## What shipped

| PR | What | State |
|---|---|---|
| #22 | P3 sweep | deployed |
| #23 | Mirror hotfix: stop seeding and DHT (CPU 46.8% → 1.5%) | deployed |
| #24 | HD-018 player split, HD-016 `progress` table, iOS early-`ended` failover | deployed |
| #25 | Mirror is nginx only: torrent client removed | deployed |
| #26 | **Live Broadcast**: the station and the phone lines | deployed (1455126) |
| #27 | `live-setup.sh` psql fix (below) | CI running; already run on production from the branch |

### Mirror (the interrupt)

- `highdesert-mirror` (webtorrent) is gone: the unit, the user's process, and the ufw ports 6881/6882.
- nginx now serves the 339 pinned episodes from disk with native byte ranges, and fills everything else in the catalog from archive.org through its slice cache (20 GB, 10 GB free floor).
- `/mirror/manifest` and the magnets are static files.
- The warm job is a plain HTTP fetch, verified against the piece hashes, at Nice 19 in the idle IO class.
- How to bring the torrent client back: `docs/torrent-mirror-feasibility.md`.
- Chaos e2e on production, archive.org blocked in the browser:
  - pinned show: 492 ms to first audio
  - unpinned show (filled through nginx): 606 ms
  - once archive.org is known down: 535 ms, straight to the mirror
  - outage mode refuses an unpinned start in 4 ms and plays a suggestion 824 ms after the tap
- New standing rule in `/root/CLAUDE.md`: no High Desert background job sustains more than 10% of a core. `hd-cpu-sample.timer` samples each unit every minute, and the `cpu` status line FAILs over 10% across 15 minutes. Right now the highest unit is at 0.6%.

### Live Broadcast

- **Station** (`/live`, plus an ON AIR lamp on the radio dial):
  - The day runs midnight to midnight Pacific.
  - It plays on-this-date episodes oldest first, then fan favourites by community plays, skipping anything aired in the last 14 days.
  - The program is deterministic from the date and frozen in `live_days`.
  - During an outage, unpinned slots are swapped for pinned ones.
  - An 8 s radio-static station ID plays between shows.
  - Late joiners land mid-show.
  - Drift is held within 2 s, with a resync on tab return and after stalls, and a play counts as one listen per airing.
- **Phone lines** (`highdesert-live`, 127.0.0.1:3005, behind `/live-api/`):
  - SSE down and POST up, stored in Postgres and deleted after 7 days.
  - No IPs; callers are keyed by an HMAC of the client key.
  - Art Bell–style caller names on numbered lines.
  - Moderation:
    - obscenity handles leetspeak, spacing and lookalikes, plus `data/chat-blocklist.txt`
    - links, emails and phone numbers are rejected
    - 280 characters max, one message per 3 s, duplicates blocked, automatic slow mode
    - 3 reports hide the message and mute the sender for 10 min
  - Admin powers use a server-checked token.
  - Full account: `docs/live-chat.md`.

## Measured on production

- **Chat e2e** (two real browsers): delivered in **70 ms** (desktop) and **31 ms** (mobile), timed from the Send press to the line on the other screen. A blocked threat and a link were refused and never delivered. The test lines were hidden afterwards.
- **Station e2e:** two listeners, one joining late, held **within 2 s** of each other on both projects.
- **Load test** (200 SSE callers): 119,400 of 119,400 deliveries, p50 11.5 ms, p95 91.6 ms, p99 287 ms. `highdesert-live` used **3.0% and 3.25% of one core** in the two full minutes of the run, against the 10% rule.
- **Tests:** 1,573 unit tests pass. All 129 live and mirror mutations go red, plus the new ones. CI was green on #25 and #26.

## Things that went wrong, and what changed

- **A merge silently swallowed a mutation.** A union merge left one entry without its `},`, so its keys fused into the next and `ended-early-element-guard` stopped being checked. Nothing noticed. `scripts/__tests__/mutation-list.test.ts` now holds the source to the runtime list. It then caught three duplicated live-status mutations in the Live merge.
- **`live-setup.sh` failed on its first production run.** psql does not interpolate `:'var'` inside `-c`, so the role creation and the sign-in nonce insert were both syntax errors. They now go through psql's stdin. A new test runs `--link` for real against the test database (it fails against the old script) and has a mutation (PR #27).
- **I ran the load test against production by accident.** I passed `--help`, which `load.mjs` does not understand, and it did a full run without `--cleanup`: 597 `load N word xxxxxx` lines from 200 simulated callers between 21:13:49 and 21:15:48 UTC.
  - They were deleted in one transaction within minutes, with the names those callers had claimed. Nothing else was in the window.
  - The run tripped automatic slow mode, which cleared itself two minutes later.
  - It was the mandated test in every respect but cleanup, so its numbers above are real, and I did not re-run it and put another 600 lines in front of listeners.
- **CI didn't originally check `/live` as production serves it.** The CSP check ran the app without the chat service, so `/live-api/*` got Next's 404s. CI now runs the one-origin stack (app, `highdesert-live` and `scripts/live-e2e-stack.mjs`), so the chat e2e runs in CI too.
- **The chat e2e's first delivery timer started before Playwright typed the message**, which read 2.4 s on a busy CI runner. It now times from the Send press, in the page. The 2 s limit is unchanged.

## Loose ends (none blocking)

- **`live-setup.sh --link`** reported the Mac unreachable while its `scp` had in fact delivered the file (checksums verified). The exit code of `scp` to the Mac is intermittent (0, then 1 with no message on a repeat). Worth a look if it recurs. Nothing depends on it.
- **The `mirror` status line shows the fill cache as 0.0 GB.** Fills so far are a handful of 1 MiB slices, so this is expected, not broken.
- **`highdesert-live` runs `CPUQuota=25%`, not ≤10%.** The rule's quota applies to heavy background jobs, and this is a request-serving service measured at 3% under 200 callers. The unit's comment explains why: a quota at 10% would hide an overrun as throttling instead of letting the `cpu` and `live` lines report it.
