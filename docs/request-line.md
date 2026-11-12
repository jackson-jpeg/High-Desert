# The Request Line (2026-10-14)

Listeners pick one show for High Desert Live to play every night at 8 PM
Pacific (10 PM, Art's original airtime, until the station day 2026-11-13;
moved 2026-11-12, see `docs/hosts.md`).

## The rules

- **Nominate** with **Request it**: on every show page (`ShowView`, hidden
  without JavaScript) and in the Library's episode panel (`EpisodeManageBar`,
  which both looks share). One nomination per listener (one browser, the phone
  lines' caller cookie) per Pacific day. Requesting a show someone already
  nominated that day is a vote for it, and does not use up your own pick.
- **Vote** on `/request-line` with one tap: one vote per listener per show.
  Behind one address at most 10 votes count for a show (`VOTES_PER_ADDRESS`),
  so a script minting cookies cannot take the night. A household or a
  carrier's NAT can still cast many votes. Nominations from one address are
  capped at 20 an hour.
- **Not nominable:**
  - a show the station played in the last 30 days (any `live_days` slot from
    day − 30 through the nomination's own day, plus any past request night);
  - a file `audio_checks` knows is broken;
  - anything not in the catalog, or with no duration.
- **A note** (optional, at most 140 characters) goes through the phone lines'
  word filter (`moderate.message`), so links, contact details and blocked
  words are refused like a call. The caller's name and place are their phone
  lines name and "Calling from", already filtered, kept on the nomination as
  they were when it was made.
- **Voting closes at 6 PM Pacific.** After that, a nomination counts for
  tomorrow (`requestDayAt`).
- **Admin veto:** `POST /live-api/admin/request-veto {nominationId}`, or the
  Veto button on `/request-line` for a signed-in admin. A vetoed pick leaves
  the list and takes no more votes (410). Before the request hour, vetoing the locked
  winner deletes the night, and the next read locks the runner-up.

## The lock: one function, in the database

`live_request_night(day, now)` in `services/live/schema.sql`:

- Before 6 PM Pacific on `day` it returns nothing.
- From 6 PM on, the first call inserts the night's row:
  - the nomination with the most votes cast before 6 PM;
  - only nominations made before 6 PM and not vetoed;
  - a tie goes to the earliest nomination.
- `ON CONFLICT DO NOTHING`: the app's schedule and the phone lines can both be
  first, and both read the same row back.
- A night nobody nominated for is a row with `file_hash` NULL.

The app reads it in `src/services/live/requests.ts` (`loadRequestNight`,
cached 15 s). Any failure to read it, including tables or a function that do
not exist yet, reads as "no request". The station never fails for the
Request Line.

## The schedule: the request hour

The hour belongs to the day (`requestHourOf`, `src/lib/live/pacific.ts`): 8 PM
Pacific from 2026-11-14, 10 PM before, because days are frozen a day ahead
with the stand-in on the hour. `requestStartAt` is the day's end minus 4 h
(2 h before the move), DST-safe. Copy takes its hour from the day
(`requestHourLabel`, `pacificHourLabel`); voting still closes at 6 PM.

`buildDay` (`src/lib/live/schedule.ts`) packs every new frozen day in two
stretches (`docs/hosts.md`, "A show plays to its end"):

1. Midnight to the hour: shows that end, with their station ID, by then, and
   leave either under 2 minutes or time one or two more shows can close.
   Nothing is cut (until 2026-11-12 one was, when nothing fitted).
2. On the hour it places the next show in order that fits the night and marks
   it `requestSlot`.
3. The rest of the night is packed the same way to midnight.

`applyRequest` runs at read time, before the outage swap and the breaker's
overrides (`assembleSchedule`), and on `/tonight` (`src/services/live/tonight.ts`):

- slots before the hour are clipped to end, with their station ID, by then
  (only a day frozen before the Request Line has one that runs into it);
- the winner airs on the hour as `kind: "request"` with `request: {by, place, votes, day}`;
- the rest of the night is packed again after the winner: the frozen night's
  shows in their order, then the frozen ranking, then the rest of the catalog,
  each only if it plays in full by midnight, with duplicates skipped.

On an empty night, or one whose winner cannot air (a show someone other than
Art hosted is refused at nomination and by `isAirable`), the frozen day is
returned untouched. Days frozen before the Request Line have no `requestSlot`
mark; `applyRequest` still works on them (the "legacy cut" test).

**A pick longer than the time to midnight is cut there**: four hours at 8 PM,
which two catalog files exceed. The show that held the hour airs after the
pick only if it still fits.

## The herald

When the request comes on the air, the phone lines' service posts a
**From the station** card:

> Tonight's request, from Night Owl, calling from Pahrump.

(or "Tonight's request, from Night Owl." with no place). It checks every 30 s
what is on the air (`/api/live/schedule`). It marks `announced_at` on the
night in the same statement, so it says this once, and never again after a
restart.

## Where it shows

- **`/request-line`** (`src/app/[look]/request-line/`, `force-dynamic`):
  - the rules in one paragraph;
  - tonight's pick once locked (title, who asked, votes), or "a fan favorite
    plays at 8 PM" on an empty night;
  - the day's nominations, most voted first, with who picked them and their
    notes.

  The list is a client island (`RequestLineList`) rendered on the server, so
  a crawler reads it whole. In the browser it marks this listener's own pick
  "(you)" and spends Vote once voted. It also offers **Share my pick**
  ("Vote for my pick on High Desert") and, for an admin, **Veto**. The page
  has its own share card (`src/app/request-line/opengraph-image.tsx`), is in
  the sitemap, and is checked by `check:seo` and `check:csp`.
- **Live**: `TonightsRequestNote`, both looks.
  - **On a phone, right under the hero's Listen live** (moved there the same
    day, after it went unseen below the calls and the clock), as a card with
    its own **Pick a show** button to the Request Line.
  - **On a desktop, one link** in the console under its top row.

  What it says:
  - before 6 PM: "Tonight's request at 8 PM. Pick a show or vote by 6 PM Pacific.";
  - before 6 PM, once there are picks: "Tonight's request at 8 PM. 3 shows in
    the running, vote by 6 PM Pacific." (`useRequestPicks` asks
    `/live-api/requests` on mount, every 2 minutes on screen and on coming
    back; a count for another day, i.e. tomorrow's, is never shown);
  - locked: "Tonight's request at 8 PM: <title>, from <name>, calling from <place>.";
  - empty: "No request tonight. A fan favorite plays at 8 PM.";
  - gone once the request has aired.

  It is read from the published program (`tonightsRequest`), so it says
  what the station will play.
- **Menus**: **Request Line** in Win98's Start menu (accelerator Q, since R
  is Run; Run... `requestline` too) and at the top of Night's More sheet on a
  phone, under Quick Actions (under Navigate it was below eight sorts).
