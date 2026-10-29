# Handoff: the admin console on sang3r.com, and station notices that survive a restart (2026-10-29)

## What Jackson asked

1. "now let's work on adding the admin features for this site to my admin
   site, sang3r.com, that way i can easily monitor/control the chat, etc".
   Scope chosen: the chat, plus the Request Line, the station's health, and
   supporters and shout-outs. Deploy: "Both now".
2. After that deploy, all the earlier "From the station" lines were gone.
   "Yes, build it and ship it": save station notices in the database (same
   retention), a test that restarts the service and finds a notice with its
   original time, confirm "The phone lines are back" survived the deploy,
   leave the lost notices alone, write this handoff, remove both work
   folders.

## Done and live

**The console:** `https://sang3r.com/high-desert/admin`, linked as "Admin
console" from `/high-desert`. Full account in `docs/admin-console.md`.

| Tab | What it does |
|---|---|
| Phone lines | Every call, hidden ones included, with reports. Hide or unhide, mute (10 min, 1 h, 1 day) or unmute, clear a name, ban or unban, slow mode, station notices |
| Request Line | Today's nominations, notes and votes, tonight's pick, Veto |
| Station | On the air and up next, failed starts over 7 days, `highdesert-status` on a button |
| Supporters | The list and total, the last thank-you, when the next is due, Thank them now |

- **High Desert, chat service** (deployed 17:05 UTC, `3599d4f`):
  - new admin reads: `/live-api/admin/overview` and `/live-api/admin/requests` (the second creates no caller cookie);
  - new undos: `unhide`, `unmute` and `unban` (unban also lifts the address hold);
  - `scripts/donor-shoutout.mjs --status`.
- **sang3r.com** (`60ed197`, deployed with `bash scripts/deploy.sh --allow-dirty`):
  - `src/lib/highdesert-admin.ts` and `src/app/api/highdesert/admin/*`, all behind `requireAuth`;
  - `src/components/highdesert-admin/*`.
  - The deploy included the tree's existing untracked printer and AI files. They were already in the live build, unchanged since it was built.
- **Checked in production:**
  - The admin reads refuse a request without the token (401) and create no cookie.
  - Signed out, the four sang3r.com API routes answer 401 and the page answers 404, the same as `/high-desert`.
  - Not checked: the page signed in. Jackson's first look is that test.
- **Tests:**
  - Chat: 316 pass, including `admin-console.db.test.mjs`.
  - sang3r.com: 571 pass, including `highdesert-admin.test.ts`. Typecheck, lint and a production build were clean.
  - Mutations: `live-console-*`, `live-unhide`, `live-unmute`, `live-unban-*`, `live-undo-caller-ref-shape` and `shoutout-status-*` all go red.

## Station notices: saved in the database, deployed

**Why the lines were lost:** station notices lived only in the chat
service's memory, so the 17:05 deploy wiped seven of them, including this
morning's thank-you to the supporters. The log has their ids, not their
words, so they cannot be restored. As asked, nothing was re-posted.

**The fix** is in two commits on top of `3599d4f`: `live: station notices
are saved in the database` and its docs.

- **Storage:** a table, `live_station_notices`. A notice is saved before it is sent, and the service loads the saved notices when it starts.
- **Retention is unchanged:** 12 hours, the newest 3. Older rows are deleted when a new notice is posted.
- **The test** is `services/live/test/station-notices.db.test.mjs`. It covers three things:
  - A notice is posted, the service is closed, and a second one is started on the same database a minute later. The notice comes back with its original id and time, both in a listener's hello and in the console.
  - A service with another scope sees none of them (the control).
  - The 12-hour and newest-3 rules hold after a restart, in the table itself.
- **Mutations:** `live-station-notices-loaded`, `-saved`, `-at`, `-scope` and `-expiry` all go red.
  - A first `-expiry` survived. It loosened the read at startup, which saving already makes redundant. It was replaced by one that breaks the cleanup at save time, and the test now reads the table.

**How it shipped.**

- **First attempt:** the plan was to copy the notice then on air into the new table by hand, so the deploy's own restart would not wipe it. The auto-mode classifier refused that command, and then, after Jackson approved the steps, refused the insert again. Steps that did run before the insert:
  - push and pull (`782b4ca`);
  - a `pg_dump` (`/root/backups/highdesert/pre-notices-20261029T172701Z.dump`);
  - the schema, which created `live_station_notices`.
- **What Jackson chose instead:** skip the insert, deploy, then post the notice again through the normal path.
- **Deployed 18:31 UTC:** `bash scripts/deploy-live.sh` at `b43bdbe`. It passed its own checks: health, an SSE hello through nginx, and a POST round trip.
- **Re-posted 18:31:41 UTC:** "The phone lines are back. Thanks for holding.", through `POST /live-api/admin/notice`. Its id is `station-1793298701884`. The 17:06 copy was lost in the restart, as expected.
- **Confirmed:** the notice is in `live_station_notices`, scope `station`, with the same id, time and text as in `/live-api/admin/overview`.

**Not proven in production yet.** As Jackson asked, the chat was not restarted
again just to show the notice survives; the test proves it on the test
database. **The next chat deploy should check afterwards** that its notices
are still in `/live-api/admin/overview` with their original ids and times.
That only works while a notice is under 12 hours old, so post one shortly
before deploying.

## Blocks hit this session

1. **The npm hook** (`block-npm-in-prod.py`) refused `cd /root/hd-admin && … || (cd services/live && npm ci)`, because the `cd` inside the subshell looked like the production tree. I used the path its message names: `npm --prefix /root/hd-admin/services/live ci`.
2. **The auto-mode classifier** refused the station-notices deploy command twice. The first time ("Production Deploy"), the command would have pushed, pulled, dumped, applied the schema and inserted the notice, all at once; none of it ran. The second time ("Modify Shared Resources"), only the hand-written insert was refused, after the other steps had run one by one. Each time: no workaround tried; Jackson chose to skip the insert.

## Still open

- **The next chat deploy:** check the notices survived (above).
- **`highdesert-status`:**
  - `deploy` reads drift. The new commits are chat and scripts, not the web app, so they need no app deploy; the line clears with the next `scripts/deploy.sh`.
  - `mutations` FAIL is last Monday's weekly run (`live-heartbeat-route`, `e2e-fixture-view-answered`, stale). It clears at Monday's run.
- **The Mac** was unreachable for the backup and the digest copies.
- **sang3r.com's lockfile** is out of sync with its `package.json` on main, so `npm ci` refuses there. This was already true before today. Its deploy installs only when the lockfile changes, so the deploy is unaffected.

## Clean-up

- `/root/sanger-hd-admin`: removed. It was merged and deployed; its `.env.local` copy was deleted first.
- `/root/hd-admin`: removed once everything in it was pushed.
- The test database keeps a few test-scoped notice rows (scope `test-…`), which nothing reads.
