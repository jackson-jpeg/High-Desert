# Show pages: every show findable on Google (2026-10-12)

Before this, the whole archive lived in the visitor's IndexedDB. A search for
"Art Bell John Lear Area 51" could only ever find the home page, because no URL
on the site named a show. Now every catalog show has its own server-rendered
page, and every guest with two or more shows has a page listing them.

## URLs

| Page | Example | What it is |
|---|---|---|
| `/show/<slug>` | `/show/1992-12-12-area-51-john-lear-bob-lazar` | one broadcast (1,413) |
| `/guest/<slug>` | `/guest/linda-moulton-howe` | every show with one guest (guests with 2+ shows) |
| `/show/key/<communityKey>` | `/show/key/ultimate-ultimate-art-bell-collection--1992-12-12_-_...` | 308 to the show's page; what the library links to. Carries `?t=` |
| `/show/<slug>?t=<seconds>` | `/show/1992-12-12-area-51-john-lear-bob-lazar?t=5025` | a shared moment: the show's page, playing from that second (see "Sharing") |
| `/topic/<slug>` | `/topic/mels-hole` | every show on one topic (70; see "Topic pages") |
| `/topics` | | every topic, grouped |
| `/tonight` | | 307 to today's (Pacific) Tonight page, never cached |
| `/tonight/<yyyy-mm-dd>` | `/tonight/2026-10-12` | one station day: its program and the date's broadcasts (see "Tonight") |

### Slugs are permanent

- `data/show-slugs.json` maps `fileHash` to slug. **It is committed and
  add-only**: a slug, once minted, never changes, even if the show's title or
  guest is corrected later, and a retired slug is never reused. Google and
  anyone who shared a link hold the URL.
