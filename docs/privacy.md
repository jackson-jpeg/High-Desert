# The privacy page (/privacy, 2026-11-19)

Why: sang3r.com's weekly site check (`src/lib/sites/guard.ts` there) fails a
site whose home page HTML has no `href` naming privacy, and the 2026-11-16
privacy audit (`docs/privacy-audit-2026-11-16/handoff.md`, request 1) asked
for a page with an effective date and a Do Not Track line (CalOPPA).

- Words: `src/lib/privacy/policy.ts`. Page: `src/app/[look]/privacy/`,
  `src/components/privacy/PrivacyView.tsx`, in the show pages' frame
  (static server HTML, works without JavaScript).
- Linked from: the welcome page's footer (in the HTML `/` sends, which is
  what the site check reads), the show pages' footer (`ShowShell`), the About
  dialog's Privacy paragraph. In the sitemap. `check:seo` fetches it.
- Tests: `src/components/privacy/__tests__/privacy-page.test.tsx`,
  `about-dialog.test.tsx`. Mutations `privacy-*`.

**When the code changes what it stores, change the page and move
`PRIVACY_EFFECTIVE`.** Each claim and where it was checked (2026-11-19):

| Claim on the page | Checked against |
|---|---|
| Library, favorites, playlists, bookmarks, history, progress in IndexedDB | `src/db/index.ts` (Dexie stores), `src/db/schema.ts` (`favoritedAt`) |
| Offline audio kept in the browser | `src/audio/cache.ts` (OPFS) |
| Settings in localStorage / sessionStorage (look, recent searches, welcome) | `src/lib/look/choice.ts`, `src/components/library/SearchBar.tsx`, `src/app/[look]/page.tsx` (`hd-visited`) |
| `hd-visitor`: random, localStorage, not a cookie, sent once per page load with device and look | `src/services/stats/visitor-client.ts` |
| Country and region looked up on our server, address not kept with the id | `src/app/api/stats/visitor/route.ts`, `scripts/schema.sql` (`visitors`), `docs/visitors.md` |
| Page views, time per tab, plays, arrival classes as daily totals | `docs/usage-tracking.md`, `scripts/schema.sql` (`route_daily`, `arrival_daily`) |
| Once-a-minute check-in, deleted minutes after leaving | `src/hooks/usePresence.ts` (`HEARTBEAT_MS`), `src/services/stats/db/presence.ts` (`ACTIVE_WINDOW_MS`, the prune) |
| Tune-ins: place, no id, public on Stats, 7 days | `scripts/schema.sql` (`visitor_tuneins`), `src/services/stats/db/visitors.ts` (`TUNEIN_RETENTION_DAYS`), `src/components/library/Listeners.tsx` |
| Ratings keyed by an HMAC of the address bucket | `scripts/schema.sql` (`rating_votes.voter`) |
| `hd_look`: 400 days; the phone split 2026-11-18 to 2026-12-01 | `src/lib/look/look.ts`, `src/lib/look/split.ts` (`SPLIT_FROM`, `SPLIT_UNTIL` exclusive) |
| `hd_live_caller`: set on opening Live or the Request Line, signed random id, 400 days, what keys on it | `services/live/lib/caller.mjs`, `services/live/lib/config.mjs`, `services/live/lib/app.mjs` (`callerOf` from `stream` and `getRequests`), `docs/live-chat.md` |
| `hd_live_admin`: admin only | `services/live/lib/config.mjs` (`ADMIN_COOKIE`) |
| Messages 7 days, names unused 30 days, address kept only as an HMAC | `services/live/lib/config.mjs` (`RETENTION_MS`), `services/live/lib/store.mjs` (`sweep`), `docs/live-chat.md` |
| Server logs: address, time, page, referrer, user agent; 13 months | `deploy/nginx/highdesert.conf` (`access_log`, default combined format), `/etc/logrotate.d/nginx` (`rotate 400`, daily) |
| No outside scripts; only archive.org for audio and listings | `src/lib/csp.ts` (`connect-src`, `media-src`) |

Left off on purpose (not verifiable from the code): where the server is,
how long the `visitors` rows and ratings are kept, and a contact address
(the site has none).

The About dialog used to say "Your address is never stored". The nginx
access log keeps addresses for 13 months, so it now says the count never
stores it. `Listeners.tsx` still says "Addresses are never stored." under the
map, meaning the location lookup; worth the same fix.
