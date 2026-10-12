# Hotfix, 2026-10-12: scrolling the Library opened Mel's Hole on phones

Branch `fix/phone-scroll-egg`, merged to `main` with `[skip ci]` and deployed.
Every check ran here on the VPS; no GitHub Actions ran.

## What it was

The Library page (`src/app/[look]/(desktop)/library/page.tsx`) had a hidden
easter egg: **Mel's Hole opened on the twelfth `scroll` event "at the bottom"**
of the first element matching `[class*="overflow-auto"][class*="overscroll-contain"]`.

On a phone that element is the Library's outer page box, not the list. It has
little or no overflow, so it is "at the bottom" almost all the time, and an
iPhone's momentum and rubber-band bounce fire dozens of `scroll` events in
one ordinary flick. Twelve came within a scroll or two, and the black circle
("9 miles west of Ellensburg") kept opening over the list.

**Fix:** the scroll trigger is gone. Eggs open only from deliberate acts:

- Mel's Hole in Win98: Start > Run..., `melshole`, or "hole" typed on a keyboard
  with nothing focused (unchanged).
- Mel's Hole in Night: "hole" typed on a keyboard (new, `useTypedWord`). Night
  had no way in except the bug.
- The others: words typed into the search box (area51, titor, w6obb...),
  Ctrl+Shift+A, the Konami code, and a triple click on the title.

`src/lib/__tests__/eggs-deliberate.test.ts` lists every place in `src/` that
opens an egg, and fails on a new one, or one within a dozen lines of a scroll,
touch, wheel or pointer handler. Against the old page it fails 3 of its 4 tests.

## Reproduced first, as a failing WebKit test

`e2e/scroll-gestures.spec.ts` scrolls each main screen on a 390x844 phone,
in both looks, from top to bottom and past the end, then back up and past the
top. It fails if anything opens: a dialog, a menu, an overlay over the
screen, a new toast, or a change of address.

- **WebKit** (new `iphone` project, `E2E_WEBKIT=1`, `devices["iPhone 13"]`).
  Playwright has no touch drag for WebKit, so `e2e/touch.ts` dispatches touch
  events along the finger's path and scrolls the element under it. WebKit on
  Linux has no rubber band, so **the iOS bounce is modelled**: each push at an
  end fires `scroll` on the scroller and on the scrollable boxes around it, as
  an iPhone does. Against production, both looks failed with the egg on
  screen:
  `+ "div \"9 miles west of Ellensburg9 feet across. 80,000 feet of fish\""`.
  Against the fix, they pass.
- **Chromium** (the `mobile` project). Uses Chromium's own touch scrolling
  (`Input.synthesizeScrollGesture`, touch source, with fling). Against
  production it found a second bug before reaching the egg: **the row's
  long-press menu (Play / Play Next / Add to Queue / Favorite) opened
  mid-scroll.**

Neither is an iPhone. Check on a real one: scroll the Library hard to the
bottom and back in both looks, then flick past each end a few times.

## The gesture audit (both looks)

