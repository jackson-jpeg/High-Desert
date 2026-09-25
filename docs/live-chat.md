# The phone lines: live chat for Live Broadcast

The chat beside the Live Broadcast player. Callers get an Art Bell-style name
and a line ("West of the Rockies", "Area 51 Line", …). Messages show up in
real time on everyone's screen. Moderation runs on the server and costs
nothing: no AI, no third-party service.

- **Service:** `services/live/`, its own package: plain Node ESM, `node:http`,
  `pg` and `obscenity`. Unit `highdesert-live` runs as user `hdlive` on
  127.0.0.1:3005, from `/opt/highdesert-live`.
- **Transport:** Server-Sent Events carry messages down to the browser; plain
  JSON POSTs carry them up. nginx proxies `/live-api/`. The stream has
  buffering and caching off and a 1 h read timeout.
- **Storage:** Postgres, the `highdesert` database, seven `live_*` tables
  (`services/live/schema.sql`, idempotent). The service connects as its own
  role, `highdesert_live`, which has DML on those seven tables and nothing
  else.
- **UI:** `src/components/live/LiveChat.tsx` (`<LiveChat />`, no props).
  - It has no chrome of its own. The Live screen supplies it: the "Phone
    Lines" Win98 window beside the player on desktop, and `LiveChatSheet` on
    mobile, which sizes itself to the visual viewport.
  - Inside that box it draws Win98 insets on desktop and glass on mobile.
  - It keeps its own composer in view when the iOS keyboard arrives
    (`useKeyboardInset`, from `visualViewport`).
  - State comes from `useLiveChat`, and the transport from
    `src/services/live/client.ts`.
- **Listener count:** this comes from the one presence function,
  `useCommunityNow().live`, never from the chat service. The chat's connected
  count is an operational number for `highdesert-status`. It is not a
  listener count, and no UI shows it.

## Why a separate service

A web deploy restarts `highdesert.service`. If the chat ran inside Next.js,
every deploy would drop every chat stream at once, and 200 reconnects would
land together. SSE also needs long-lived responses, which the Next.js route
handlers here are not built for. Running as a separate unit also lets
`highdesert-status` hold it to the 10% rule on its own.

## API

Every error is JSON. The POST routes require `Content-Type: application/json`
(**415** `json-only` otherwise) and an `Origin` of `https://highdesert.space` or
`https://www.highdesert.space` (**403** `bad-origin` otherwise). That is the CSRF
defence, and the admin cookie's `SameSite=Strict` adds to it.

| Route | Method | Body → response |
|---|---|---|
| `/live-api/stream` | GET (SSE) | See the events below. `Last-Event-ID` (header, or `?lastEventId=`) resumes after that id. **403** if banned. **429** past 8 streams per client or 3,000 in total |
| `/live-api/me` | GET | `{name, line, admin, mutedUntil, nextNameChangeInS, slowMode}`. Returns `{banned: true, admin: false}` for a banned client |
| `/live-api/messages` | POST | `{body}` → **201** `{id, at, name, line, body}`. The body is the stored text, with mild profanity masked. **400** `{error: "rejected", reason, message}`. **429** `{error: "rate", retryAfter, slowMode}` with `Retry-After`. **403** `{error: "muted", reason, retryAfter, message}` / `{error: "banned", message}` |
| `/live-api/name` | POST | `{name}` → **200** `{name, line, nextChangeInS}`. **400** rejected. **409** `{error: "taken", message}`. **429** `{error: "rate", retryAfter, message}` |
| `/live-api/report` | POST | `{messageId}` → `{ok, hidden}`. Reporting your own message, or reporting twice, is accepted and not counted |
| `/live-api/admin/signin-page` | GET | The page a sign-in link opens. It reads the `#nonce`, removes it from the address bar, then POSTs it |
| `/live-api/admin/signin` | POST | `{nonce}` → sets the admin cookie. **401** `{error: "bad-link"}` if the nonce is unknown, used or expired. 5 attempts per minute per client |
| `/live-api/admin/signout` | POST | Clears the cookie |
| `/live-api/admin/hide` | POST | `{messageId}` |
| `/live-api/admin/mute` | POST | `{messageId, minutes}` (1 min to 7 days, default 10). Also hides that message |
| `/live-api/admin/ban` | POST | `{messageId}` → `{ok, hidden}`. Hides that client's last 24 h and closes their streams |
| `/live-api/admin/slow` | POST | `{on, minutes}` (default 30) → `{ok, slowMode}` |
| `/live-api/admin/clear-name` | POST | `{messageId}` → `{ok, name}`. Gives the caller a fresh random name and renames their past messages on every screen |
| `/live-api/admin/verify` | POST | → `{ok, id, ms}`. Used by the deploy's POST round trip: writes an already-hidden row, reads it back and deletes it. Never broadcast |
| `/live-api/health` | GET | `{ok, clients, messagesLastHour, slowMode, cpu: {pct, windowS} or null, startedAt}`. **nginx returns 404 for it publicly.** `highdesert-status` reads it on loopback |

