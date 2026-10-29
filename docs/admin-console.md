# The admin console on sang3r.com (2026-10-29)

Jackson asked for "the admin features for this site" on his own admin site,
"so i can easily monitor/control the chat, etc", with the Request Line, the
station's health and the supporters' shout-out alongside the chat.

**Where:** `https://sang3r.com/high-desert/admin` (linked as "Admin console"
from `/high-desert`). Four tabs, kept in the URL hash (`#chat`, `#requests`,
`#station`, `#supporters`).

## Who can use it

Every route under `/api/highdesert/admin/*` starts with sang3r.com's
`requireAuth`: the owner's Clerk session, or the native apps' service token.
Sign-up on the Clerk instance is open, so a signed-in stranger is not enough
(`requireOwner`). The page itself is under `/high-desert`, already private.

The chat's admin token never reaches a browser. sang3r.com reads
`LIVE_ADMIN_TOKEN` from `/root/.high-desert-live.env` on each call
(`HIGHDESERT_LIVE_TOKEN` overrides it) and calls the chat on loopback
(`http://127.0.0.1:3005`) with `Authorization: Bearer`. A POST also carries
`Origin: https://highdesert.space` and a JSON content type, which the chat
requires of every POST. Rotating the token in High Desert's env file needs
nothing on sang3r.com. A 401 from the chat is reported as a 502, so a stale
token never reads as "you are signed out".

## The tabs

| Tab | Reads | Does |
|---|---|---|
| Phone lines | `GET /live-api/admin/overview` every 5 s: the last 200 calls, **hidden ones included**, with reports, mutes, bans, slow mode, station notices and the service's health. "Load older calls" pages with `?before=` | Hide / Unhide, Mute 10 min / 1 h / 1 day, Unmute, Clear name, Ban / Unban, slow mode on (30 min) or off, a station notice |
| Request Line | `GET /live-api/admin/requests` every 30 s: today's nominations with notes and votes, tonight's locked pick | Veto (confirmed) |
| Station | `/api/live/schedule` (on the air, up next, outage swaps), `/api/stats/failures?days=7` (summary), and the last `highdesert-status` run | **Run check** runs `highdesert-status` (about 20 s) |
| Supporters | `node scripts/donor-shoutout.mjs --status`: the list with amounts, the last shout-out, when the next is due, and what it will say | **Thank them now** runs `--now` (confirmed) |

## Decisions

- **Undo exists for every hold.** The chat had hide, mute and ban but no way
  back. `unhide` (`{messageId}`), `unmute` and `unban` (`{callerRef}` or
  `{messageId}`) were added. Unban lifts the database row, the in-memory set
  (which is what the stream checks) and the 24 h hold on the caller's
  addresses. Unhide is not broadcast: open pages show the message again on
  their next load. A hide is rare and an un-hide rarer, and a new SSE event
  would mean a client change for both looks.
- **The admin requests read mints no caller.** The public `GET
  /live-api/requests` sets the caller cookie on a first visit; the admin read
  asks as a fixed nobody ref (`"0" × 64`) and never sets one, so the console
  is not a listener.
- **The status check runs only from its button.** It opens real browsers and
  takes about 20 s; sang3r.com's rule is that no page load writes or starts
  anything. The result is cached in `/var/lib/sanger/highdesert-status.json`
  (atomic write, one run at a time) and shown with its age.
- **Supporters are still code.** Adding a gift is a change to
  `src/lib/support/supporters.ts` and a deploy (first name and last initial
  only, held by a test). The console says so rather than offering an edit box
  that could not keep that rule.
- **A notice is listener copy:** at most 500 characters and no em dash,
  checked in sang3r.com before it reaches the chat.

## Code

- High Desert: `services/live/lib/app.mjs` (`adminOverview`, `adminRequests`,
  the `unhide`/`unmute`/`unban` cases), `services/live/lib/store.mjs`
  (`adminMessages`, `activeMutes`, `banList`, `unhideMessage`, `unmute`,
  `unban`), `scripts/donor-shoutout.mjs` (`shoutoutStatus`, `--status`).
- sang3r.com: `src/lib/highdesert-admin.ts` (the token, the loopback call, the
  action allowlist `actionBody`, the status runner),
  `src/app/api/highdesert/admin/{chat,action,requests,station,shoutout}/route.ts`,
  `src/components/highdesert-admin/*`, `src/app/(dashboard)/high-desert/admin/page.tsx`.

## Tests

- `services/live/test/admin-console.db.test.mjs`: the overview (hidden calls
  listed, paging, distinct reporters, admin only), unhide, unmute, unban (the
  memory set and the address holds), the caller-ref shape.
- `services/live/test/requests.db.test.mjs`: the admin read sets no cookie, the
  public read as its control; `moderation.db.test.mjs`: a forged admin is
  refused the three new actions.
- `scripts/__tests__/donor-shoutout.test.ts`: `shoutoutStatus`.
- sang3r.com `src/__tests__/lib/highdesert-admin.test.ts`: `actionBody`,
  `envValue`, `parseStatus`, `errorJson`; `route-guards.test.ts` holds every
  new route behind `requireAuth`.
- Mutations: `live-console-*`, `live-unhide`, `live-unmute`,
  `live-unban-memory`, `live-unban-holds`, `live-undo-caller-ref-shape`,
  `shoutout-status-*`.