- **Tonight's log**: the request's row says "Requested by <name>, calling
  from <place>" (`requestedBy`).
- **`/tonight`**: "Listener request" with "from <name>" on the row, and a line
  under the program heading linking to the Request Line. A Tonight page is
  kept for at most an hour, so the locked pick can take up to an hour after
  6 PM to appear there. It airs at 10.

## API (services/live, `/live-api`, same-origin, the caller cookie)

| Route | Answer |
|---|---|
| `GET /live-api/requests` | `{day, closesAt, startsAt, nominations: [{id, fileHash, title, airDate, guestName, name, place, note, votes, mine, voted}], nominated, tonight: {day, fileHash, by, place, votes, startsAt} \| null, admin}`. `day` is the Pacific day picks are for. `tonight` is null before 6 PM |
| `POST /live-api/requests` `{fileHash, note?}` | **201** `{joined: false, id, counted, votes, day}`; **200** `{joined: true, ...}` when the show was already up (a vote). **409** `already-nominated` / `played-recently` / `broken-file`, **404** `not-a-show`, **410** `vetoed`, **400** `rejected` (the note), **429** `rate` (address) |
| `POST /live-api/requests/vote` `{nominationId}` | **200** `{ok, counted, votes}` (`counted: false` for a second tap). **409** `closed` after 6 PM, **410** `vetoed`, **404**, **429** `address-votes` |
| `POST /live-api/admin/request-veto` `{nominationId}` | **200** `{ok, day, relocked}`. Admin only (401) |

Every POST needs JSON and a highdesert.space `Origin`, like every
`/live-api` POST. The service reads the catalog from the app's own
`/seed/library.json` over loopback, cached 6 h (`LIVE_APP_URL` points it
elsewhere on a local or CI stack).

## Tables (`services/live/schema.sql`)

- `live_request_nominations`: `UNIQUE (day, client_ref)` and `UNIQUE (day, file_hash)`. Refs are HMACs, 64 hex; no address is stored.
- `live_request_votes`: `PRIMARY KEY (nomination_id, client_ref)`.
- `live_request_nights`: one row per locked day, `announced_at` for the herald.

Nominations (and their votes) are deleted after 35 days by the service's
hourly sweep. A night keeps its name, place and count. The service's role is
granted these tables, plus `SELECT` on `live_days` and `audio_checks`.

## Tests

- `src/lib/live/__tests__/schedule.test.ts`, "the Request Line's slot (2026-10-14; 8 PM from 2026-11-14)":
  the times across DST, one `requestSlot` on the hour every day, the night packed again, no
  duplicates, the empty night, another day, the legacy cut.
- `services/live/test/requests.db.test.mjs`: vote limits (one per listener,
  10 per address), one pick a day, the 6 PM lock and tie, after 6 PM is
  tomorrow, the empty night, the 30-day rule (with a 31-day control), broken
  and unknown files, the note filter, veto and relock, the herald once.
- `src/services/live/__tests__/request-line.db.test.ts`: the locked night
  through `buildSchedule` on real frozen days, votes after 6 PM ignored, the
  empty night's control.
- `src/components/request-line/__tests__/`: the page in server HTML (JSON-LD,
  links, no em dash), the list's marks, vote and veto, Request it's answers,
  the show page and Library panel, and the Live note in both looks on phone
  and desktop.
- `src/lib/tonight/__tests__/tonight.test.tsx`: `/tonight` applies the night.
- `e2e/request-line.spec.ts` (local stacks only; it writes real nominations).
- Mutations: the `request-*` ids in `scripts/mutate-check.mjs`.
