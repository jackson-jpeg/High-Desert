# Handoff: redesign groundwork (2026-10-12)

PR #72, merged as `11b8d80` and deployed to highdesert.space at
2026-10-12T05:14:56Z. CI and Mutations are both green on the merge.

## Your queue (one question)

**Is Google Search Console verified for highdesert.space?** If it isn't, here
is the path, and it takes about two minutes:

1. Open search.google.com/search-console and click **Add property**.
2. Choose **Domain** and enter `highdesert.space`, then **Continue**.
3. Copy the TXT record Google shows you.
4. In Hostinger, open **Domains**, then highdesert.space, then **DNS / Nameservers**. Add a **TXT** record with name `@` and the copied value.
5. Back in Search Console, click **Verify**. DNS can take a few minutes.
6. Open **Sitemaps** and submit `sitemap.xml`.

If you'd rather use the HTML tag, send me the `content` value and I'll put it
in `GOOGLE_SITE_VERIFICATION` in `/root/.high-desert.env` and redeploy. The
site already renders the tag when that value is set. Today it isn't set.

## Switching looks

Your one-use admin sign-in link (valid 24 h) is in
`~/Downloads/high-desert-KEY-2026-10-12/`. Open it on your phone, then go to
`highdesert.space/look`. The full steps are in `look-guide.md`.

## What shipped

- **Usage tracking:**
  - Tab views by route (`route_daily`).
  - Arrivals by referrer class and landing page (`arrival_daily`).
  - The surface each play started from (`play_events.surface`).
  - All of it is first party with no third-party scripts, and headless browsers opt out (`docs/usage-tracking.md`).
  - The next audit gets these numbers from Postgres instead of nginx logs, which keep only 14 days.
- **Show pages:**
  - A server-rendered, ISR page for each of the 1,413 shows at `/show/<slug>`, plus `/guest/<slug>`.
  - Each page has a title, description, canonical tag, OpenGraph and Twitter cards with a generated image, PodcastEpisode and BreadcrumbList JSON-LD, and related-show links.
  - Also shipped: `sitemap.xml`, `robots.txt`, and `npm run check:seo` (in CI), which crawls a sample of pages. Details in `docs/show-pages.md`.
- **Two preview looks**, Clean and Win98:
  - They're behind an `hd_look` cookie that only `POST /live-api/admin/look` can sign.
  - The public look is unchanged: no data-look attribute, no switcher, and no cookie set on a public request.
  - In both looks, Radio moves into the Library as a Dial view, and `/radio` redirects there.
  - `e2e/looks.spec.ts` screenshots every screen in all three looks, on phone and desktop. Details in `docs/looks.md`.
- **Sign-in link location:** `live-setup.sh --link` now writes the link into its own KEY folder (700, file 600) instead of loose in Downloads.

## Deploy steps taken

1. Backed up `/root/.high-desert.env` to `/root/.high-desert.env.bak-2026-10-12`.
2. Added `HD_LOOK_KEY` (`node services/live/lib/look.mjs --key`, derived from `LIVE_ADMIN_TOKEN`; the app never sees the token itself).
3. Applied `scripts/schema.sql` (the new tables plus `play_events.surface`).
4. Ran `bash scripts/deploy-live.sh`, which verified health, SSE and the POST round trip.
5. Ran `bash scripts/deploy.sh`, which deployed and verified `11b8d80`.

## Verification

- `highdesert-status` after the deploy: all OK except two warnings that were already there at session start.
  - `failures` is at 18.3% of starts. The release line, which counts lost starts, is OK at 1.7%.
  - `warm` pins are below target because the disk is short.
- `mutations` was OK at session start and is still OK: the nightly run on fa9dfa9 turned every mutation red in all 4 shards.
- On production, show, guest, OG image, sitemap (1,413 shows), robots and `/look` all return 200.
- `e2e/looks.spec.ts` against https://highdesert.space with the production admin token passed 26 of 26. The 81 screenshots are in the `screens` folder beside this file.

## Hook blocks hit, and what was done next

- **The pipefail hook (`require-pipefail.py`) blocked me 4 times, and the four sub-agents about 12 more.** Each block was an unguarded pipe. Each command was re-run with `set -o pipefail;` at the front, or written to a file first. Nothing was routed around the hook.
- **No other hook blocked anything.** The npm hook never triggered because all dependency work ran in worktrees with hardlinked `node_modules`.

## Incidents this session

- **Port collision.**
  - My local e2e stack was first set to ports 3500/3501, which belong to production nginx and SoGoJet's PostgREST. The bind failed, and two read-only GETs went to nginx. Nothing was written.
  - I moved the stack to 3610/3611/3615 after checking `ss -ltnp`. The rule is now in memory: check ports before binding, never assume one is free.
- **`pkill -f` killed my own shell.** No other process was affected. After that I stopped processes only by their verified PIDs.
- **Mutations workflow failed twice on stale anchors.** That was 4 anchors in all, one of them hidden by sharding. All 841 anchors were then checked to occur exactly once, and CI went green.
- **`scripts/__tests__/deploy.test.ts` timed out 3 times** in the full local suite under load. It passes 14/14 when run alone, and CI passed it.

## Leftovers

- The Share button still shares `?ep=` links. It should share `/show/<slug>`, which is the cheapest growth fix there is (see `recommendation.md`).
- The preview pill overlaps content on phones (preview looks only).
- The Win98 desktop signal meter is faint.
- Win98 phone library rows are still cards, not list rows.
- The Win98 player is empty when no show is loaded. Public behaves the same way.
- Disk: once fully crawled, show pages will cache about 280 MB. 5.5 GB is free, and the warm job already sits below its floor.
- The integration worktree `/root/hd-rd` was removed after the merge.
