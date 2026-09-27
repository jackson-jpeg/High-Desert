# Handoff: the Reddit launch (2026-09-26, evening)

**Live:** the merge of PR #36 (this handoff, the launch summary and the watch log, plus the
keep-alive fix). App deployed with `scripts/deploy.sh` and the vhost with
`scripts/deploy-live.sh`, both under `nice -n -15 ionice -c2 -n0`. `highdesert-status`: every
line OK.

## What happened

The station was posted to Reddit at about 17:05 UTC and watched until 23:20 UTC, with a
check every 15 minutes.
- Peaks were 29 online and 12 listening, both new highs; the old 30-day highs were 19 and 8.
- 239 plays, 82% of them the live station's show on air.
- 20 calls from 17 callers, and 85 new callers.
- No reports, no abuse and no address limit met.
- 6 failed starts, all of which recovered on the mirror.

The full numbers and the next three improvements are in `docs/launch-summary-2026-09-26.md`.
Every check is in `docs/launch-watch.md`.

## Shipped today during the launch

| PR | What | Deployed |
|---|---|---|
| #34 | nginx per-address ceilings raised to the service's own (a carrier NAT is one address); the site's own access log; refusal counts in `/live-api/health` | 17:51 UTC |
| #35 | The flaky "join, refresh, resume" e2e test judges its own page's heartbeats (`e2e/own-presence.ts`), not the site-wide count | 18:32 UTC |
| #36 | `keepalive_timeout 4s` in the app upstream, below Node's 5 s; a 502 at 22:25 was nginx reusing a connection Node had closed. Plus these docs | after 23:20 UTC |

Each has a test and a mutation that goes red. All were green in CI.

## Worth knowing

- **`/var/log/nginx/highdesert.access.log`** now holds this site's requests alone. Count
  5xx and 429 there, not in the shared `access.log`. It is the combined format, so addresses
  are in it the same way they always were in the shared log.
- **Route counts in that log are not visits.** Every page route shows about the same ~225
  addresses, because the service worker precaches the shell. Measuring arrival to tune-in
  needs its own aggregate count (improvement 1 in the summary).
- **Local e2e runs of the tuned-in tests need more than this box has.** Two workers, each
  streaming audio, pushed the load average to 9.7 on 2 cores, and every tuned-in test failed
  with "Transmission Interrupted". The local stack also has no `/mirror`, so an archive.org
  stall has nowhere to fail over. Run them one worker at a time here; CI is the two-worker
  check.
- **The tuned-in e2e tests still depend on archive.org streaming.** On PR #36's first CI
  run, "Leave the station stops the audio…" failed because the on-air show's stream failed
  on the runner ("Transmission Interrupted", "VIA MIRROR"). Production logged an archive.org
  stall 10 minutes earlier, which the mirror recovered. The tests skip when archive.org
  cannot be reached, not when a stream stalls, and the CI stack has no mirror to fail over
  to. A re-run passed. Serving a short fixture MP3 from the e2e stack's own `/mirror` would
  take archive.org out of these tests' pass/fail.
- **The admin sign-in link** in the Mac's `~/Downloads` is still valid until 2026-09-27
  07:49 UTC. It was not needed.

## Left open

Nothing from the request. The three improvements in the summary are proposals, not started.
