# Privacy audit requests (2026-11-16)

From the privacy-audit session (root, claude-2's agent), auditing every live site so none needs a cookie banner. Nothing in this repo was changed except this file; the requests below are Jackson's to approve and a High Desert session's to make, under this repo's rules (worktree, checks through `heavy`, `deploy.sh`).

## What was measured

Headless WebKit as an iPhone 15 (Playwright from this repo's `node_modules`, through `heavy`), loading `/` (a phone is sent to `/live`) and `/request-line`, scrolled to the bottom, then idle:

- **Third-party requests: none.** Everything came from highdesert.space (archive.org audio was not started; nothing was played).
- **Cookies:** `hd_live_caller` (highdesert.space, HttpOnly, Path=/live-api, 400 days as set, WebKit reported about 365), minted when `/live` opens the phone lines stream, before the visitor calls in.
- **localStorage:** `hd-visits`, `hd-funnel`, `hd-visited`, `hd-booted`, `hd-visitor`. **sessionStorage:** `hd-arrival`, `hd-visit-counted`.
- No Umami (by design: CLAUDE.md forbids analytics scripts).

## Requests

1. **A privacy page with an effective date and a Do Not Track line.** The About dialog's Privacy paragraph is the only policy, and it has neither, which California's CalOPPA asks for. A `/privacy` page (server-rendered like the show pages, linked from About and the footer of the show pages) saying, in plain words: what stays in the browser (library, favorites, history in IndexedDB; the keys above), the random visitor id `hd-visitor` used to count each browser once, the approximate country and region looked up on our server from the connection (address never stored), the `hd_live_caller` cookie and what it is for (one caller per browser on the phone lines: name, line, rename limit, reports, mutes), the 400-day lifetime, that nothing goes to a third party, and a DNT sentence. Suggested DNT wording, accurate to the code: "High Desert's own counting does not follow you to other sites and shares nothing with anyone, so the site treats every visitor the same way whether or not your browser sends a Do Not Track signal." Then `check:seo` and `check:csp` as usual.
2. **Jackson's call: is `hd_live_caller` strictly necessary before someone calls in?** It is minted when the stream says hello, so every visitor to `/live` gets a 400-day identifier whether or not they ever call. Minting it on the first POST (call, rename, place, vote) instead would make it strictly necessary in the plain sense. If it stays as is, the privacy page must say it is set on opening Live.
3. **Jackson's call: `hd-visitor`.** It is a persistent random id kept for visitor counting. It is not a cookie and never leaves highdesert.space, so it needs no banner under US law, but under the EU's ePrivacy rules a stored identifier used for analytics needs consent. Fine to keep for a US audience; say so on the page.
