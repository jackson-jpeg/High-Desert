# Firefox and `play NotSupportedError` on archive.org (2026-10-11)

**Answer: it is not Firefox, and nobody lost a show to it.** archive.org's
storage node `dn720703.ca.archive.org` sometimes answers a media request with
**HTTP 500 and no `Access-Control-Allow-Origin`**. A load that fails before
metadata sets `MediaError` code 4, fires `error`, and then rejects the pending
`play()` with `NotSupportedError`. That is the spec, and Chromium and WebKit did
exactly the same in a test. Firefox shows it as `play NotSupportedError` because
it rejects `play()` quickly, and the row recorded the rejection rather than the
media error.

## What the data says (production, all time)

- `desktop-firefox`: 49 rows. 24 are `network-error` on archive.org since
  2026-09-27, across 19 episodes, and **all 24 recovered** on the mirror
  (`failover=mirror`). Details: 16 `play NotSupportedError`, 7 `code=2`, 1
  `code=4 Failed to open media`.
- The same failure on every browser, archive-source `network-error` since
  2026-09-25: android-chrome 35, desktop-firefox 24, ios-safari 10,
  desktop-chromium 8, ios-pwa 2. **79 rows, 79 recovered**, about 2.4% of
  3,342 archive.org plays.
- A desktop-safari row on 2026-09-25 already said it outright: `R1: Origin
  https://highdesert.space is not allowed by Access-Control-Allow-Origin.
  Status code: 502`.

## What was ruled out

| Hypothesis | Verdict |
|---|---|
| CSP blocks the redirected host | No: `media-src 'self' blob: https://archive.org https://*.archive.org` covers every storage node |
| Wrong `Content-Type` | No: `audio/mpeg` on every successful hop |
| `crossOrigin="anonymous"` (src/hooks/useAudioPlayer.ts) | Not the cause: a 500 fails the same with or without it. Keep it; the analyser needs it |
| The files' codecs | No: every Firefox failover recovered, playing the same bytes from `/mirror/` |

126 ranged GETs over the 18 episodes Firefox failed on: 4 returned `HTTP/2
500`, all from dn720703, none with an ACAO header. A repeat request succeeded.
Firefox itself could not be run here (no Firefox build is installed for
Playwright); Chromium and WebKit were, against a stubbed 500.

## What changed

- **The row now says why.** `playRejection(err, describeMediaError(audio.error))`
  (`src/audio/play-session.ts`, both catches in `useAudioPlayer.ts`): a
  rejection after a media error is recorded as e.g. `code=4 R1: Received 500
  HTTP error code (play NotSupportedError)`. Leading with `code=N` keeps it in
  the public failures route's diagnostic shape. Test in
  `src/hooks/__tests__/mirror-failover.test.ts`, mutation
  `play-rejection-media-error`.
- **Nothing else.** The mirror failover already rescues every one of these
  starts within 0.1 to 3.8 s.
- The same storage node's 500s are what cut the mirror's fills mid-file; that
  is fixed separately with a per-slice retry (`services/mirror/lib/nginx.mjs`).

Not investigated: a smaller set of failovers that did not recover
(`after archive network-error play NotSupportedError` on ios-safari,
desktop-chromium and android-chrome). Only the iOS ones look like the known
expired-activation case.
