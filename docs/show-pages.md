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
| `/show/key/<communityKey>` | `/show/key/ultimate-ultimate-art-bell-collection--1992-12-12_-_...` | 308 to the show's page; what the library links to |

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
- **Mutations:** the `show-*`, `guest-people-*`, `related-*`, `jsonld-*`,
  `site-verification-*`, `seo-check-*`, `sitemap-*`, `robots-*` and
  `intent-show-*` ids in `scripts/mutate-check.mjs`.
- `scripts/csp-check.mjs` loads one show page too.

## Search Console

The site side is ready; nothing is verified yet. Two ways, pick one.

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
