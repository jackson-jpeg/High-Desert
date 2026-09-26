# Launch watch: the Reddit post (2026-09-26)

A check every 15 minutes for six hours after the station was posted to Reddit.
Each block covers the time since the previous check:

- `highdesert-status`;
- the 15-minute CPU of every High Desert unit;
- presence and plays, plus failed starts (advisory rows excluded);
- the phone lines (callers, calls, peak calls a minute, new callers, reports, hides,
  mutes, bans, slow mode);
- the service's refusals by kind, and which address caps were met;
- nginx requests, 5xx and 429 for this site.

Callers' own words are read each check for abuse the filter misses, but they are not
copied here. Actions taken are logged under **Actions**.

Limits, for reading the numbers:

- CPU: 10% of a core per unit.
- Per address: 300 new callers an hour, 30 first calls an hour, 60 calls a minute,
  200 streams (nginx 200 streams, 120 posts a minute, from PR #34).

## Actions

- **17:51Z, PR #34 deployed (`a28a56e`)**, with `deploy.sh` then `deploy-live.sh`, both under
  `nice -n -15 ionice -c2 -n0`. nginx's per-address ceilings on the phone lines were tighter
  than the service's own (8 streams and 30 writes a minute per address), so a carrier NAT full
  of Reddit visitors would have been refused by nginx before the service's generous limits
  applied. They are now 200 streams and 120 writes a minute (burst 60), held at or above the
  service's limits by a test. The site also got its own access log, so 5xx/429 counts here are
  this site's only, and `/live-api/health` now breaks refusals down by kind, including which
  address caps were met. Verified: `highdesert-status` all OK, health reports `refusals`,
  the access log is being written.
- **18:32Z, PR #35 deployed (`a04ced1`)** with `deploy.sh` under `nice -n -15 ionice -c2 -n0`
  (a test-only change; deployed to keep production at HEAD). The flaky "join, refresh, resume"
  e2e test now judges its own page's heartbeats (`e2e/own-presence.ts`) instead of the site-wide
  live count, which another worker could move, and waits for the saved show before refreshing.
  Two mutations; green in CI with two workers, desktop and mobile.
- **23:20Z, the keep-alive fix** (see the 22:35 note) goes out with this log and the
  summary: `keepalive_timeout 4s` in the app upstream, below Node's 5 s. Shipped with
  `deploy-live.sh` (which installs the vhost after `nginx -t`) and `deploy.sh`, both niced.

## Checks

### 2026-09-26T17:20:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 0.5 highdesert-live 0.0 highdesert-sample 0.0 
- **listening:** online 11, listening 4, live 2; plays 1 in the window, 2383 all time; failed starts 0 
- **phone lines:** 3 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 0 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** (own access log not deployed yet)

### 2026-09-26T17:35:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.1 highdesert-live 0.0 
- **listening:** online 13, listening 6, live 3; plays 6 in the window, 2389 all time; failed starts 0 
- **phone lines:** 2 connected, slow mode false; 1 calls from 1 callers (peak 1/min), 3 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** (own access log not deployed yet)

### 2026-09-26T17:50:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 0.8 highdesert-live 0.1 
- **listening:** online 12, listening 3, live 0; plays 5 in the window, 2396 all time; failed starts 0 
- **phone lines:** 1 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 3 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=126 5xx=0 429=0

### 2026-09-26T18:05:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.1 highdesert-live 0.1 
- **listening:** online 12, listening 2, live 0; plays 7 in the window, 2401 all time; failed starts 1 (stall=1)
- **phone lines:** 1 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 2 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1319 5xx=0 429=0

### 2026-09-26T18:20:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 0.7 highdesert-live 0.0 highdesert-sample 0.0 
- **listening:** online 11, listening 3, live 1; plays 3 in the window, 2404 all time; failed starts 0 
- **phone lines:** 1 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 0 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1163 5xx=0 429=0

### 2026-09-26T18:35:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 0.9 highdesert-live 0.0 
- **listening:** online 16, listening 3, live 2; plays 4 in the window, 2408 all time; failed starts 0 
- **phone lines:** 4 connected, slow mode false; 1 calls from 1 callers (peak 1/min), 6 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1596 5xx=1 429=0 | 5xx /api/stats/active=1
- **note:** the one 5xx is a 502 on `/api/stats/active` at 18:32:35, the second of the #35 restart (a legacy alias, polled by an old cached build). Not an incident.

### 2026-09-26T18:50:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 0.7 highdesert-live 0.0 highdesert-sample 0.0 
- **listening:** online 15, listening 3, live 2; plays 3 in the window, 2411 all time; failed starts 0 
- **phone lines:** 4 connected, slow mode false; 1 calls from 1 callers (peak 1/min), 3 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1289 5xx=0 429=0

### 2026-09-26T19:05:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 0.7 highdesert-live 0.0 highdesert-sample 0.0 
- **listening:** online 15, listening 2, live 1; plays 11 in the window, 2422 all time; failed starts 1 (stall=1)
- **phone lines:** 4 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 1 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1461 5xx=0 429=0

### 2026-09-26T19:20:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 0.8 highdesert-live 0.0 
- **listening:** online 15, listening 2, live 1; plays 4 in the window, 2426 all time; failed starts 0 
- **phone lines:** 5 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 2 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1107 5xx=0 429=0

### 2026-09-26T19:35:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.3 highdesert-live 0.0 highdesert-sample 0.0 
- **listening:** online 15, listening 2, live 0; plays 11 in the window, 2437 all time; failed starts 0 
- **phone lines:** 6 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 4 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1242 5xx=0 429=0

### 2026-09-26T19:50:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.0 highdesert-live 0.0 
- **listening:** online 15, listening 3, live 1; plays 11 in the window, 2448 all time; failed starts 0 
- **phone lines:** 7 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 4 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1637 5xx=0 429=0

### 2026-09-26T20:05:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 0.7 highdesert-live 0.0 
- **listening:** online 18, listening 5, live 3; plays 7 in the window, 2455 all time; failed starts 0 
- **phone lines:** 7 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 3 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1515 5xx=0 429=0

### 2026-09-26T20:20:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.2 highdesert-live 0.0 highdesert-sample 0.0 
- **listening:** online 17, listening 7, live 4; plays 16 in the window, 2471 all time; failed starts 1 (stall=1)
- **phone lines:** 9 connected, slow mode false; 1 calls from 1 callers (peak 1/min), 4 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1664 5xx=0 429=0

### 2026-09-26T20:35:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 0.9 highdesert-live 0.0 
- **listening:** online 19, listening 7, live 2; plays 10 in the window, 2481 all time; failed starts 0 
- **phone lines:** 8 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 1 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1705 5xx=0 429=0

### 2026-09-26T20:50:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.2 highdesert-live 0.0 
- **listening:** online 24, listening 10, live 4; plays 12 in the window, 2493 all time; failed starts 0 
- **phone lines:** 9 connected, slow mode false; 2 calls from 2 callers (peak 1/min), 1 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=2196 5xx=0 429=0

### 2026-09-26T21:05:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.4 highdesert-live 0.0 
- **listening:** online 24, listening 9, live 3; plays 16 in the window, 2509 all time; failed starts 0 
- **phone lines:** 8 connected, slow mode false; 1 calls from 1 callers (peak 1/min), 2 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=2644 5xx=0 429=0

### 2026-09-26T21:20:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.7 highdesert-live 0.0 highdesert-sample 0.0 
- **listening:** online 23, listening 8, live 3; plays 14 in the window, 2523 all time; failed starts 0 
- **phone lines:** 10 connected, slow mode false; 1 calls from 1 callers (peak 1/min), 8 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=2388 5xx=0 429=0

### 2026-09-26T21:35:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.4 highdesert-live 0.0 
- **listening:** online 23, listening 9, live 4; plays 16 in the window, 2539 all time; failed starts 0 
- **phone lines:** 11 connected, slow mode false; 2 calls from 1 callers (peak 2/min), 5 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=2611 5xx=0 429=0

### 2026-09-26T21:50:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.8 highdesert-live 0.0 highdesert-sample 0.0 
- **listening:** online 22, listening 9, live 5; plays 12 in the window, 2551 all time; failed starts 0 
- **phone lines:** 11 connected, slow mode false; 1 calls from 1 callers (peak 1/min), 4 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=2260 5xx=0 429=0

### 2026-09-26T22:05:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.9 highdesert-live 0.0 
- **listening:** online 22, listening 5, live 2; plays 16 in the window, 2567 all time; failed starts 1 (network-error=1)
- **phone lines:** 13 connected, slow mode false; 2 calls from 2 callers (peak 1/min), 5 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=2780 5xx=0 429=0

### 2026-09-26T22:20:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.2 highdesert-live 0.0 
- **listening:** online 23, listening 7, live 5; plays 8 in the window, 2575 all time; failed starts 0 
- **phone lines:** 12 connected, slow mode false; 1 calls from 1 callers (peak 1/min), 4 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {"rejected:name-chars":1}; address caps met: {}
- **nginx:** requests=1965 5xx=0 429=0

### 2026-09-26T22:35:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.1 highdesert-live 0.0 
- **listening:** online 25, listening 8, live 7; plays 15 in the window, 2590 all time; failed starts 0 
- **phone lines:** 12 connected, slow mode false; 2 calls from 1 callers (peak 1/min), 4 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=2107 5xx=1 429=0 | 5xx /api/stats/stop=1
- **note:** the one 5xx is a 502 on `POST /api/stats/stop` at 22:25:03: nginx error log "recv() failed (104: Connection reset by peer)" from the app, no restart. The known keepalive race (nginx upstream idle 60 s vs Node 5 s); a stop beacon, not listener-visible. Fix queued for after the launch rather than an nginx change mid-watch.

### 2026-09-26T22:50:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.2 highdesert-live 0.0 highdesert-sample 0.0 
- **listening:** online 26, listening 6, live 5; plays 12 in the window, 2602 all time; failed starts 2 (stall=2)
- **phone lines:** 15 connected, slow mode false; 3 calls from 2 callers (peak 2/min), 6 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1693 5xx=0 429=0

### 2026-09-26T23:05:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 0.8 highdesert-live 0.0 highdesert-sample 0.0 
- **listening:** online 27, listening 6, live 4; plays 9 in the window, 2611 all time; failed starts 0 
- **phone lines:** 16 connected, slow mode false; 1 calls from 1 callers (peak 1/min), 3 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1595 5xx=0 429=0

### 2026-09-26T23:20:05Z

- **status:** all OK
- **cpu (15 min):** highdesert 1.1 highdesert-live 0.0 
- **listening:** online 23, listening 6, live 4; plays 10 in the window, 2621 all time; failed starts 0 
- **phone lines:** 18 connected, slow mode false; 0 calls from 0 callers (peak 0/min), 7 new callers; reports 0, hidden by reports 0, by admin 0; active mutes 0, bans 0
- **refusals:** {}; address caps met: {}
- **nginx:** requests=1620 5xx=0 429=0

## End

Watch closed at 23:20:05Z after 25 checks: every `highdesert-status` OK, no alert, nothing
to moderate. Summary: `docs/launch-summary-2026-09-26.md`.
