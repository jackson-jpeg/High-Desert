# Handoff: Phone lines now know one browser from another (2026-09-26)

**Live:** `dcc804e` (PR #32). App deployed with `scripts/deploy.sh` at 07:48 UTC and the phone
lines with `scripts/deploy-live.sh` right after, both run under `nice -n -15 ionice -c2 -n0`.
`highdesert-status`: every line OK. The fresh admin sign-in link is in the Mac's
`~/Downloads`.

## What changed for callers

- **Each browser is its own caller.**
  - A browser gets a random id in a first-party cookie (`hd_live_caller`: HttpOnly,
    Secure, 400 days). The id carries no personal data.
  - Names, lines, the rename limit, reports, mutes and bans all key on it.
  - A household, or strangers on the same cell network, are now separate callers.
    Each has their own name and line and can rename on their own. A mute or ban lands
    on one person only.
- **The address is a backstop, set generously.** Per address:
  - 300 new callers an hour;
  - 30 first calls an hour (callers already talking are exempt);
  - 60 messages and 60 reports a minute;
  - 200 open streams.

  No address is stored, only an HMAC.
- **A ban holds the address for 24 hours.** Clearing cookies makes a new caller who can
  listen, but only one new caller an hour from that address may start talking. Anyone
  already talking from there carries on.
- **Three reports must come from three different addresses.** They mute the author only.
- **Existing names survived.** The first browser from an address took over that address's
  old caller, with the name, line, past calls and any mute or ban. Seen on production: a
  real listener, "ArtBellAppreciator", reconnected when the service restarted and kept
  their name and line.
- **A full name pool no longer fails.** About 1,091 plain names exist. Once the ones tried
  are all taken, a caller gets a numbered one ("Night Owl 2626"). Before this, a busy night
  would have returned 503 to new callers.

Full account: `docs/live-chat.md`, "Who is calling".

## Verified on production

These were real browsers on this server, which puts them all behind one address, exactly
the household case. Stats writes were answered in the page.

| Pair | Names and lines | Renames, one after the other | Each call shows its own name on both screens | Refresh keeps each | Mute A for 1 min |
|---|---|---|---|---|---|
| Chromium + Chromium | different (West of the Rockies / Line 3) | 200 / 200 | yes | yes | A 403 "on hold", B 201 |
| Chromium + WebKit | different (International Line / Line 2) | 200 / 200 | yes | yes | not run |

- The cookie as served:
  `hd_live_caller=v1.…; Path=/live-api; Max-Age=34560000; HttpOnly; Secure; SameSite=Lax`.
- The ban plus cleared-cookies case was not run on production, because it would hold this
  server's address for a day. It is covered by the service tests, by
  `e2e/live-callers.spec.ts` (two browser contexts behind one address, desktop and mobile)
  and by CI.
- The five QA calls were hidden afterwards. The one that was muted had already been hidden
  by the mute.
- `scripts/csp-check.mjs` against https://highdesert.space: 7 routes, no CSP violations,
  no console errors, no em dashes.

## Em dashes

- Swept from the whole app in one pass: about 60 files, the phone lines' messages, the
  sign-in page and the web manifest.
- Two checks now fail CI on any em dash:
  - `src/lib/__tests__/no-em-dash.test.ts` covers every string and bit of JSX text in the
    source, however it is spelled;
  - `scripts/csp-check.mjs` covers the rendered pages.
- The rendered check proved itself on its first CI run. It caught a dash on /stats written
  as a Unicode escape, which the source scan had missed along with twelve more. The source scan now
  reads the decoded text.

## Found on the way, fixed

**The "2 Hours in the High Desert" milestone could greet brand-new visitors.** It added up
*where you are* in shows, not how long you had listened. So someone who tuned in to the
live station more than two hours into a broadcast, then reloaded, got the milestone and the
Venmo ask over the page within seconds. With the Reddit post coming, that would have been
a lot of first-time visitors. It now counts time actually heard (`docs/stats-audit.md`,
finding 14). It was found because the dialog covered the Leave button in an e2e test, which
failed 4 of 8 runs late in a show; after the fix, 8 of 8 passed.

## Tests and mutations

- 14 new service tests (13 in `services/live/test/callers.db.test.mjs`, 1 for numbered names), plus restated
  moderation and message tests; 253 live tests in all.
- `e2e/live-callers.spec.ts`: 6 passed locally (desktop and mobile), and green in CI.
- Mutations:
  - one per property;
  - five for the em dash check (a label, a Unicode escape, an `&mdash;` entity, a phone
    lines refusal, the manifest);
  - one for the milestone.

  All 136 live, em dash and milestone mutations go red. CI green on both runs.

## Worth knowing

- **The admin link:** yesterday's was unused, so a fresh one was minted:
  `~/Downloads/highdesert-live-admin-signin-2026-09-26T07-49-29Z.md`, one use, valid until
  2026-09-27 07:49 UTC. Yesterday's is still valid until 21:17 UTC today; whichever is used
  first works.
- **A test that still flakes.** The "join, refresh, resume" e2e test compares the site-wide
  live count, so a second test tuning in at the same moment can shift it. CI runs two
  workers, so it can still fail now and then. That is the test's weakness, not the site's.
- **Old QA names.** The QA callers' names ("QA Porch …", "QA Kitchen …") stay reserved for
  30 days without use, then the hourly sweep removes them.

## Left open

Nothing from the request.
