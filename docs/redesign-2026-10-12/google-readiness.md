# Google readiness, 2026-10-12

Can a new listener find a specific show by searching for its guest or topic?
Before this PR: no. After it: yes, once Google has crawled the pages.

## What was missing

- **No page for any show.** The whole archive lived in the app (IndexedDB in the
  browser), behind one URL per tab. Google could index five pages: home,
  Library, Live, Radio, Stats. A search for "Bob Lazar Art Bell 1989" had
  nothing here to land on. That is why Google sent 34 people in 15 days, 21 of
  them to the home page.
- **The sitemap listed those five pages.** No structured data beyond one
  "WebApplication" block for the whole site. One share image for every link.
- **Search Console was not set up**, so there is no record of what Google has
  seen or what people searched.

## What this PR built

- **A page for every show: 1,413 of them**, at `/show/<date>-<subject>-<guest>`,
  for example:
  - https://highdesert.space/show/1992-12-12-area-51-john-lear-bob-lazar
  - https://highdesert.space/show/1994-04-03-alien-abductions-budd-hopkins
- **The addresses never change.** Each show's address is written down once in
  `data/show-slugs.json` and is never rewritten. A new show gets a new one.
- **Every page is complete without JavaScript**: the server sends the finished
  HTML. It has the date, guests, topic, category, the summary and tags, a plain
  audio player that works with JavaScript off, and an **Open in High Desert**
  button that opens the show in the Library.
- **Real titles and descriptions** (date, guests, topic, category), a canonical
  tag, OpenGraph and Twitter cards, and **its own share image** (the show's
  title, date and guests on the site's art). Share images are drawn on request
  and cached for a week.
- **Structured data Google reads**: each page says it is a `PodcastEpisode` of
  the right series (Coast to Coast AM, Dreamland, specials) with its air date,
  length, audio file and guests, plus a breadcrumb trail.
- **Related shows** on every page: the same guest, the same day in other years,
  the same category. That gives Google (and listeners) paths through the archive.
- **175 guest pages**, at `/guest/<name>` (for example
  https://highdesert.space/guest/linda-moulton-howe), one for every guest with
  two or more shows. These are what a "Linda Moulton Howe Art Bell" search
  should land on.
- **sitemap.xml lists every show and guest page.** robots.txt keeps the admin
  tools and `/look` out.
- **The Library links to each show's page** ("Show page" in the episode panel),
  so the pages are part of the site, not an island.
- **An automated check** (`npm run check:seo`) runs in CI on every change. It
  reads the sitemap and crawls 35 show and guest pages. It fails the build on
  a missing title, description, canonical tag, card or share image, on bad
  structured data, on any broken link, and on a page whose content needs
  JavaScript. Its last run: 35 pages, 484 links, 70 share images, no problems.
- **Ready for Search Console.** The page can carry Google's verification tag
  (`GOOGLE_SITE_VERIFICATION` in the server's env file). The DNS way (below)
  needs no change to the site at all.

## What is left

1. **Verify the site in Search Console (your step, about 5 minutes).** See the
   question in the handoff.
2. **Submit the sitemap** once it is verified: Indexing, then Sitemaps, type
   `sitemap.xml`, Submit. Then URL Inspection on three or four show pages and
   **Request indexing**, to start the crawl sooner.
3. **Give it time.** A new site with 1,600 new pages is crawled over weeks, not
   days. Check Search Console's Pages report in two weeks.
4. **The share button still shares the old `?ep=` app link** rather than the
   show page. Switching it is a small follow-up, and the stronger link for
   Reddit and messages.
5. **Pulled episodes** keep their address on record but their page returns 404.
   That is deliberate (`docs/show-pages.md`).
6. Show pages are cached on disk after their first visit, about 175 KB each,
   about 280 MB once Google has crawled them all. The disk has room for that,
   but not much else.
