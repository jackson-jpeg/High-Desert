# High Desert: the full update. Handoff (2026-10-12)

Branch `session/2026-10-12-full`, one PR. Built from four work branches on a
shared foundation commit (`418d264`):

| Branch | What |
|---|---|
| foundation (`418d264`) | Looks go public: Win98 default, Night the option, `[look]` segment, one URL per page, preview code retired |
| `feat/looks` | Display setting in both looks, first-visit Night offer, look recorded on arrivals/tune-ins/plays, leftovers |
| `fix/meters` | iPhone visualizer and VU meters |
| `feat/growth` | Share URLs, share a moment, show/guest pages first-class, topic pages, Tonight |
| `feat/phone` | Live on a phone, Phone Lines tab slot, Continue Listening, install prompt |

**No GitHub Actions for this PR** (Jackson's call, 2026-10-12). Lint,
typecheck, the full suite, every mutation and the screenshot suite ran here on
the VPS through `heavy`. The PR's head commit and its merge commit carry
`[skip ci]`, so neither `ci.yml` nor `mutations.yml` ran on the PR or on
`main` for this merge. The nightly mutation run (09:30 UTC, scheduled) is
unaffected and is the first Actions run to see this code.

<!-- SECTIONS BELOW ARE FILLED IN AT INTEGRATION -->

## How the look is chosen (foundation)

- The root layout is `src/app/[look]/layout.tsx`; both looks are prerendered
  (`generateStaticParams`), and an unknown look is `notFound()`. Pages render
  `<html data-look>` on the server, so there is no flash.
- **The cookie is read by a rewrite, not by the proxy.** `next.config.ts`
  `rewrites().beforeFiles`: `hd_look=night` goes to `/night/:path`, everything
  else to `/win98/:path`. A middleware rewrite was tried first and failed: a
  proxy rewrite must be an absolute URL, and the server's own origin
  (`-H 127.0.0.1`) differs from the request's, so Next proxied it externally
  (500, ECONNRESET) or threw `NoFallbackError`.
- `LOOK_PAGES` excludes the look prefixes themselves, because Next chains
  `beforeFiles` rewrites (`/win98/win98/...` otherwise).
- `src/proxy.ts`: `/radio` 308s to `/library?view=dial`; `/night/...` and
  `/win98/...` 308 to the plain path (a look is never a second URL); an invalid
  `hd_look` (the old signed HttpOnly preview cookie) and `hd_look_view` are
  deleted.
- Share cards stay outside the look segment (`src/app/show/[slug]/opengraph-image.tsx`
  etc.) and every page names its card explicitly in metadata.
- Retired: `/look`, the look pill, `/live-api/admin/look`, `look.mjs`,
  `scripts/look-cookie.mjs`, `HD_LOOK_KEY`, the old public look and its
  screenshot set, the Radio tab (`/radio` redirects).

## Found at integration: a hydration mismatch on every page

The visualizer agent reported Night never finishing its boot. A production
build of the integration branch showed React #418 on every page in both looks,
and the boot screen stuck on `/live`; `next dev` showed nothing, which is why
it got past the branches. Cause: pages render in the `[look]` segment through a
rewrite, so `usePathname()` read `/win98/live` while a page was prerendered and
`/live` in the browser. The empty player (hidden on `/live`) was in the server
HTML of `/live`, and the tab bar marked no tab. Fix: `useAppPathname()`
(`src/hooks/useAppPathname.ts`) takes the look off; ESLint bans `usePathname`
everywhere else (proved in `eslint-rules.test.ts`); two mutations. Rebuilt and
re-probed: no #418, boot screen clears, in both looks at 390 and 1280.

The e2e and test databases got the new `schema.sql` (look columns).

## The resend loop (item 4)

It was this session's own scheduled wakeup. While waiting on CI for PR #72 I
armed a `ScheduleWakeup` fallback ("Check CI on PR #72 head 2e2ae04; if green
merge and deploy ..."). That put the session in the dynamic /loop mode, and the
runtime kept re-firing the same prompt into `claude-high-desert-1` after the
work was done: once at 05:25, and again at 05:46 under a new task id with no
new call from me. Stopped at 05:46:06 with `ScheduleWakeup({stop: true})`.
`CronList` showed no cron jobs. Nothing else on the box sends prompts: the
other sessions' loops (simsunday's tour checks, bambu-mcp's watcher) are their
own work, inside their own sessions. I no longer arm wakeups for background
work; the harness's own task notifications cover it.

## Hook blocks this session

- `require-pipefail.py`, 6 times (a pipe without `set -o pipefail;`): at the
  live-setup link step, at the status checks, at a `cat ... | head` of the
  layout, and three earlier. Each was re-run with the prefix; nothing routed
  around.

## Incidents

- An `npx next start` killed by its own PID left `next-server` holding port
  3769. I checked the orphan's cwd was `/root/hd-full` and killed that PID;
  later servers ran under `setsid` and were stopped by process group.
- `pgrep -f` matched my own shell once (read-only, nothing killed).

## Not mine, noticed

- `sogojet-deploy-status` exits 1: SoGoJet prod has 88 undeployed commits, 16
  days old. Another project; left alone.

## Still left

- `feat/looks` used a private test schema `hd_looks` in `highdesert_test`;
  drop it after integration (`DROP SCHEMA hd_looks CASCADE`). The shared test
  DB needs `schema.sql` applied once.
- No direct mutation for the layout's `noteFunnelRevisit()` call or for
  TimelineView passing `look` (behaviour behind both is mutation-covered).
