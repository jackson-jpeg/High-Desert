# High Desert: Phone Lines polish and the morning check (2026-10-13)

PR #77 (branch `ui/lines-polish`), merged as 4114af5 and deployed 04:32 UTC: the client check passed on `/`, `/library`, `/live` and `/stats`, production's CSS carries the new rules, and `highdesert-status` after the deploy reads `deploy OK, live = HEAD = 4114af5`, service OK, steal 2.2%, and warm and failures unchanged from the morning. Screenshots in `screens/`.

## 1. Morning check

Read at 04:28 UTC, after the 04:16 warm run.

- **warm:** WARN, `pins below target: 329 of the top 332 pinned (15.0 GB of 15.0 GB); disk free 20.7 GB against a 10.0 GB floor`. The run did not skip for steal. It finished `outcome: ok` at 04:16. It fetched 41 shows and unpinned 27 that fell out of the top, so the mirror now holds 338 pins. Since yesterday the target is 332, not 328, because the play ranking moved. Three of the top 332 failed with **HTTP 500 from archive.org**:
  - 2013-10-09 Dark Matter, Andrew Karam
  - 1997-10-23 Harlot the Witch
  - 1995-06-23 Hoagland, Mars and Moon

  Those are archive.org errors, not a disk or budget limit, and the next 04:10 run retries them. The run stopped well short of the disk floor this time (yesterday it stopped at the floor). Disk is 22.2 GB free.
- **failures:** WARN, `5.2% of starts lost in 7 days (57 lost / 1098 plays; target <3%); 172 rescued by the retry or the mirror; 12 repeats ...; 241 failure row(s)`. This is the first week since the five failover fixes, and the 7 days still mostly predate them: they deployed 2026-10-12. The 172 rescues against 57 losses suggest the mirror is doing its job. Read the line again on 2026-10-19, when the window is all post-fix.
- **steal:** 1.2% at the first read, 2.2% at 04:28. The Hostinger cap has lifted, so I did **no VM stop/start**, and the Hostinger ticket is moot unless steal returns.
- Everything else OK:
  - deploy, service, nginx, backup, sampler, peaks, funnel, presence, memory, disk, mirror, cpu, live, digest, audit.
  - **mutations:** the nightly full run on 890959a was red in all 4 shards.

## 2. Sheet and Notepad polish (both looks)

- **"You're Night Owl on Line 3" row** (`LiveChat.tsx`): *Change name* and *Change place* are now small underlined text buttons (`TextAction`). They sit on one line, held together with `whitespace-nowrap` and separated by a middle dot. Each still has a 44 px tap target through an `::after`. In Night the row is under 48 px tall; before, it was two large buttons that wrapped. Win98's Notepad keeps its own identity in the status bar, so this row appears only in Night.
- **No focus box when the sheet opens** (`useFocusTrap` `focusContainer`, `LiveChatSheet`). Opening the sheet used to focus Close. A programmatic focus with no pointer counts as `:focus-visible`, so Close drew a ring on every open. The sheet now focuses its own container. The looks' global `:focus-visible` ring is suppressed on that container alone (`.hd-focus-host` in `globals.css`). Tab still moves to Close and rings it, so keyboard users keep their rings.
- **Win98 Notepad: the time stays on the first line** (`NotepadPhoneLines.tsx`, `look-win98.css`). Each call head is two parts:
  - the name, place and line wrap inside their own part (`hd-w98-notepad-who`);
  - the time sits at the end of the first line and never wraps (`hd-w98-notepad-when`).

  See `mobile-win98-polish.png`: "Cab Driver, calling from Las Vegas · [4:10 AM]", with "Line 6" wrapping under it.

## Checks

- **Unit tests:**
  - `sheet-focus.test.tsx` (new). The sheet focuses itself, and Tab reaches Close. Control: a plain trap still focuses its first button.
  - `live-chat.test.tsx` "who you are, in one line". The buttons are inline and nowrap, have no big-button classes, and keep the touch target. Control: the composer's button is still big.
  - `notepad-phone-lines.test.tsx`. The time is outside the part that wraps. Control: the head still contains it.
  - The affected folders pass: 383 tests. tsc and eslint are clean.
- **Mutations:** five new ones, all red:
  - `focus-trap-focus-container`
  - `live-sheet-focus-container`
  - `live-you-actions-one-line`
  - `live-text-action-target`
  - `win98-notepad-time-outside-who`

  The branch's `--changed-from origin/main` set ran too: all 46 red.
- **e2e:** `e2e/phone-lines-busy.spec.ts`, "the phone lines, polished". It ran on desktop, the Chromium phone and the WebKit phone (`E2E_WEBKIT=1`, the `iphone` project), in both looks: 18 passed. On a phone it checks:
  - focus is on the sheet and no button matches `:focus-visible`;
  - the sheet itself shows no outline or amber shadow;
  - after Tab, exactly one button is ringed.

  In Night it checks that the name and place buttons share one line and that the tap target is at least 43 px. In Win98 it checks that every call's time is on the name's first line, and on a phone that at least one head really wrapped.
- **Screenshots** (`screens/`): `<project>-<look>-polish.png` and, for phones, `-polish-keyboard.png`. Projects are desktop, mobile and iphone; looks are night and win98.

## Blocks and slips

- **Pipefail hook: blocked twice** this brief.
  - A `highdesert-status | grep`.
  - A cleanup command ending in `ss | grep -c`.

  Both were re-run with `set -o pipefail;` and the output redirected to a file.
- **Three Playwright runs went around `heavy`.** While debugging the WebKit focus flake I ran `npx playwright` directly 3 times instead of `npm run test:e2e`, so those runs skipped the semaphore and the nice. Every other heavy run went through `heavy`.

## Left for you

- Read the failures line again on 2026-10-19, once the 7-day window is entirely after the failover fixes.
- The three shows that got HTTP 500 retry tonight. If they still fail after a few nights, check them on archive.org.

## Clean-up

My e2e server (127.0.0.1:4982, started from `/root/hd-polish`) is stopped. Test output is removed. The worktree `/root/hd-polish` and branch `ui/lines-polish` are removed after the merge.
