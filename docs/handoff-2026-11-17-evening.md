# Handoff, 2026-11-17 evening (UTC): the ship, the phone look split, the sang3r export

Read `docs/NEXT.md` (`## Queue`) with this. Times are UTC.

## Live

- **`3dab517`, deployed 21:55** with `deploy.sh`: client check and the
  returning visitor (Chromium and WebKit) passed, nothing rolled back.
  `highdesert-status` exits 0, `deploy` reads live = HEAD (the 08:29 drift
  item on the hub closes with it). One WARN, `mutations` (weekly run skipped
  this week, Jackson).
- It ships the four listener items (show-page plays, forgiving search,
  `/shows` and `/shows/<year>`, "Resume at ... of ..."), plus:
  - **The default share card is cached a week** (`8bda37d`). check:seo on the
    build caught it: `/`, `/library`, `/live`, `/shows` share the root card,
    drawn per request at the edge with `max-age=0`.
  - **The phone look split** (`src/lib/look/split.ts`, `docs/funnel.md`).
    Assigns from 2026-11-18 00:00 to 2026-12-02 00:00, then stops by itself.
    Checked on the built app in Chromium at 390 px with the clock moved into
    the window: 12 new phones split 7 Win98 / 5 Night, each with its cookie,
    arm and suppressed offer, none left hidden; revisits keep their look;
    desktop, Googlebot and days outside the window untouched.
- check:seo (49 pages, 896 links, 94 cards) and check:csp (8 routes) pass on
  production. Station notice posted (22:00).
- The envelope timer was already active when the ship landed (NEXT.md item
  ticked; nothing started by me).

## Checks, and what they found

- Full suite on the ship: 3,268 of 3,269 (one `status.test.ts` timeout,
  passed alone). On the final tree (ship + split): 14 failures, all 5 s
  timeouts on a full box or `services/live` not installed in that worktree;
  every failed file passed on rerun (`backup-db.test.ts` needed
  `--testTimeout=30000` under load; it is not touched here).
- **A surviving mutation, fixed:** `library-search-fuzzy-every-word` stayed
  green after `bfc0bee` loosened the misspelling test. New test on a fixed
  three-row list (`703e8d2`); red now. All 26 other mutations of the ship and
  the split went red.
- **Not fixed, queued:** a Tonight page that is first to freeze a day 500s
  (a `no-store` fetch inside an ISR render). Local only so far; NEXT.md.
- check:csp on a bare local `next start` shows 404s for `/live-api/*` and
  `/mirror/*` (nginx and the chat service serve those). Expected locally;
  production is clean.

## The sang3r.com export: live (`a2e049a`)

- `mode=daily` days carry `visitors` (new `visitor_daily`, bumped in
  `recordVisit`'s transaction) and `views` (`route_daily`), null up to each
  counter's first partial day, never 0. `visitors` has its first number on
  2026-11-18.
- `mode=detail&days=7|30|90`: `{days, topPages, referrers, countries,
  devices, keyNumbers: {showsPlayed, distinctShows, liveTuneInRate,
  returningListeners, playsBySurface}}`, top 10 each. Checked on loopback
  with the token (both modes answer; 401 without it).
- Not the audience (`src/lib/utils/not-audience.ts`), on view, funnel,
  heartbeat and visitor, write time only: agent UAs, `X-Sanger-Internal`,
  `sanger_me=1`, the box's own addresses. Plays are not filtered.
- Checks: typecheck, lint, the full suite (341 files, 3,294 passed), nine new
  mutations all red. sanger-75 told the URL and shape.

## Mac hold (Jackson, ~22:50, macOS update)

No ssh to the Mac until he releases it. This handoff's copy to
`~/Downloads` waits for the release (it was copied once at 22:2x, before
this revision). The `ssh macbook-tunnel` processes on the box are other
sessions' MCP servers, not mine; I left them.

## Blocks and incidents this session

- **heavy, stale waiters (box-wide).** Six normal-lane waiters started before
  the 19:09 gate change (`95f3a63`) kept looping on the old 40% gate (our CPU
  was 44.7%) and so blocked every low-lane job on the box, mine and the
  envelope batch included, for about 45 minutes. Diagnosis sent to sanger-75;
  they cleared by about 20:00. Suggested fix: re-read the gate per iteration.
- **Permission refusal:** a `kill` of my own interrupted mutation loop (the
  auto-mode classifier). Not retried; the loop had already exited and
  `mutate-check` restored its files (tree clean).
- **npm hook:** `(cd services/live && npm ci)` inside a subshell after
  `cd /root/hd-export` was blocked as if in `/root/High-Desert/services/live`.
  A false positive (the hook does not follow an outer `cd` into a subshell's
  relative `cd`). Re-issued as `cd /root/hd-export/services/live && npm ci`,
  the form the message names. Possible fix for
  `/root/vps-tools/hooks/block-npm-in-prod.py`: track the cwd into `( )`.
- My own mistake: an exploratory `node -e 'import("scripts/mutate-check.mjs")'`
  would have started a mutation run; it failed to load and changed nothing.

## Worktrees

- `/root/hd-export`: merged and pushed; removed at the end of the session.
- `/root/hd-fuzzy`, `/root/hd-split`, `/root/hd-showplays`: merged and pushed;
  removed at the end of the session.
- `/root/hd-audio` (Clean up, kept).

## Other

- `docs/STUDIO-RECORD.json` written for sang3r's Studio Map (path sent to
  sanger-75).
