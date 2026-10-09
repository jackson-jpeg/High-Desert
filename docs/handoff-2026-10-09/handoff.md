# Handoff, 2026-10-09: phone failure chrome, guests to topics, supporters, disk

Branch `session/2026-10-01b`, PR #67 (merged, `638b68b`, deployed
2026-10-09T16:02Z with `heavy -- nice -n 10 ionice -c2 -n7 bash scripts/deploy.sh`).
Folder on the Mac: `~/Downloads/high-desert-2026-10-09-phone/` (this file,
the probe, the screenshots).

The session began on 2026-10-01 and was paused until 2026-10-09; the work
below was finished today.

## 1. A failed show on a phone

From `probe-inset47.png` (2026-10-01). Three faults, three fixes, and an e2e
check for each in `e2e/phone-chrome.spec.ts`. All three failed against
production before the deploy and pass after it (3 passed, mobile project).

| Fault | Cause | Fix |
|---|---|---|
| "Transmission Interrupted" body see-through | `Window variant="dark"` is `glass-heavy`, 72% opaque, relying on a backdrop blur | `Dialog` passes `opaque`; the body is solid `bg-raised-surface`. Windows in the page keep the glass |
| Dialog and the red "Audio source not supported or unavailable" banner at once | WebKit fires one more `error` on the element after the watchdog has given up; `media-events.ts` turned it into the banner | Once `loadState` is `"failed"` the dialog is the one message: the late error is ignored and `AudioPlayer` draws no banner |
| Desktop status bar drawn under the tab bar | The bar had `hidden md:flex` all along, but `win98.css` is unlayered, so `.w98-statusbar-dark {display:flex}` beat the layered `hidden` | Hidden from its wrapper: `<footer className="hidden md:block">` in `DesktopShell` |

**Correction to what I said on 2026-10-01.** I said the status bar had lost
its classes in the 2026-09-21 refactor. It had not: the classes were there
and did nothing. Lint caught my duplicate `className` today.

**The WebKit MP3 question: no, that was not the cause.** Playwright's WebKit
on Linux plays these MP3s. With archive.org's audio fetched from the site's
own `/mirror/` instead, the element's time ran 603 s → 608 s unpaused, and
again after the deploy (1105 s → 1114 s). The "Audio source not supported"
in `probe-inset47.png` was my probe aborting the audio, not the engine. The
probe now plays real audio by default (`probe-phone.cjs`, in this folder);
`--fail` refuses the mirror too, to show the failure state.

Screenshots (WebKit, iPhone 13 profile, production, every write answered in
the page, service worker blocked):

- `before-2-live-playing.png`, `before-3-failed-start.png`: the old build;
  the see-through dialog, the banner beside it, and the status bar under the
  tabs.
- `after-2-live-playing.png`, `after-3-failed-start.png`,
  `after-4-library-bottom.png`: the new build.

One loose end: in one of three post-deploy `--fail` runs, the screenshot
taken 3 s after the dialog appeared had no dialog in it. A 45 s trace in
WebKit and Chromium (dialog up from 0.4 s to the end, in both) and two more
runs (dialog present, no banner) did not reproduce it. Not explained.

## 2. Disk

- `npm cache clean --force`: `/root/.npm` 6.6 GB → 969 MB (now 1.3 GB).
- `/root/hd-live-qa`: a clean worktree at `5d55544`, already in
  `origin/main`. Removed with `git worktree remove`; branch
  `longlived/handoff` deleted.
- **Warm rerun, 2026-10-01: target reached**: 330 of 330 pinned, 45 fetched,
  12.5 GB free.
- **Today it has slipped back**: the 04:10 run stopped at the floor, 316 of
  the top 329 pinned (14.6 of 15.0 GB), 9.7 GB free against a 10 GB floor.
  I did not find what used the 2.8 GB: nothing large was written outside the
  pins since 10-01, `/root/test-records` has not grown since then, and
  `/tmp` took 0.1 GB since the 10-04 sweep. Worth a `du` baseline next
  session.
- `tmp-sweep` (vps-tools `8919db7`, Sundays 16:20 UTC) ran on 10-04: 1.9 GB
  freed, 3 kept as held open, 0 errors. That run removed this session's own
  scratch directory (idle since 10-01), with the first probe in it. That is
  the rule working, but anything a paused session must keep belongs in the
  repo or its handoff folder.

### /root/test-records (9.3 GB). Nothing deleted.

`/root/test-records/sogojet-redesign/`: SoGoJet redesign simulator UI test
results (`.xcresult` bundles, logs, attachments), in about 125 run groups
(`save-clean2`, `v2-ui`, `save-suite`, `heart-repro`, `v3-ui`,
`affiliate-tear`, …). Files from 2026-09-30 05:07 to 2026-10-01 17:40, none
since. Written by `ios test` runs from the tmux session
`claude-sogojet-affiliate-1` (`/root/sogojet-affiliate`), which is still
attached. Whether they are still needed is that session's call.