| Trigger | Before | Now |
|---|---|---|
| Library scroll at the bottom | opened Mel's Hole | removed |
| Row long press (500 ms) | opened the row menu mid-scroll: once the browser scrolls natively it stops sending the touchmoves the press watched | cancelled by any scroll on the page and by `touchcancel` (`useLongPress`) |
| Row swipe (queue / favourite) | a vertical scroll whose finger drifted sideways could become a swipe | decided once per touch on its first 10 px: twice as far across as down is a swipe, else a scroll for the rest of the touch; a scroll or `touchcancel` before then never acts |
| Dial strip | `touch-action: none` and every drag tuned, so a vertical swipe over it tuned the dial and blocked the page scroll | `pan-y`, axis-locked like the rows |
| Win98 "hole" | key presses with nothing focused | the same, plus held-key repeats and IME composition ignored |
| Konami code, Ctrl+Shift+A, search words, title triple click | keyboard / typed / deliberate taps | unchanged |
| Pull to refresh, swipe navigation | none in the app (the browser's own only) | n/a |
| Sheets' swipe down | closes a sheet, opens nothing | unchanged |

## The Library on a phone (both looks)

From the top:
1. **Continue listening**: one row (`dense`), the latest show, ▶ and Resume
   at, with ✕.
2. **Install offer**: one slim line ("Install: tap Share, then Add to Home
   Screen." on iPhone), ✕ for Not now. The same on the Live screen.
3. **Search**.
4. **Show tabs**, with List / Dial beside them (they had a row of their own).
5. **Category chips**: no scrollbar under them on a phone.
6. **The list**, with a slimmer "Newest first" bar.
7. **Under the list**: the one-time swipe tip, and **Explore** (Recently
   played, On this date), collapsed.

Win98 no longer scrolls the whole page sideways: the chips' negative margin
overflowed it, and a horizontal scrollbar sat above the taskbar.

`e2e/library-phone.spec.ts` checks the first screen at 390x844 for a first
visit and for a returning listener (Continue listening, the install line and
the swipe tip all showing). It requires 3 whole, uncovered Win98 rows or 2
whole Night cards (Night's cards are about 118 px), and checks the order.
The returning Win98 screen now shows 6 rows; it had 1 to 2 before this
change, with the first at 522 px.

Screenshots (Mac folder `screens/`):
- `before-iphone-{win98,night}-first-visit.png`: production before the fix.
- `{iphone,mobile}-{win98,night}-{first-visit,returning}.png`: after
  (`iphone` is WebKit, `mobile` is Chromium).

## Checks run here

- `tsc`, `eslint`: clean.
- vitest: 281 files, 2,641 tests passed (before the last spec-only edits).
- Mutations, the PR scope (`--changed-from origin/main`): all 51 went red.
  That covers the 8 new ones (`long-press-cancelled-by-scroll`,
  `long-press-cancelled-by-touchcancel`, `row-swipe-axis-locked`,
  `row-swipe-scroll-blocks`, `dial-strip-vertical-no-tune`,
  `typed-word-ignores-repeat`, `typed-word-field-owns-keys`,
  `continue-listening-dense-row`) plus every older one on a changed file. Two
  older anchors were re-pointed (`continue-card-resumes`,
  `library-continue-on-top`). All 976 anchors check clean.
- e2e, the full suite against a local build of the branch on the e2e
  database (app, chat service and one-origin proxy, as CI composes them), with
  the `iphone` project on: 199 passed and 9 failed on the first run.
  - Five meters failures were the disk filling up (below).
  - Two were Night's first-screen threshold, set to 2 cards.
  - funnel and live failed once each.

  Every one of the nine passed on re-run (28 passed). Two further re-runs
  fixed timing in the new spec: a 600 s budget for WebKit, and dropping `/`,
  which a phone never stays on.
- Merged as PR #74 (`5aa619f`), deployed with `scripts/deploy.sh`: built,
  swapped, and the client check passed on `/`, `/library`, `/live` and
  `/stats`.
- `highdesert-status` after the deploy: deploy, service, release (1.7% of
  starts lost) and presence all OK. There were 3 WARNs, none from this change:
  - hypervisor steal at 45% over 30 min;
  - the 7-day failure share at 21.4%;
  - mirror pins below target (the warm job stopped at its disk floor).
- **Production, after the deploy:** the scroll and first-screen specs ran
  against https://highdesert.space in WebKit (`iphone`) and Chromium
  (`mobile`), both looks: **16 passed**. The same scroll test that showed the
  egg before the fix now passes on production.

## Incidents

- **The VPS disk filled up during the full e2e run** (ENOSPC writing failure
  traces). Production and Postgres stayed up. Free space was about 1.7 GB
  afterwards. Most of the disk belongs to other projects' temp folders and
  worktrees, which I did not touch. I removed my own test results, re-ran
  with traces off, and removed my worktree after the deploy. **The disk is
  the thing to look at next.**
- **Hook blocks: 4**, all the pipefail hook, on commands with a pipe and no
  `set -o pipefail` (the fourth an `ls | head` after the deploy). Each was
  re-run with the prefix. Nothing was routed around.

## Left

- A real iPhone pass (above). The WebKit bounce is a model, not iOS.
- Night has no Start menu, so Mel's Hole there needs a keyboard. That
  matches the brief; an iPhone in Night cannot reach it.
- The free disk space.
