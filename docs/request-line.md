# The Request Line (2026-10-14)

Listeners pick one show for High Desert Live to play every night at 10 PM
Pacific, Art's original airtime.

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
  the list and takes no more votes (410). Before 10 PM, vetoing the locked
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

## The schedule: the 10 PM slot

`buildDay` (`src/lib/live/schedule.ts`) builds every new frozen day around
10 PM (`requestStartAt` = the day's end − 2 h, DST-safe; `src/lib/live/pacific.ts`):

1. Before 10 PM it takes the next show that ends, with its station ID, by
   10 PM.
2. If none fits and at least 10 minutes are left (`MIN_CUT_MS`), it cuts the
   next show at 10 PM.
3. At 10 PM it places the next show in order and marks it `requestSlot`.
4. The rest of the day fills to midnight.

`applyRequest` runs at read time, before the outage swap and the breaker's
overrides (`assembleSchedule`), and on `/tonight` (`src/services/live/tonight.ts`):

- slots before 10 PM are clipped to end, with their station ID, by 10 PM;
- the winner airs at 10 PM as `kind: "request"` with `request: {by, place, votes, day}`;
- everything that was on from 10 PM moves after the winner, end to end, cut at
  midnight, with duplicates skipped;
- any time left before midnight is filled from the frozen ranking.

On an empty night, or one whose winner cannot air, the frozen day is returned
untouched. Days frozen before this release have no `requestSlot` mark;
`applyRequest` still works on them (the "legacy cut" test).

**A pick longer than two hours runs to midnight**, and the show that held
10 PM does not air that night. That is the shift, by design.

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
    plays at 10 PM" on an empty night;
  - the day's nominations, most voted first, with who picked them and their
    notes.

  The list is a client island (`RequestLineList`) rendered on the server, so
  a crawler reads it whole. In the browser it marks this listener's own pick
  "(you)" and spends Vote once voted. It also offers **Share my pick**
  ("Vote for my pick on High Desert") and, for an admin, **Veto**. The page
  has its own share card (`src/app/request-line/opengraph-image.tsx`), is in
  the sitemap, and is checked by `check:seo` and `check:csp`.
- **Live**: `TonightsRequestNote`, under the phone's strip and in the desktop
  console, both looks. One link to the Request Line:
  - before 6 PM: "Tonight's request at 10 PM. Pick a show or vote by 6 PM Pacific.";
  - locked: "Tonight's request at 10 PM: <title>, from <name>, calling from <place>.";
  - empty: "No request tonight. A fan favorite plays at 10 PM.";
  - gone once the request has aired.

  It is read from the published program (`tonightsRequest`), so it says
  what the station will play.
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

- `src/lib/live/__tests__/schedule.test.ts`, "the Request Line's 10 PM slot":
  the times across DST, one `requestSlot` at 10 PM every day, the shift, no
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