Admin routes accept the cookie or `Authorization: Bearer $LIVE_ADMIN_TOKEN`,
and return **401** `{error: "admin-only"}` without either.

**SSE events.** `retry: 5000` is sent first, then a comment heartbeat every
25 s.

| Event | Data |
|---|---|
| `hello` | `{you: {name, line, admin}, slowMode, recent: [msg…], resumed, hidden: [id…]}`. `recent` is the newest 50, oldest first. On a resume it is everything after the given id, up to 200. **Every `line` in every shape is the label** ("Line 6"), never the stored index — `publicMessage()` maps it once, for the broadcast, the POST answer, `recent` and the resume alike. History once carried the raw index, so a reload showed a caller's own calls as "5" under "Line 6" |
| `message` | `{id, at, name, line, body}`. The SSE `id:` is the message id |
| `hide` | `{ids}` |
| `slow` | `{on, until, intervalMs, forced}` |
| `rename` | `{ids, name}` |

A message never carries its client ref, and no public shape does. A client
whose buffered output passes 256 KB is dropped rather than buffered. Its
EventSource reconnects and resumes from its last id.

## Identity

`client_ref = HMAC(CHAT_CLIENT_SECRET, clientKey(ip))`. It uses the app's own
`clientKey` (IPv6 bucketed on the /64, IPv4-mapped folded into IPv4) through
the symlink `services/live/lib/shared/client-key.ts → src/lib/utils/client-key.ts`,
so the two cannot drift. `deploy-live.sh` copies it with `-L`.

- **No address is stored anywhere.** Every `client_ref` column has
  `CHECK (~ '^[0-9a-f]{64}$')`.
- `X-Forwarded-For` is trusted only from a loopback peer (nginx).
- A CGNAT or office network shares one address, so its members share one
  identity: one name, one pace, one mute. That is the cost of storing no
  address, and it is also why three reports must come from three distinct
  clients.

## Moderation

### The filter (`services/live/lib/moderation/`)

Messages and names go through the same checks, in this order:

1. **Normalise.** NFKC folds fullwidth and compatibility forms. Format
   characters (zero-width characters, bidi overrides, soft hyphens) are
   removed. Control characters become spaces. Combining marks are capped at
   two per letter. Whitespace is collapsed.
2. **Length.** 280 code points per message, 2–32 per name. Empty is refused.
3. **Contact details** are refused:
   - **links:** a scheme, `www.`, or a real TLD. TLDs that are also common
     words (it, in, at, be, no, am, so, la) are left out, so "tired.so" is not
     a link. `dot com` spelled out is caught.
   - **emails:** they need a dot-TLD, so `b@$t@rd` is not an email.
   - **phone numbers:** 7–15 digits with separators. Years are exempt
     ("1999 to 2004"), and so are runs of 7+ number words.