### /root/restore (1.9 GB). Nothing deleted.

Made on the Mac on 2026-07-13 (files uid 501 `staff`, 21:28 to 21:34; the
directory 23:32). A snapshot of this box from before the retirements:

- `crontab-root.txt`: the old root crontab (the OpenClaw docker restart,
  sanger-cron, sanger-morning-digest);
- `augie.Modelfile`;
- `no-remote-repos.tar.gz` (36 MB): repos with no remote (ScreenReceipts,
  dork, …);
- `system-config.tar.gz` (7 MB): `etc/letsencrypt`, `etc/nginx`,
  `etc/systemd`, `var/www`;
- `root-home.tar.gz` (1.8 GB, 69,118 entries): /root, **including
  `.git-credentials`, `.ssh`, `.appstoreconnect`, OpenClaw secrets,
  `.sanger-monitor.env` and `.claude`.**

**Security finding, not changed:** `/root` and `/root/restore` are `755`
and the archives `644`, so any local account can read those credentials.
That includes `hdlive`, which runs the public chat service, and the other
service users. Recommended: `chmod 700 /root/restore` (or `/root`), then
decide whether the archive is still needed. Left as found, because the
brief said to delete nothing there.

## 3. Ten guest fields moved to the topic

As chosen ("Into `topic`"). `scripts/move-guest-topics.mjs --write`, from
`MOVED_TO_TOPIC` in `src/lib/library/guest.ts`:

- the guest, less its hour note, became `topic`;
- the old topic, lowercased, joined `aiTags` unless it was there already
  (2 of 10 were);
- `guestName` was removed.

Every move is logged in `docs/catalog-guests.md`, "Moved to the topic".
`SEED_VERSION` is `2026-10-09-a`. Older libraries keep their rows, since
reconcile only adds; `shownGuest()` hides the old guest there by exact
`fileHash` and value. Mutation `guest-moved-to-topic`.

## 4. Supporters on /stats (asked mid-session)

A Supporters panel after Signal Traffic: "High Desert has no ads. Thank you
to the listeners who chipped in to keep it on the air.", then **Rachel B.
$10** and **Craig A. $5**, and "Chip in on Venmo: @sanger"
(`https://venmo.com/u/sanger`, new tab). The data is
`src/lib/support/supporters.ts`; add a gift at the top. Only first names
and initials are in the repo, and a test fails on a full name, or on either
surname anywhere in `src/`. Mutation `supporters-listed`. Screenshot:
`after-5-stats-supporters.png`.

## Checks

- Suite: 1,699 tests passed locally. 10 files under `services/live/test` and
  `scripts/__tests__/e2e-tokens.test.ts` cannot load here, because the
  production tree has no `services/live/node_modules`. They fail the same
  way on `main`. CI ran everything: checks, browser and Mutations all green.
- Lint and typecheck clean. All new mutations red.
- `seed-version-follows-catalog` was anchored on the version string and went
  stale at the bump; it is now anchored on the prefix, so a bump can't stale
  it again.
- Production after the deploy: `check:csp` clean on 7 routes,
  `e2e/phone-chrome.spec.ts` 3 passed.

## highdesert-status after the deploy: what needs Jackson

- **FAIL `audit`: 3 high, all new since the exceptions doc was written, all
  with fixes.** `next` (GHSA-3w37-wq28-93x7, -4jqv-mc3x-m676,
  -39w2-rjm5-chcv, -f87g-xv8r-7p7x, -mcj8-r9mp-w47p, -cjq9-62q9-8jv4),
  `sharp` (GHSA-wq5f-xc86-pv6w), `source-map-js` (GHSA-68fv-2mgg-jv7q). Not
  done here: it is a dependency upgrade (worktree, its own PR), and this
  session's one PR was already merged. Proposed as the next session's first
  job.
- **WARN `release`: 4.3% of starts lost** (57 of 1,329 plays, target under 3%),
  up from 1.9% on 321 plays at the 2026-10-01 verdict. 61 more were rescued.
- WARN `failures` (10.7% of starts over 7 days, rescued ones included) and
  WARN `warm` (above).
- WARN `digest` and the backup's Mac copy: the Mac was unreachable over
  Tailscale today.
- `mutations` OK: the nightly full run on `32f7a88`, every mutation red.

## Hook blocks this session

1. Pipefail hook (2026-10-09): a `git log | … | tail` check with no
   `set -o pipefail`. Re-run with it. Mine.

From 2026-10-01 (in that handoff): five pipefail blocks, all mine, each
re-run with `set -o pipefail`.
