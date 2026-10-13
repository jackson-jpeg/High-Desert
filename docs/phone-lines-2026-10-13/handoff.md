# Handoff: Phone Lines easy to read, plus four follow-ups (2026-10-13)

Branch `ui/phone-lines-readable`, from `main` 7712a6b. PR #76, merged as 844b8fc.
Deployed at 02:52 UTC: the app with `deploy.sh` (client-verified), and the
chat service with `deploy-live.sh`, because the name generator changed.
That deploy verified health, an SSE hello through nginx and a POST round
trip.

At a glance:

1. **Phone Lines** are easy to read in both looks, on every surface that shows
   calls. Merged and deployed.
2. **`heavy`** now has one slot, runs its command niced, and waits at the CPU
   gate. Playwright goes through it with one worker. The rule is in
   `/root/CLAUDE.md`.
3. **The ScreenReceipts MCP Chrome** is stopped.
4. **"0 episodes"** was real on production, in both looks, for the first
   seconds of a first visit. I wrote a failing test first, then fixed it.
5. **The warm job and the failures line:** both lines are below, as of
   02:53 UTC. The warm job's next run is 04:10 UTC, after this session ends,
   so tomorrow morning's check is left for the next session.

## 1. Phone Lines

These changes cover every surface that shows calls:

- Win98's Notepad (`NotepadPhoneLines`).
- Night's chat (`LiveChat`): the sheet on a phone, the window on a desktop.
- The phone's preview of the latest three calls on `/live`.
- Both `/live` and the Phone Lines tab (`/live?lines=1`).

Mel's Hole shows no calls, so it is untouched.

- **Each call is its own block**, with a little space between calls.
  - The first line is the name in bold, then ", calling from Asuncion" and the
    line in a quieter gray, then the time, dimmer.
  - The message sits on its own line below, in normal weight.
  - The first line wraps rather than cutting off, so a long name never runs
    into a place.
  - Win98 keeps Notepad's monospace on a white page. Its time uses a new
    third-tier ink, `--hd-w98-ink-dim` (6.7:1 on white).
- **Names and places no longer collide.**
  - Generated names carry no place (`services/live/lib/names.mjs`): "Sleepless
    Night Owl", "Prospector", "West of the Rockies caller". There are about 600
    plain names, and the numbered fallback still covers a full night.
  - A place reads "Night Owl, calling from Asuncion".
  - Stored names such as "Night Owl in Pahrump" keep working and are never
    renamed.
- **System notices are one small gray line.**
  - A run of tune-ins folds into one, such as "3 new listeners tuned in"
    (`src/lib/live/chat-rows.ts`).
  - A call in between keeps them apart.
- **Archive moments** are indented and framed under "From the archive", with
  "find the show" inside the same block.
- **Your own calls are lightly tinted**, in the preview too.
- **Scrolled up, new calls no longer pull you down** (`src/hooks/useFollowLog.ts`).
  - A **New calls below ↓** button appears instead.
  - At the bottom, the list follows new calls as before.
  - A tune-in never raises the button.
  - Your own call takes you down to it.

**Screenshots:** 24 in `screens/`, named `<project>-<look>-<surface>.png`. The
projects are desktop, mobile and iphone (WebKit).

- `live` is `/live`; on a phone `sheet` is its preview tapped open.
- `lines` is `/live?lines=1`.
- `-new-calls` is scrolled up, with the button showing.

The iPhone shots read "Reconnecting..." at the bottom. That comes from the
test's stub, not the app: under WebKit the stub sends the stream whole and
then ends it. The Chromium projects keep the stream open and read "On the air".

Desktop Night still draws the chat in its existing window, with the new blocks
built from existing colour tokens and no new Night CSS.

## 2. `heavy`: one slot, niced, and the CPU gate (vps-tools 990c079, pushed)

This is the change you approved:

- `HEAVY_SLOTS` defaults to **1**: one heavy job on the box at a time.
- The command runs under **`nice -n 15 ionice -c2 -n7`** (`HEAVY_NICE` changes
  the nice value).