4. **Words.**
   - [`obscenity`](https://github.com/jo3-l/obscenity) supplies the English
     dataset and its lookalike, leet and repeat-collapse transformers.
   - Added on top:
     - a lookalike map for Greek and the extra Cyrillic letters obscenity
       misses;
     - an accent-stripped view;
     - a **despaced view** that drops punctuation inside a word and joins runs
       of single letters ("n i g", "f.u.c.k");
     - a **stretched pass** for tokens with a run of 3+ identical letters,
       which the matcher's own collapse keeps doubled.
   - Terms made only of digits (`1488`) are matched digit for digit. The
     matcher's collapse would make "1488" match "148".
   - **Block**: slurs, sexual terms, threats and hate phrases. The message is
     refused with reason `blocked`.
   - **Mask**: mild profanity (fuck, shit, ass, bitch, dick, …) is replaced by
     `*` in the stored text.
   - "dick" is masked, not blocked, because the catalogue has Dick Criswell
     and Philip K. Dick.
5. **Names** refuse any hit, including a mask-category word. They also refuse
   reserved names (Art Bell, admin, mod, staff, official, "High Desert", "the
   host") and anything outside letters, digits and ` '.,&-`.

**Why `obscenity`.** It is the maintained library with the most use: 229k
weekly downloads, last published 2026-01-18, zero dependencies. It is also the
only one of those checked that models evasion (lookalikes, leetspeak and
stretched letters) as transformers over a pattern language with word
boundaries. `bad-words` (135k), `@2toad/profanity` (79k), `leo-profanity`
(37k) and `glin-profanity` (10k) are word lists matched literally.

**False positives are tested against the whole catalogue.** Every title,
guest and summary in `public/seed/library.json` must pass unchanged. Places
where that failed were fixed with `allow:` entries: Fukushima, trafficking,
Scunthorpe, Dick Criswell, "Sex and the Occult", shiitake, cumulus and others.

**The tests hold no slurs in plain text.** `services/live/test/fixtures/filter.json`
is base64. The variants (leet, symbols, spacing, dots, Cyrillic, Greek,
fullwidth, zero-width characters, accents, stretching, case) are derived from
the decoded words at test time.

### Extending the blocklist: `data/chat-blocklist.txt`

One term per line. `#` starts a comment.

| Syntax | Meaning |
|---|---|
| `term` | block the whole word |
| `term*`, `*term`, `*term*` | block with an open end: prefix, suffix or substring |
| `mask:term` | mask instead of block |
| `allow:phrase` | never match inside this phrase (a false-positive fix) |
| `b64:…` | base64 of the term, for words that should not sit in the repo in plain text |

Every term goes through the same normalisation as messages, so one line also
catches its leet, spaced and lookalike forms. To ship a change, commit it,
then `bash scripts/deploy-live.sh --blocklist`. That parses the file with the
deployed code, installs it and sends SIGHUP. The service also rechecks the
file's mtime every 5 s. No stream is dropped.

### Limits

All of these live in `services/live/lib/config.mjs`.

| Rule | Value |
|---|---|
| Message length | 280 code points |
| Pace | 1 message per 3 s per client |
| Duplicate | the same text, ignoring case, accents, punctuation and spacing, from the same client within 10 min (the last 8 remembered) |
| Flood | the same text of 12+ characters from 3 different clients within 60 s. The 3rd and later senders are refused |
| Auto slow mode | 20 messages in 30 s turns it on for 2 min: 1 message per 10 s per client. It is announced with a `slow` event |
| Admin slow mode | forced on for N minutes, or off |
| Reports | 3 from distinct clients hide the message and mute its sender for 10 min. At most 10 reports per client per minute |
| Name change | at most once per 10 min. Unique among names seen in the last 30 min, compared as lower-case letters and digits only |
| Retention | swept hourly: messages after 7 days (reports go with them), mutes once expired, nonces a day after expiry, names unused for 30 days |

Limit state lives in memory and resets on restart. Mutes, bans, reports,
names, slow mode and nonces live in Postgres and survive a restart.

## Admin

The credential is `LIVE_ADMIN_TOKEN`: 32 random bytes, hex, in
`/root/.high-desert-live.env` (root, chmod 600). It is never in a link, never
on stdout and never committed.

**Signing in.** Run `bash scripts/live-setup.sh --link`.

1. It mints a nonce (32 random bytes) and stores only its SHA-256. The nonce
   is single-use and expires after 24 h.
2. It writes the link to a timestamped file,
   `highdesert-live-admin-signin-<UTC>.md`, and copies it to the Mac's
   `~/Downloads`. If the Mac is unreachable, the file is staged in
   `/root/.high-desert-live-links/` and the script says so.
3. The link is `https://highdesert.space/live-api/admin/signin-page#<nonce>`.
   The part after `#` is never sent in a request line or a Referer. The page
   removes it from the address bar before it POSTs.
4. A successful sign-in sets `hd_live_admin`: an HttpOnly, Secure,
   SameSite=Strict cookie. Its value is `v1.<expiry>.<HMAC>` under a key
   derived from the token, and it lasts 30 days. Rotating the token signs
   everyone out.

Signed in, each message row gets admin controls: hide, mute, ban and clear
name. The header gets a slow-mode toggle. The UI shows these only when the
server says `admin: true`, and the server checks every action anyway.

## The 10% rule and the load test

No High Desert background service may sustain more than 10% of one core.
`highdesert-status`'s `live` line judges highdesert-live's 15-minute mean from
`hd-cpu-sample report` (vps-tools). That is a timer that samples each High
Desert unit's cgroup `usage_usec` every minute into a ring, and it is the same
source as the status `cpu` line.

- While the ring does not span the window (report exits 3), or has no row for
  the unit yet, the line judges the service's own 15-minute
  `process.cpuUsage()` average from `/live-api/health` instead, and says so.
- **FAIL** above 10% of one core.
- **WARN** when neither source has a number yet.

`CPUQuota=25%` in the unit is a safety net and does not enforce the rule. A
quota at 10% would hide an overrun as throttling instead of reporting it.

`services/live/scripts/load.mjs` runs N simulated callers. Each holds an SSE
stream and posts every 20–60 s, and every 30 s there is a burst of 20
simultaneous posts. It measures:

- latency from post to receipt, for every receiver;
- lost deliveries;
- the service's CPU, from the cgroup's `cpu.stat` `usage_usec` (`--unit`) or
  from `/proc/<pid>/stat`.

It exits 1 if the CPU average is over 10% or if any delivery was lost.

Measured on this VPS on 2026-09-25 against a local instance (`--spawn`, a
`*_test` database, run with `nice -n 10`):

| Callers | Window | Posts (201) | Deliveries | Lost | Latency p50 / p95 / p99 / max | CPU (one core) |
|---|---|---|---|---|---|---|
| 200 | 183 s | 899 | 179,800 | 0 | 13.6 / 78.6 / 192.5 / 279.9 ms | **3.0%** |

There were also 52 responses of 429 (the pace and slow-mode limits working)
and 4 of 400. The 400s led to the digit-for-digit fix above: caller 148's
posts were refused as "1488".

To load-test production after a deploy, run this in a quiet hour, because
posts are visible while it runs:

```bash
set -a; . /root/.high-desert-live.env; set +a
cd /opt/highdesert-live && nice -n 10 node scripts/load.mjs --unit highdesert-live --cleanup
```

The production run tells callers apart with `X-Forwarded-For` from the
198.18.0.0/15 benchmark range, which the service accepts only from loopback.
The `x-live-test-client` header works only with `LIVE_LOAD_TEST=1`, which the
unit never sets and `deploy-live.sh` refuses to deploy with.

## Deploy

```bash
cd /root/High-Desert
bash scripts/live-setup.sh           # env file (token, client secret, DB URL) + role highdesert_live
bash scripts/deploy-live.sh          # stage, npm ci, pg_dump, schema, unit, swap, nginx, verify
bash scripts/live-setup.sh --link    # a one-time admin sign-in link → Mac ~/Downloads
highdesert-status                    # the `live` line
```

`deploy-live.sh` checks three things. It fails closed on any of them and
rolls back the code, and the vhost if it changed:

1. health answers on loopback;
2. `event: hello` arrives through `https://highdesert.space/live-api/stream`,
   which proves nginx is streaming and not buffering;
3. `/live-api/admin/verify` completes a POST round trip through nginx and
   Postgres.

The other modes:

- `--verify-only` repeats the three checks.
- `--rollback` swaps back to `/opt/highdesert-live.prev`.
- `--blocklist` ships the blocklist alone.

Schema changes are additive and are not rolled back. `deploy-live.sh` writes
a `pg_dump` to `/root/backups/highdesert/pre-live-<UTC>.dump` before it
applies the schema.

## CSP

`connect-src 'self'` (`src/lib/csp.ts`) already covers `/live-api/*`, which
is same-origin. Nothing was widened. The sign-in page sends its own CSP: the
inline script is allowed by hash, with `connect-src 'self'` and
`Referrer-Policy: no-referrer`.
