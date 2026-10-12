# Usage tracking: tabs, time per tab, arrivals, where plays start

Added 2026-10-12. A usage audit that day had to rebuild per-tab usage from
nginx Referer headers on heartbeat and play POSTs, because the app recorded no
page views, no time per tab and no "where was this play started". This is
that record, kept the way the funnel is (`docs/funnel.md`): daily counters,
first party, aggregate only.

## What is counted

| Table | Row | Written by |
|---|---|---|
| `route_daily (day, route, device, views, minutes)` | `views`: one per tab entered, client-side navigation included, once it has stayed on screen 1 s. `minutes`: one per minute heartbeat from a tab that was on screen | `POST /api/stats/view`; the 60 s heartbeat |
| `arrival_daily (day, source, landing, device, n)` | One per browser session: where it came from (a coarse class) and the tab it landed on | the session's first `POST /api/stats/view` |
| `play_events.surface` | Where each play was started | `POST /api/stats/play` |

- **Tabs** (`route`, `landing`): `welcome` (`/`), `library`, `radio`, `stats`,
  `live`, `show` (`/show/<slug>`), `other` (the admin tabs, `/look`, anything
  else). `routeOf()` in `src/lib/usage/vocab.ts`.
- **Device**: `phone` when the window is narrower than 768 px at the time
  (the app's breakpoint, the funnel's rule), else `desktop`.
- **Day**: the UTC day the server counted it.
- **Arrival classes**: `reddit`, `google`, `other-search` (Bing, DuckDuckGo,
  Yahoo, Ecosia, Brave, Kagi, Yandex, Startpage), `ai` (ChatGPT, Perplexity,
  Claude, Gemini, Copilot), `social` (Facebook, Instagram, X/Twitter, t.co,
  Threads, Bluesky, Mastodon, YouTube, TikTok, Lemmy), `internal` (a referrer
  from this site), `direct` (no referrer), `other`. Decided in the browser
  from `document.referrer` and `utm_source` (`utm_source` first when it names
  something known: ChatGPT links carry `utm_source=chatgpt.com` and often no
  referrer). `src/lib/usage/arrival.ts`.
- **Surfaces**: `library`, `radio`, `stats`, `show` (the tab it was started
  on), `live` (the station's airing, whoever started it), `queue` (a queue
  advance, next/previous, a pick in the queue panel), `restore` (the
  remembered show's first play), `palette` (the command palette), `other`
  (the welcome page, the admin tabs). NULL is unknown: older rows, older
  clients, and any value the server does not know (stored NULL, never a 400).

## What is never stored or sent

No referrer, host, URL, query string, session id, address, user agent or
browser id. The referrer is read and classed in the browser and only the
class leaves it. Like every public counter here the numbers can be inflated by
someone who wants to; the writes are rate limited per client (views 60 a
minute; minutes at most `SESSIONS_PER_CLIENT` a minute per client).

## How each figure is made

- **Views**: `UsageTracker` (`src/components/UsageTracker.tsx`), mounted
  once in the root layout so every page is covered, watches `usePathname()`.
  A tab counts after `VIEW_SETTLE_MS` (1 s) on screen, so the welcome page's
  instant redirect of a returning visitor to `/library` (or a phone to
  `/live`) is not a view of the welcome page.
- **Arrival**: the first view of a browser session carries
  `arrival: {source, landing}`, `landing` being the first path the session
  loaded (so a bounce from `/` lands on `welcome`). "Once" is
  sessionStorage `hd-arrival`, written before anything is sent; a session that
  cannot store it reports no arrival rather than one per page.
- **Minutes**: the minute heartbeat (`usePresence`, every 60 s) carries
  `{route, device, visible}`; the server adds a minute only for
  `visible: true`. The extra beats (on mount, on coming back to the tab, on a
  live change) carry none of it, so no minute is counted twice. Everything
  else the heartbeat does is unchanged, and bad values are ignored, never
  refused. The heartbeat runs only inside the app shell (`DesktopShell`), so
  the welcome page has views and arrivals but no minutes; so will the show
  pages if they are built outside the shell.
- **Surface**: bound to the play's start token (`src/audio/play-surface.ts`).
  An emitter that knows better than the tab says so around its emit
  (`withPlaySurface("queue", () => emit("play-episode", ep))`: the queue
  advance in `player-store`, the queue panel, the command palette, the live
  station); the layout's play-episode handler binds it right after
  `beginStart()`. `primeEpisode()` binds `restore`, which is what the restored
  show's first ▶ (`togglePlay`, the second start path) reports. A Try Again
  keeps the surface of the start it retries. `countListen()` reports `live`
  for the station's airing (the airing claim) and otherwise the bound surface
  or the tab.

## Keeping checkers out

The same rule as the funnel. `scripts/csp-check.mjs` sets
`localStorage["hd-not-counted"] = "1"` (`src/services/stats/not-counted.ts`)
before any page script runs: such a browser sends no view, no arrival, no
minute and no funnel step. `e2e/fixtures.ts` (`SERVER_WRITES`) and
`scripts/presence-check.mjs` answer `POST /api/stats/view` in the page, along
with the heartbeat and play.

## Reading it

`GET /api/stats/usage?days=7|30|90` (anything else is 7), `no-store`:

```json
{
  "days": 7,
  "routes": [{ "route": "live", "device": "phone", "views": 412, "minutes": 3810 }],
  "arrivals": [{ "source": "reddit", "landing": "live", "device": "phone", "n": 96 }],
  "playsBySurface": { "library": 0, "radio": 0, "live": 0, "stats": 0, "show": 0,
                      "palette": 0, "queue": 0, "restore": 0, "other": 0, "unknown": 0 }
}
```

Days are UTC days, today included. `routes` is most viewed first, `arrivals`
largest first. `playsBySurface` counts `play_events` in the same window;
`unknown` is plays with no surface (before this shipped, or an old tab).

```bash
curl -s 'https://highdesert.space/api/stats/usage?days=7' | jq
```

Code: `src/lib/usage/` (vocabulary, classifier), `src/services/stats/usage-client.ts`,
`src/components/UsageTracker.tsx`, `src/audio/play-surface.ts` (browser);
`src/services/stats/db/usage.ts`, `src/app/api/stats/view/route.ts`,
`src/app/api/stats/usage/route.ts` (server); `route_daily`, `arrival_daily`
and `play_events.surface` in `scripts/schema.sql`. Mutations: the `usage-*`
and `play-surface-*` ids in `scripts/mutate-check.mjs`.