- A slug is the air date, then the subject (the title without "Coast to
  Coast AM - "), then the guest unless the subject already names them; cut at
  a word to 72 characters; `-2`, `-3` on a collision
  (`scripts/lib/show-slugs.mjs`, `src/lib/shows/slugify.ts`).
- **Adding shows to the catalog:** run `node scripts/gen-show-slugs.mjs` and
  commit the map with the catalog. `--check` exits 1 if a show has no slug.
  `src/lib/shows/__tests__/show-slugs.test.ts` fails on a show with no slug, a
  duplicate, a malformed slug, or any committed slug that changed (it compares
  every version of the file git has; CI's shallow clone has only HEAD).
- **Pulling a show** (CLAUDE.md, "Pulling an episode"): leave its slug in the
  map. It gets no page anyway: `buildShowCatalog` skips everything in
  `REMOVED_FROM_CATALOG` and everything not in the seed.
- Guest slugs are computed from the name (`guestSlug`, honorific dropped), not
  committed: a guest page is a list, and a renamed guest is a different list.

## The page

`src/app/show/[slug]/page.tsx` renders `src/components/shows/ShowView.tsx`
inside `src/components/shows/ShowShell.tsx` (`src/app/show/layout.tsx`). It
is **not** in the `(desktop)` group: no app shell, no player, no IndexedDB,
no client component at all. Everything is in the server HTML, so it reads,
links and plays with JavaScript off.

- **Boot screen.** The root layout's `#app-loading` waits for `[data-hydrated]`
  or 6 s, and without JavaScript forever. `ShowShell` renders
  `<style href precedence>#app-loading{display:none!important}</style>`, which
  React hoists into `<head>`, so it never paints. The boot script is untouched.
- **Audio.** `<audio controls preload="none">` with `<source>`s from
  `resolveSources()`: archive.org, then `/mirror/<fileHash>` (the browser tries
  the next source if the first fails); a repaired show gets the mirror only.
  Nothing is fetched until someone presses play. These plays are not counted
  in the stats (no script runs).
- **Open in High Desert** goes to `/library?show=<communityKey>`, a library
  intent (`src/lib/library/intents.ts`): the library selects the show once it
  holds it, scrolls to its row if it is visible, and says "That show is not in
  this library." if seeding settles without it. An invalid key is ignored.
- **Related lists** (`src/lib/shows/related.ts`): more with the same guest (8),
  the same month and day in other years (8), the same category nearest in time
  (6, none for "Other"). No show twice, never the page itself, every entry a
  real page. Every show in the catalog has at least one.
- **Names.** Titles come from `episodeTitle()`, guests from `shownGuest()`,
  topics from `shownTopic()`. `guestPeople()` (`src/lib/shows/people.ts`) splits
  the free-text guest field into people only when every part looks like a
  name ("Terry and Linda Jamison" is two Jamisons; "Euthanasia & Immigration"
  is nobody). A wrong Person in structured data is worse than none.
- **Class hooks** for the preview looks: `hd-show-page`, `-header`, `-brand`,
  `-nav`, `-main`, `-crumbs`, `-article`, `-series`, `-title`, `-with`,
  `-meta`, `-player`, `-audio`, `-open`, `-archive`, `-summary`, `-tags`,
  `-tag`, `-related`, `-related-group`, `-related-title`, `-list`,
  `-list-item`, `-list-link`, `-guest`, `-footer`. Restyle them under
  `html[data-look="clean"|"win98"]`.
- The library's episode panel has a **Show page ↗** link (new tab, so the
  player keeps playing) for catalog shows, through `/show/key/<key>`.

## Head

`src/lib/shows/metadata.ts`:

- `<title>`: `Area 51 with John Lear and Bob Lazar · Coast to Coast AM,
  December 12, 1992 | High Desert` (the root template adds the suffix).
- description: programme and date, then the AI summary, clipped to 160
  characters at a word.
- canonical `/show/<slug>` (absolute through `metadataBase`), Open Graph
  (`article`, `publishedTime`, `og:audio`), Twitter `summary_large_image`.
- **Share image:** `src/app/show/[slug]/opengraph-image.tsx` (and
  `twitter-image.tsx`) draws a 1200x630 card with `next/og` from
  `ShowCard` (palette from `src/lib/palette.ts`): programme and date, the
  subject, the guests, the category. Guest pages have their own.

### Rendered on demand

- **Pages** (show and guest) export `generateStaticParams()` returning `[]` with
  `dynamicParams` on: nothing is rendered at build time; each page is rendered
  on its first request (30 to 90 ms measured) and then served from Next's cache
  (`x-nextjs-cache: HIT`, `Cache-Control: s-maxage=31536000`) until the next
  deploy. Static, not dynamic, on purpose: a dynamic page streams its metadata
  to non-crawler user agents, and link-preview services must find the tags in
  `<head>`. **Disk:** about 175 KB per cached page (HTML, RSC, segments) in
  `.next/server/route-cache/`, so roughly 280 MB once every page has been
  crawled, per build (`.next.prev` keeps the previous one).
- **Share cards** are drawn per request (about 0.1 s, a ~50 KB PNG) and sent
  with `Cache-Control: public, max-age=604800, stale-while-revalidate=86400`
  (`CARD_CACHE_CONTROL`), so browsers and preview services keep them a week;
  none is drawn at build time or stored on disk.

The build does not grow with the catalog: static generation stayed at 37
routes, in 1.6 s.

## Structured data

`src/lib/shows/jsonld.ts`, two `<script type="application/ld+json">` blocks per
show page:

```json
{
  "@context": "https://schema.org",
  "@type": "PodcastEpisode",
  "@id": "https://highdesert.space/show/1992-12-12-area-51-john-lear-bob-lazar#episode",
  "url": "https://highdesert.space/show/1992-12-12-area-51-john-lear-bob-lazar",
  "name": "Area 51 with John Lear and Bob Lazar",
  "description": "John Lear and Bob Lazar discuss Area 51, alleged secret government UFO programs, ...",
  "datePublished": "1992-12-12",
  "inLanguage": "en",
  "isAccessibleForFree": true,
  "image": "https://highdesert.space/show/1992-12-12-area-51-john-lear-bob-lazar/opengraph-image",
  "partOfSeries": { "@type": "PodcastSeries", "@id": "https://highdesert.space/#series-coast",
                    "name": "Coast to Coast AM with Art Bell", "creator": { "@type": "Person", "name": "Art Bell", ... } },
  "creator": { "@type": "Person", "name": "Art Bell", "sameAs": "https://en.wikipedia.org/wiki/Art_Bell" },
  "actor": [ { "@type": "Person", "name": "John Lear", "url": "https://highdesert.space/guest/john-lear" },
             { "@type": "Person", "name": "Bob Lazar", "url": "https://highdesert.space/guest/bob-lazar" } ],
  "duration": "PT2H9M58S",
  "genre": "UFOs & Aliens",
  "keywords": "area 51, ufos, government conspiracy, bob lazar, extraterrestrial",
  "associatedMedia": { "@type": "AudioObject", "contentUrl": "https://archive.org/download/...",
                       "encodingFormat": "audio/mpeg", "duration": "PT2H9M58S", "contentSize": "23473241 B" },
  "publisher": { "@type": "Organization", "name": "High Desert", "url": "https://highdesert.space" }
}
```

plus a `BreadcrumbList` (High Desert › Library › the show). Guest pages carry a
`CollectionPage` about the Person with an `ItemList` of their shows, and a
breadcrumb. The programme is the title's prefix: Coast to Coast AM, Dreamland,
Midnight in the Desert (filed as `special` in the catalog), else Art Bell
Specials. Google shows no podcast rich result any more; this is for
understanding (and breadcrumbs, which it does show).

`scripts/lib/jsonld-check.mjs` validates it: every property must belong to the
node's schema.org type (with its ancestors), and the required ones must be
present and well formed (ISO date and duration, absolute URLs, `audio/mpeg`,
breadcrumb positions in order). Unit tests run it over every show and guest;
the crawler runs it on the served pages.

## Sitemap and robots

`src/app/sitemap.ts` keeps the five app routes and adds every show and guest
page (no `lastModified` on those: a 1997 broadcast has no date worth
claiming). `public/robots.txt` disallows `/api/`, `/scanner`, `/search` and
`/look`.

## Checks

- **Unit tests:** `src/lib/shows/__tests__/` (slugs, people, naming,
  related, JSON-LD, metadata, verification), `src/components/shows/__tests__/`
  (the page's markup for every show: one h1, both JSON-LD blocks, every
  internal link resolves, no em dash; the boot-screen rule; the library link),
  `src/app/show/key/[key]/__tests__/` (the redirect),
  `scripts/__tests__/seo-page.test.ts` (the crawler's rules, the sitemap,
  robots).
- **`npm run check:seo -- <baseUrl>`** (`scripts/seo-check.mjs`): robots,
  sitemap (every catalog show listed), then 25 show pages spread evenly through
  the slugs plus edge cases (no guest, several guests, Dreamland, a special,
  Midnight in the Desert, no summary, no duration) and 4 guest pages, fetched
  as raw HTML with a browser's user agent and parsed without running scripts.
  Fails on any page not 200; a missing title, description, canonical,
  `og:title`/`og:description`/`og:image`/`og:url` or `twitter:card`; JSON-LD
  that does not parse or is not valid schema.org; the page not being in the
  server HTML; the boot screen not hidden; an em dash; any internal link that
  does not answer 200; a share image that is not 200 `image/png` or is cacheable
  for less than a day. Also checks
  `/show/key/<key>` redirects and an unknown slug is a 404.
  CI's browser job runs it after the CSP check, against the same server.
  Run it against production after a deploy: `npm run check:seo -- https://highdesert.space`.
- **The crawler also covers** (2026-10-12) every topic, `/topics` and today's
  Tonight in the sitemap; 6 topic pages plus Mel's Hole; today's and the
  oldest Tonight page; `/tonight` a 307 that is not cacheable; one moment
  (`?t=` = half the show): canonical the show, og:url the moment, the moment's
  card, `#t=` on the sources, `data-moment`, Open carrying `t`, `no-store`,
  while the plain page keeps `s-maxage`; `?t=1h`, `?t=1000000` and a `t` past
  the end are the plain page; the internal moment path is a 308; 404s for an
  unknown topic, a day before the station and 2026-02-30. On every page: the
  intro and its two ways in, and on show pages the Play button and the
  `<noscript>` rule that hides it.
- **Growth tests:** `src/lib/topics/__tests__/topics.test.ts`,
  `src/lib/tonight/__tests__/tonight.test.tsx` (Tonight, and every topic page
  rendered), `src/lib/shows/__tests__/share-moment.test.ts`,
  `src/hooks/__tests__/requested-start-play.test.ts` (the real
  `playEpisode`), the moment case in `src/hooks/__tests__/library-intents.test.tsx`,
  `src/app/api/shows/link/__tests__/`, `e2e/share-moment.spec.ts`.
- **Mutations:** the `show-*`, `guest-people-*`, `related-*`, `jsonld-*`,
  `site-verification-*`, `seo-check-*`, `sitemap-*`, `robots-*`,
  `intent-show-*`, and (2026-10-12) `topic-*`, `tonight-*`, `moment-*`,
  `requested-start-*`, `share-*`, `seo-*` ids in `scripts/mutate-check.mjs`.
- `scripts/csp-check.mjs` loads one show page too.

## Sharing (2026-10-12)

- **Share sends the show's page.** `EpisodeShareButton` shares
  `/show/<slug>` once it knows the slug, and the old `/library?ep=<key>` link
  until then or for a show with no page. Old `?ep=` links keep working
  (the library still reads them). The slug map stays on the server: the
  browser asks **`GET /api/shows/link?key=<communityKey>`** →
  `{slug, path}` (cached a day; 404 `{error: "not-a-show"}` cached an hour;
  400 for a malformed key), once per show per page load, when the button
  mounts (`src/hooks/useShowSlug.ts`), so the share sheet opens inside the tap.
- **Share this moment** (`src/components/share/ShareMomentButton.tsx`) is in
  both looks' players: Win98's `WinampPlayer` (phone expanded row, desktop
  details row) and Night's `AudioPlayer` (phone expanded, desktop mini and
  expanded). It shares `/show/<slug>?t=<seconds>` (the current position, read
  at the tap), through `navigator.share`, else the clipboard ("Link copied:
  starts at 1:23:45"), else a toast with the link (`share-link.ts`). Closing the
  sheet copies nothing. Before the slug has arrived it shares
  `/show/key/<key>?t=`, which redirects to the same URL. No button for a show
  with no page.
- **A moment's page.** `next.config.ts` rewrites `/show/:slug` with a `t` of 1
  to 5 digits to `/<look>/show/:slug/moment/:t` (before the look rewrites),
  so the plain show page stays static whatever query it is asked with
  (`?t=abc` is the cached plain page). The moment page is `force-dynamic`:
  one cached file per second of every show would fill the disk. The internal
  path is 308'd back to `?t=` by `src/proxy.ts`: one address per moment. A `t`
  at or past the show's end renders the plain page (`validMoment`).
- **Measured on a local build** (2026-10-12): `/show/<slug>` is
  `s-maxage=31536000` (MISS, then HIT); `?t=5025` is `private, no-cache,
  no-store, max-age=0, must-revalidate`, with the moment's title, og:url and
  card in `<head>` for both a browser and `facebookexternalhit`; `?t=abc` is
  the static HIT; the moment card is 200 `image/png`, cached a week.
- **What the moment page says.** Canonical: the plain show page. og:url: the
  moment's URL. Title: "…, from 1:23:45". Card:
  `/show/<slug>/moment/<t>/opengraph-image` (and `twitter-image`), the show's
  card with a "Starts at 1:23:45" stamp (`momentCard`). The body says "This
  link starts at 1:23:45" with a "Play it from the beginning" link.
- **Plays from t without JavaScript:** each `<source>` carries a `#t=<t>`
  media fragment. With JavaScript, the page's **Play** button
  (`ShowPlayButton`) plays the same element and seeks once on
  `loadedmetadata`.
- **Open in High Desert** carries it: `/library?show=<key>&t=<seconds>` (`t`
  means nothing without `show`). Once the library holds the show,
  `startMoment()` (`src/hooks/library/useLibraryIntents.ts`) records
  `requestStartAt(fileHash, t)` (`src/audio/requested-start.ts`, one request,
  one show, consumed by its next start) and, **only if
  `navigator.userActivation.isActive`** (unknown counts as yes, as the
  watchdog's retry does), emits `play-episode` with surface `show`. Without a
  live gesture nothing starts: a `play()` would be refused and read as a
  failure. It says "Press play to start at 1:23:45." and the show's ▶ starts
  there. `playEpisode()` reads it synchronously: `liveStartFor() ??
  takeRequestedStart() ?? startPositionFor()`, so the station still owns its
  playhead and nothing is awaited before `play()`.

## First screens (2026-10-12)

Show, guest, topic and Tonight pages are the first screen for anyone from a
search or a shared link, in both looks (`src/styles/show-pages.css` plus the
looks' own `hd-show-*` rules).

- `ShowShell` header: Live, Library, Tonight, Topics. Under it, one line on
  what High Desert is (`siteIntro`, with the catalog count) and two ways in:
  **Listen to the station now** (`/live`) and **Browse the Library**. Footer
  links the same.
- Show page: the player first, with a one-tap **Play** (`ShowPlayButton`,
  hidden by a `<noscript>` rule, so without JavaScript the native controls are
  the player); then the summary, the facts (the category links to its topic),
  **Topics** (up to 8, most specific first), then the related lists.
- Guest page: a **Start with** link to the guest's first notable show (else
  the newest), "Search the library", and "{Name} talked about" (the topics
  most of their shows fall under).
- New class hooks: `hd-show-intro`, `-intro-text`, `-ways`, `-way`,
  `-way-live`, `-way-library`, `-play`, `-moment`, `-topics`, `-topic`,
  `-category-link`, `-footer-nav`, `-nav-link`; `hd-topic`, `-intro`,
  `-first`, `-start`, `-related`, `-links`, `hd-topics-index`; `hd-guest-first`;
  `hd-tonight`, `-intro`, `-tune`, `-days`, `-program`, `-lineup`, `-slot`,
  `-kind`, `-show`, `-why`, `-none`, `-dated`; `hd-share-moment`.

## Topic pages (2026-10-12)

**The rule** (`src/lib/topics/rules.ts`, `deriveTopics`), over the catalog's
rows with show pages:

1. **Every category** (`aiCategory`) but `Other` (15).
2. **Curated subjects** (`SUBJECTS`, 29): the famous ones a listener searches
   for by name (Mel's Hole, Area 51, Roswell, the Phoenix Lights, remote
   viewing, Hale-Bopp, Y2K, Ghost to Ghost, …). Each is a phrase pattern
   matched against title, topic, guest, summary and tags (`matchText`), so it
   finds shows its tag missed (Mel's Hole finds Mel Waters' first appearance).
   A subject replaces the tags it names (`tags`).
3. **Tags carried by at least `TAG_MIN` (10) shows**, after folding synonyms
   (`TAG_SYNONYMS`), except a generic tag (`GENERIC_TAGS`: "paranormal",
   "interview"…), a tag a category already is (`TAG_COVERED_BY_CATEGORY`), a
   person (`PERSON_TAGS`) or a tag a subject covers. Each needs a display name
   in `TAG_NAMES` (26): **a tag that crosses the threshold fails the topics
   test until someone names it or calls it generic**: a new page is a
   decision, not a default.
4. Every topic needs at least `TOPIC_MIN` (3) shows.

Today: 70 topics (29 subjects, 15 categories, 26 tags).

- **Slugs are permanent**, like shows': `data/topic-slugs.json` (topic id →
  slug, ids like `subject:mels-hole`, `category:UFOs & Aliens`, `tag:mars`) is
  committed and add-only. After a catalog change run
  `node scripts/gen-topic-slugs.mjs` (`--check` exits 1 when one is missing);
  it never rewrites an entry. A leading "The" is dropped; collisions take
  `-2`; a retired topic's slug is never reused. `topics.test.ts` fails on a
  missing slug, a duplicate, or any committed slug that changed (every git
  version of the file).
- **The page** (`/topic/<slug>`, `TopicView`): the name, a one-line intro, the
  count and years, **Start with** (a notable show, else the newest), **Start
  here** (up to 4 notable shows with the cited reason), every show newest
  first, related topics (sharing at least 2 shows, scored by overlap). JSON-LD
  `CollectionPage` (with an `ItemList` of the show pages) and
  `BreadcrumbList`; canonical, Open Graph, a card ("ART BELL ON" + name).
  `/topics` lists every topic by kind. Rendered on first request, cached
  until the next deploy, like show pages.
- **Linked from** each show page (Topics), the category fact, guest pages,
  the header and the sitemap.

## Tonight (2026-10-12)

`/tonight/<yyyy-mm-dd>` is one station day (midnight to midnight Pacific),
`/tonight` a 307 to today's.

- **Read-only.** `src/services/live/tonight.ts` reads the day and its
  neighbours from `live_days`. The one write is the station's own: today is
  frozen (`frozenDay`) if no listener has done it yet. No other day is ever
  frozen from here.
- **Which days:** a real date from `FIRST_TONIGHT_DAY` (2026-09-01) to
  tomorrow, and tomorrow only once its program is frozen; with a database, a
  past day without a program is a 404.
- **Without `DATABASE_URL`** (or with it failing) the page still renders: the
  date's broadcasts from the catalog and a line saying the program cannot be
  read.
- **The page** (`TonightView`): a big **Tune in to the station now** (`/live`),
  the program in air order with each time in Pacific and, after hydration, in
  the reader's own zone (`LocalTime`), the slot's kind ("On this date",
  "Listener favorite"), and why to hear it (the cited notable reason, else the
  summary); then every broadcast of the date in other years; links to the
  neighbouring days that exist. JSON-LD `CollectionPage` + `BreadcrumbList`,
  a card per day ("N broadcasts from October 12"). `revalidate` 3600.
- **Sitemap:** every station day, from the first in `live_days` (2026-09-11,
  `FIRST_STATION_DAY`; frozen days are never deleted) to today
  (`tonightSitemapDays`). Until 2026-10-15 it was only the last 14, which left
  21 working pages out. `check:seo` fails on a gap, and fetches the oldest.

## Search Console

**Done, 2026-10-15:** verified as a Domain property by the DNS TXT record
(way A below), at Hostinger's DNS, and `sitemap.xml` submitted. Kept honest by:

- `highdesert-status`'s `search` line: WARN if the `google-site-verification`
  TXT record disappears or is not the token in
  `deploy/google-site-verification.txt` (Google re-checks it; the property
  lapses without it), or if DNS cannot be read;
- `check:seo`: robots.txt names the sitemap, and the sitemap lists every show
  and topic in the catalog, the Request Line, `/topics` and every station day
  without a gap (guest pages are counted; `seo-page.test.ts` holds the guest
  list to the catalog);
- the digests of 2026-11-02 and 11-09: a reminder to screenshot the Pages
  report for a session to read.

What follows is how it was set up, kept for a re-verification.

Two ways, pick one.

**A. Domain property (recommended: covers http, https and every subdomain).**

1. Open <https://search.google.com/search-console>, signed in as the owner.
2. Property menu (top left) → **Add property** → **Domain** → enter
   `highdesert.space` → **Continue**.
3. Copy the TXT record it shows (`google-site-verification=...`).
4. At the DNS host for highdesert.space (Hostinger hPanel: **Domains** →
   highdesert.space → **DNS / Nameservers** → **DNS records**), add a record:
   type **TXT**, name **@**, value the copied text, default TTL → **Add record**.
5. Back in Search Console → **Verify**. DNS can take minutes to a few hours;
   if it fails, wait and press Verify again.

**B. URL-prefix property with the meta tag (no DNS change).**

1. Search Console → **Add property** → **URL prefix** → `https://highdesert.space/`
   → **Continue** → **HTML tag** → copy only the `content="..."` value.
2. On the VPS: add `GOOGLE_SITE_VERIFICATION=<that value>` to
   `/root/.high-desert.env` (chmod 600 already).
3. Redeploy: `bash scripts/deploy.sh`. The tag is baked in at build time
   (`src/lib/seo/verification.ts`); deploy.sh reads that one variable from the
   env file for the build. Absent or malformed means no tag.
4. Confirm: `curl -s https://highdesert.space/ | grep -o 'google-site-verification[^>]*'`.
5. Search Console → **Verify**.

**Then, either way:**

1. **Indexing → Sitemaps** → "Add a new sitemap": `sitemap.xml` → **Submit**.
   It should report about 1,600 discovered URLs (5 app routes, 1,413 shows,
   the guest pages).
2. **URL Inspection** (search bar at the top): paste a show URL, e.g.
   `https://highdesert.space/show/1992-12-12-area-51-john-lear-bob-lazar` →
   **Test live URL** (the rendered HTML, the page resources and "Breadcrumbs"
   under Enhancements should all be green) → **Request indexing**. Do it for a
   handful of well-known shows; the sitemap brings the rest over days to weeks.
3. After a week or two: **Pages** (indexing report) for how many are indexed
   and why any are not, and **Enhancements → Breadcrumbs**.
