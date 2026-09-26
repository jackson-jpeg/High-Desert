# Launch summary: High Desert Live on Reddit (2026-09-26)

The station was posted to Reddit at about 17:05 UTC. It was watched until 23:20 UTC, with 25
checks at 15-minute intervals, each logged in `docs/launch-watch.md`. Nothing broke. No check
raised an alert, `highdesert-status` was OK every time, and no caller needed moderating.

## The numbers

Window 17:05 to 23:20 UTC unless noted. All figures are aggregates: no address is kept.

| | |
|---|---|
| **Peak online** | **29** at 22:46 UTC. The previous 30-day high was 19 |
| **Peak listening** | **12** at 20:52 UTC. The previous 30-day high was 8 |
| Mean online / listening | 18.3 / 5.6 |
| Peak tuned in to the live station | 7, at the 22:35 check |
| **Plays** | **239**: 233 from archive.org, 6 from the mirror (`play_events`, now 2,621 all time) |
| Plays that were the live station's show on air | 195, or 82% |
| Failed starts | 6 (5 stalls, 1 network error), 2.5% of plays. **All 6 recovered** on the mirror |
| **Calls** | **20**, from 17 different callers. The busiest hour (22:00) had 8 |
| **New callers** | **85** (89 callers seen on the lines) |
| Browsers that opened the phone lines | 67 distinct addresses, counted from 17:51 when the site's own access log began |
| Callers who picked their own name | 3. One name was refused for its characters |
| Reports, hides, mutes, bans | 0, 0, 0, 0. Slow mode never started |
| Address limits met | None. The only refusal was the one name |
| nginx 5xx / 429 | 2 / 0 (both 5xx explained below), from 17:51 |
| CPU, highest 15-minute mean | highdesert 1.9%, highdesert-live 0.1% (limit 10%) |
| Page loads from phones | 75% |

The calls were greetings and thanks. Callers said where they were listening from (Europe,
Canada and across the US), and several said they had found the station on Reddit. No abuse got
past the filter, so nothing was added to `data/chat-blocklist.txt` and nothing was hidden.

## What was fixed

1. **nginx would have refused people sharing one address before the phone lines' own limits
   applied** (PR #34, deployed 17:51 UTC, before the traffic arrived).
   - The vhost allowed 8 open streams and 30 posts a minute per address. That is two chatty
     callers on one carrier NAT, far below the service's own limits.
   - It now allows 200 streams and 120 posts a minute (burst 60). A test holds nginx at or
     above the service's limits.
   - The same PR gave the site its own access log, so the watch could count this site's 5xx
     and 429 alone. `/live-api/health` now breaks refusals down by kind and by which address
     cap was met.
2. **The flaky "join, refresh, resume" e2e test** (PR #35, deployed 18:32 UTC).
   - It compared the site-wide live count, which another CI worker could move. It now judges
     its own page's heartbeats (`e2e/own-presence.ts`).
   - It also waits for the saved show before refreshing. The old count poll had hidden that
     wait.
   - Two mutations. It passed in CI with two workers, desktop and mobile.
3. **A keep-alive race behind a 502** (this PR).
   - nginx kept idle connections to the app for its 60 s default. Node closes them after 5 s,
     which measured 6.0 s here.
   - At 22:25 a `POST /api/stats/stop` was sent on a connection Node had just closed. The app
     reset it, and a POST is not retried.
   - The upstream now has `keepalive_timeout 4s`. A test holds it below Node's own default, and
     a mutation proves the test.

The other 5xx was a 502 at 18:32:35, the second the app restarted for PR #35. It was a legacy
`/api/stats/active` poll from an old cached page.

## The next three things, from what listeners did

1. **Find out why 3 in 4 people online were not listening, then shorten the path to the
   station.**
   - Listening was the live station: 82% of plays were the show on air. Yet on average 18
     people were online and fewer than 6 were playing anything, and three quarters of page
     loads were phones.
   - We cannot yet say where they stopped. The access log cannot tell a visit from the
     service worker's precache, since every route shows the same ~225 visitors.
   - First build an aggregate count, with no ids, of arrivals versus tune-ins on a first visit.
     Then make "listen live" a single tap on a phone's first screen and measure whether it
     moves the number.
2. **Let callers say where they are.**
   - Callers kept telling the room where they were listening from. They did it under generated
     desert-town names that contradicted them (a caller "in Pahrump" greeting everyone from
     Belgium).
   - Only 3 of 89 changed their name.
   - Offer a place at the first call, for example "Caller from ___", checked by the same
     filter as names. That is what people were already trying to say.
3. **Make the room visible from the call box.**
   - One caller asked who else was listening while 5 to 7 were tuned in.
   - 67 browsers opened the phone lines, but 17 callers spoke.
   - The live count sits small in the chat header. Put "N listening now" next to the call box,
     and a quiet cue when someone tunes in, so a first-time caller can see the room is
     inhabited before deciding whether to speak.
