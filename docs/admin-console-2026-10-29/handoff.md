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

## Station notices: built, tested, NOT deployed yet

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

**Not deployed: a block (see below).** The plan, in order:

1. Push the two commits; pull into `/root/High-Desert`.
2. `pg_dump`, then apply `services/live/schema.sql` (which `deploy-live.sh` also does).
3. Insert the one notice now on air into the new table, unchanged:
   - id `station-1793293565168`
   - time `2026-10-29T17:06:05.168Z`
   - text "The phone lines are back. Thanks for holding."

   Its record from before the deploy is in the session's scratchpad (`notices-before.json`). This is a copy, not a post: nothing is broadcast. Without it the deploy's own restart would wipe the notice before the new code could save it.
4. `bash scripts/deploy-live.sh`.
5. Read `/live-api/admin/overview` and check the notice is there with the same id and time.

**Progress after Jackson approved, 17:27 UTC.** Each step ran as its own command.

1. Pushed (`782b4ca`) and pulled into `/root/High-Desert`. Done.
2. `pg_dump` to `/root/backups/highdesert/pre-notices-20261029T172701Z.dump`, then `services/live/schema.sql`. Done: `live_station_notices` exists, granted to `highdesert_live`.
3. **The insert was refused** by the auto-mode classifier ("Modify Shared Resources"). Nothing was written: the table holds 0 rows.

The running chat is untouched. It still runs the old code with the notice in
memory, and the empty table is harmless to it. Steps 4 and 5 (the deploy and
the check) were not run, because deploying without the insert would wipe the
notice.

**Timing:** the notice expires at 05:06 UTC on 10-30, 12 hours after it was
posted. After that there is nothing left to check.

## Blocks hit this session

1. **The npm hook** (`block-npm-in-prod.py`) refused `cd /root/hd-admin && … || (cd services/live && npm ci)`, because the `cd` inside the subshell looked like the production tree. I used the path its message names: `npm --prefix /root/hd-admin/services/live ci`.
2. **The auto-mode classifier** refused the station-notices deploy command ("Production Deploy"). That command would have pushed, pulled, dumped, applied the schema and inserted the notice by hand. None of it ran: `origin/main` and `/root/High-Desert` were still at `3599d4f` afterwards. I did not retry it any other way; it waits for Jackson.

## Still open

- **The station-notices deploy** (above).
- **`highdesert-status`:**
  - `deploy` reads drift. The new commits are chat and scripts, not the web app, so they need no app deploy; the line clears with the next `scripts/deploy.sh`.
  - `mutations` FAIL is last Monday's weekly run (`live-heartbeat-route`, `e2e-fixture-view-answered`, stale). It clears at Monday's run.
- **The Mac** was unreachable for the backup and the digest copies.
- **sang3r.com's lockfile** is out of sync with its `package.json` on main, so `npm ci` refuses there. This was already true before today. Its deploy installs only when the lockfile changes, so the deploy is unaffected.

## Clean-up

- `/root/sanger-hd-admin`: removed. It was merged and deployed; its `.env.local` copy was deleted first.
- `/root/hd-admin`: kept, because it holds the two unpushed station-notices commits. It goes once they are pushed.
- The test database keeps a few test-scoped notice rows (scope `test-…`), which nothing reads.