- **The CPU gate.** Before taking the slot, `heavy` waits while our own CPU
  (user + nice + system, from sysstat's 10-minute samples) has averaged over
  **40% for 6 hours**, re-checking every minute.
  - That is the same reading and the same line as `vps-cpu-alert`'s 6-hour
    page.
  - No data leaves the gate open.
  - Nested calls are not gated twice.
  - `heavy status` shows the gate's reading.
  - `HEAVY_IGNORE_GATE=1` skips the gate, for a production fix during an
    incident only. `/root/CLAUDE.md` says that, and says a gate that holds you
    is not a block to route around.
- **Tests:** `tests/heavy.test.sh`, 37 checks, all passing. I broke the code
  six ways (default slots, nice, ionice, the mean, the fields read, the gate),
  and every break turned a test red.
- **Installed:** `/usr/local/bin/heavy` is the repo symlink, and the Actions
  runner's copy in `/usr/local/lib/vps-tools/` is updated. SoGoJet's CI jobs
  now hold the one slot for their whole run.
- **Playwright** (High Desert, in this PR):
  - `npm run test:e2e` goes through `scripts/heavy.sh`;
  - `playwright.config.ts` runs 1 worker off CI;
  - `heavy-sh.test.ts` holds both.
- **The rule:** `/root/CLAUDE.md`'s `heavy` section is rewritten, and High
  Desert's CLAUDE.md line matches it.

At 02:05 UTC the gate read 39.4%, just under the line. The `heavy` jobs in
this session pushed the 6-hour mean close to 40%, so the next session may
find the gate shut for a while. That is the gate working.

## 3. The ScreenReceipts MCP Chrome

I stopped the pids you named, after checking they were what you described:

- 34757: the browser, which had run 28 hours.
- 34789 and 34845: its GPU and renderer processes.
- 2375737: its `playwright-mcp` server, which had run 2 days.

All four are gone. That ScreenReceipts session's Playwright tool will fail
until the session restarts its MCP server.

## 4. "0 episodes" in the status bar

**On production, yes, and now fixed there.** A headless probe ran in each look on `/live` and
`/library`, with an empty profile and the visit kept out of the stats. All
four read **"0 episodes" at 3 s** and 1,413 by 8 s. So it was not
Night-specific: the Night desktop screenshot happened to be taken during that
window.

After the deploy, the same probe at 1.5, 3 and 8 s never shows "0 episodes"
in either look: blank or "Loading library" first, then 1,413.

**Cause:** the layout passed `useLiveQuery(count) ?? 0`. That count answers 0
before the seed's first write.

**Fix:**

- `knownEpisodeCount()` and `episodeCountLabel()` in
  `src/lib/library/episode-count.ts` return unknown until the seed has
  settled.
- The status bar says **"Loading library"** while the count is unknown.
- A library you cleared yourself still reads "0 episodes" once the seed has
  settled.

**Tests, written red first:**

- `episode-count.test.ts`.
- A status bar block in `shell-render-pressure.test.tsx`, with a control.
- Mutations `episode-count-unknown-while-seeding` and
  `status-bar-episode-count-label`.

## 5. The warm job and the failures line

After the deploy, at 02:53 UTC (`highdesert-status`, before the 04:10 warm run):

- `warm` was WARN: 289 of the top 328 pinned (14.5 of 15.0 GB), last run
  2026-10-12 04:18, stopped at the disk floor before the cleanup freed room.
- `failures` was WARN at 5.3% of starts lost in 7 days: 57 lost of 1,082
  plays, against a 3% target; 168 starts were rescued by the retry or the
  mirror.
- `steal` was WARN at 45.4% (it was FAIL at 52.7% at 02:05). The warm job skips itself while steal is above
  20%, so a skipped run would be the cap, not the disk.

**For the next session (tomorrow morning):**

- Run `highdesert-status`.
- Report the `warm` line (did a run reach 328?) and the `failures` line. The
  failures line is the first full week to include the five failover fixes
  deployed 2026-10-12.

## Checks (on the VPS, through `heavy`, niced)

- `tsc --noEmit` and ESLint: clean.
- **Full Vitest suite, with the test database:** 2,731 of 2,732 tests passed,
  run with a 30 s timeout because of the CPU cap. The one failure was
  `names-retention.db.test.mjs`. It still expected the old "in Place" names,
  and it needs the database, so the agent's run of the affected files had
  skipped it. Now fixed: it checks the name is built from the generator's own
  words and has no place. It passes.
- **Mutations:** all 122 this branch touches (new, re-anchored, or with a changed target or test) went red. The full list is 1,022; the nightly run checks all of them.
- **e2e `e2e/phone-lines-busy.spec.ts`:** 12 of 12 passed against a local
  build on the e2e database (desktop, mobile, iphone; both looks; `/live` and
  `/live?lines=1`). It checks:
  - each call is a block, with its first line above its message;
  - the folded "3 new listeners tuned in" stays on one line;
  - the archive moment is framed, indented and labelled, with its link;
  - exactly one call is tinted as yours;
  - "New calls below" appears when scrolled up, and the list follows at the
    bottom;
  - a long message wraps.

## Blocks and refusals this session

- **The pipefail hook blocked 6 of my commands**, each a pipe without
  `set -o pipefail`. I re-ran each with the prefix.
- **The agent hit four blocks:**
  - The npm-in-prod hook blocked one `npm ci` written as `…; cd services/live
    && npm ci`: after the `;`, the hook resolved the `cd` against the live
    tree. The agent re-ran it as two commands, each with an absolute
    `cd … &&`.
  - The pipefail hook blocked three of its commands. It re-ran each with the
    prefix.
- **My mutation runs:**
  - The first one I started selected all 1,022 mutations, because
    `package.json` changed. I stopped it, checked the tree was clean and
    nothing was left running, and ran this branch's 122 instead.
  - A one-off script that listed the mutations ran the old copy of
    `mutate-check.mjs` as a program by mistake. It refused at its own
    clean-tree check, outside any repository, before it changed anything.

## Left for you

- **The Hostinger ticket** (from the 2026-10-12 handoff) is still unsent, as
  far as I know. Steal is still above 50%.
- **The `heavy` proposal is done.** Of the rest of the 2026-10-12 list, these
  remain:
  - the worktrees with work in them;
  - `/root/restore`;
  - a retention rule for SoGoJet's `.xcresult` test records.
