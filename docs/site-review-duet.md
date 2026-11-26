# Site review: highdesert.space vs the repo

Checked 2026-11-26 by Duet. Live site loaded in a browser at 1366 px and at 500 px wide (welcome, the
library and its Explore panel, Live, Request Line, a show page, a guest page, `/shows` and a year page,
the 404, robots.txt and the manifest); repo read at main at `af6b7d4` (2026-11-26 19:35 UTC). No
build or tests were run here: this is a reading of the live site and the source.

**Live vs repo:** they match. The welcome copy, the show and guest pages, the `/shows` archive, the
Request Line note and the manifest live are what `af6b7d4` renders, and the seed catalog live
(`/seed/library.json`) has the same 1,412 episodes as `public/seed/library.json`. Nothing found live
is missing from the repo. Every fix below is a content, data or CSS change for the next normal deploy.
None of them touches the open NEXT items (the mutation timer, the playsBySurface Search Console check,
or the phone look split, whose verdict waits until 2026-12-02).

Fixes, best first. Each has what is wrong, where, and the exact change.

## 1. "Source: archive.org" in the About box goes to a dead item

- **What:** the About dialog's only outside link, the credit for where every show comes from, opens
  archive.org's "Item cannot be found." page (checked live 2026-11-26). The identifier
  `artaborneradio` does not exist. The catalog's own data names the real items: 1,312 of the 1,412
  episodes come from `ultimate-ultimate-art-bell-collection`, 98 from
  `Art-Bell_Midnight_In_the_Desert`, and one each from `art-bell-2001-to-2010` and
  `art-bell-1990-2000`. `https://archive.org/details/ultimate-ultimate-art-bell-collection` loads
  (checked 2026-11-26).
- **Where:** `src/components/desktop/AboutDialog.tsx:181`.
- **Change:**
  ```tsx
  href="https://archive.org/details/ultimate-ultimate-art-bell-collection"
  ```
  Keep the link text "Source: archive.org". Better still, read the identifier from the catalog (the
  most common `archiveIdentifier`) so it cannot drift, but the one-line fix is enough.

## 2. "Thousands of episodes" sits right above "1,412 EPISODES IN ARCHIVE"

- **What:** the welcome page says "Stream thousands of episodes" and, two lines below, shows the
  real count, 1,412. The same "thousands" is in the page description, the Open Graph and Twitter
  cards, the JSON-LD and the PWA manifest, so it is also what search results and the install sheet
  show. 1,412 is not thousands, and the page contradicts itself on its first screen.
- **Where:** `src/app/[look]/page.tsx:171`; `src/app/[look]/layout.tsx:37`, `:65`, `:78`, `:88`;
  `src/app/[look]/(desktop)/library/layout.tsx:16`; `public/manifest.json:4`.
- **Change:** say "over 1,400" (true today and for a while as the catalog grows), for example
  ```tsx
  Stream over 1,400 episodes from the golden age of late-night talk radio.
  ```
  ```ts
  description: "Art Bell Radio Archive. Late night talk radio from the Kingdom of Nye. Stream over 1,400 Coast to Coast AM, Dreamland, and special episodes.",
  ```
  and the same swap in the other five places ("Search over 1,400 ..." in the library layout). Or
  build the number from the seed at build time (`Math.floor(count / 100) * 100`), so it never goes
  stale. Run `npm run check:seo` after; it reads descriptions but does not pin this word.

## 3. A quote is shown as Art Bell's with no source

- **What:** the welcome page and the About dialog both show, in quote marks, "I have seen things that
  I cannot explain..." under Art Bell's name and dates. Nothing in the repo says where it is from (no
  show, no date, no note), and I could not tie it to a show in the catalog. An archive of a real
  person's work should not put words in his mouth; listeners who know the shows will notice.
- **Where:** `src/app/[look]/page.tsx:178`; `src/components/desktop/AboutDialog.tsx:144`.
- **Change:** if the source is known, add it under the quote and link the show page, for example
  ```tsx
  <div className="...">&ldquo;...&rdquo;</div>
  <Link href={showPath(slug)} className="text-hd-9 text-bevel-dark">Coast to Coast AM, <date></Link>
  ```
  If it is not, drop both quote blocks. The welcome page already has the description and the count;
  the About box has the credits.

## 4. Guest pages: show titles counted as guests, and one person split in two

- **What:** a few episodes carry a show title in `guestName`, so the library offers "View guest
  profile: Spooky Matter", and `/guest/spooky-matter` is the 404 ("Signal Lost"). Two guests are split
  across spellings, so each guest page shows only part of their shows.
  - Not people: "BIG UFO Disclosure Show" (1998-01-05), "The September 11, 2001 Show" (2001-09-11),
    "Spooky Matter" (2013-10-31), "Art Calls into the Gabcast" (2013-11-12), and probably
    "Ghost Buster Gals".
  - Split: "Robert Ghost Wolf" (6 shows) and "Robert Ghostwolf" (3); "Robert Morningsky" (3) and
    "Robert Morning Sky" (1).
- **Where:** `public/seed/library.json:9950`, `:20865`, `:35407`, `:35596`, `:35623` (the
  `guestName` lines), and the spelling variants in the same file; `src/lib/shows/slugify.ts:57`
  (`guestSlug`).
- **Change:** in the seed, set `guestName` to `null` (or the real guest, where the show has one) for
  the four show-title entries, and keep the title in `title` where it already is. For the spellings,
  add an alias map next to `stripHonorific` so both forms land on one page:
  ```ts
  const GUEST_ALIASES: Record<string, string> = {
    "robert ghostwolf": "Robert Ghost Wolf",
    "robert morning sky": "Robert Morningsky",
  };
  export function canonicalGuest(name: string): string {
    const n = stripHonorific(name);
    return GUEST_ALIASES[n.toLowerCase()] ?? n;
  }
  export function guestSlug(name: string): string {
    return slugify(canonicalGuest(name), 80);
  }
  ```
  Use `canonicalGuest` wherever a guest's display name is built, then regenerate the sitemap. Also
  make the library hide "View guest profile" when the guest has no page, so a bad row cannot link to a
  404 again.

## 5. The "on archive.org" link on show pages has raw spaces in it

- **What:** `archiveDetailsUrl` appends the episode's `fileName` to the URL without encoding it. File
  names have spaces (for example "1992-12-12 - Coast to Coast AM with Art Bell - Area 51 - John Lear -
  Bob Lazar.mp3", some with double spaces), and some have `&` or `'`, so the live show page's href is
  not a valid URL. Browsers patch raw spaces up, but crawlers and link checkers may not.
- **Where:** `src/lib/library/episode-detail.ts:136-139`.
- **Change:**
  ```ts
  export function archiveDetailsUrl(episode: Episode): string | null {
    if (!episode.archiveIdentifier) return null;
    const file = episode.fileName ? `/${encodeURIComponent(episode.fileName)}` : "";
    return `https://archive.org/details/${episode.archiveIdentifier}${file}`;
  }
  ```
  The existing tests use `a.mp3` (`src/lib/library/__tests__/episode-detail.test.ts:108`) and still
  pass; add one with a space and an `&` in the name.

## 6. The archive pages are titled "High Desert - Topic" in the win98 look

- **What:** `/shows` and `/shows/<year>` reuse the topic article classes, so in the win98 look their
  title bar reads "High Desert - Topic". They are the archive, not a topic. On a year with one show the
  line under the heading also reads "1 show from 1992 in the archive, in the order they aired."
- **Where:** `src/styles/show-pages.css:88-90`; the classes `hd-shows-index` and `hd-shows-year` in
  `src/components/shows/ShowsArchive.tsx`; the line at `src/components/shows/ShowsArchive.tsx:73`
  (and the description at `src/app/[look]/shows/[year]/page.tsx:27`).
- **Change:** after the topic rule in `show-pages.css`:
  ```css
  html[data-look="win98"] .hd-show-article.hd-shows-index::before,
  html[data-look="win98"] .hd-show-article.hd-shows-year::before {
    content: "High Desert - Archive";
  }
  ```
  and for one show:
  ```tsx
  {n === 1 ? `The one show from ${year.year} in the archive.` : `${n} shows from ${year.year} in the archive, in the order they aired.`}
  ```

## 7. Request Line gives the show time with no time zone

- **What:** the Live note reads "Tonight's request at 8 PM. 1 show in the running, vote by 6 PM
  Pacific." The vote deadline says Pacific; the show time does not, so a listener in New York reads
  8 PM as their own time. The locked and fan favorite lines have the same gap.
- **Where:** `src/lib/live/request-line.ts:50-66` (`tonightsRequestText`).
- **Change:** add " Pacific" after every `pacificHourLabel(...)` in that function:
  ```ts
  const at = `${pacificHourLabel(note.startsAt)} Pacific`;
  ```
  and the same in the `locked` and `favorite` cases. Update the three expected strings in
  `src/components/request-line/__tests__/live-request-note.test.tsx:146-148` and the one in
  `request-line-page.test.tsx:110` ("a fan favorite plays at 10 PM Pacific"). If the vote line then
  reads "Pacific" twice, drop it from `by` and keep it on the first time only.

## 8. On desktop the On This Day box is 120 px tall

- **What:** at 1366 x 860 the library's Explore panel shows the On This Day window cut short: the
  second card's text is clipped and the third is out of sight inside a tiny scroll box that few people
  will find. The cause is the window's own cap: 200 px on phones but 120 px from `md` up.
- **Where:** `src/components/library/OnThisDay.tsx:68`.
- **Change:**
  ```tsx
  <div className="p-2 flex flex-col gap-1 max-h-[200px] md:max-h-[220px] overflow-auto overscroll-contain">
  ```
  Check at 1366 x 860 and 1280 x 720 that three cards show whole and the episode list below still
  starts above the fold.

## 9. The home screen icon is a plain disc, and the install sheet has no screenshots

- **What:** `icon-512.png` and `apple-touch-icon.png` are a gold disc on navy with no mark or letters,
  so on a home screen it reads as a blank dot. The same file is listed as both `any` and `maskable`,
  and a maskable icon needs its art inside the central safe zone. The manifest also has no
  `screenshots`, so Chrome's install sheet is the small plain dialog, though
  `public/screenshots/desktop-library.png` and `mobile-library.png` are already in the repo.
- **Where:** `public/manifest.json:17-31`; `public/icons/icon-512.png`; `public/apple-touch-icon.png`.
- **Change:** draw the moon over a simple desert ridge line (the OG card's moon is the start) and
  export `icon-512.png`, a separate `icon-maskable-512.png` with the art inside the middle 80 percent,
  and `apple-touch-icon.png`. In the manifest:
  ```json
  { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ```
  and add:
  ```json
  "screenshots": [
    { "src": "/screenshots/desktop-library.png", "sizes": "<w>x<h>", "type": "image/png", "form_factor": "wide", "label": "The library" },
    { "src": "/screenshots/mobile-library.png", "sizes": "<w>x<h>", "type": "image/png", "label": "The library on a phone" }
  ]
  ```
  with the real pixel sizes of each file. Run `npm run check:csp` (the manifest is same-origin, so no
  CSP change is expected).

## 10. A show page's breadcrumb skips the archive

- **What:** a show page's breadcrumb is High Desert, Library, then the show. The `/shows` archive by
  year exists and is in the sitemap, but nothing on a show page links into it, and the breadcrumb
  JSON-LD tells search engines the same short path.
- **Where:** `src/lib/shows/jsonld.ts:102-108` (`showCrumbs`).
- **Change:**
  ```ts
  export function showCrumbs(show: Show): Crumb[] {
    const year = show.row.airDate?.slice(0, 4);
    return [
      { name: SITE_NAME, path: "/" },
      { name: "Every show", path: SHOWS_PATH },
      ...(year ? [{ name: year, path: showsYearPath(year) }] : []),
      { name: showSubject(show.row), path: showPath(show.slug) },
    ];
  }
  ```
  importing `SHOWS_PATH` and `showsYearPath` from `src/lib/shows/archive.ts`. Update the breadcrumb
  expectation in `src/lib/shows/__tests__/jsonld.test.ts:111`.

## 11. Optional: the seed catalog carries every URL twice

- **What:** `public/seed/library.json` is 2.04 MB raw (261 KB gzipped). In all 1,412 entries
  `filePath` repeats `sourceUrl`. Dropping it saves about 35 KB gzipped on a first visit: real but
  small, so only worth doing next to another seed change.
- **Where:** `public/seed/library.json`; every non-test reader of `filePath` in `src/` (`grep -rn filePath src --exclude-dir=__tests__`).
- **Change:** drop `filePath` from the seed and fall back to `sourceUrl` in the loader
  (`filePath ?? sourceUrl`), or map it once when the seed is loaded into Dexie.

## Checked and left as is

- robots.txt disallows `/api/`, `/scanner`, `/search` and `/look`, and lists the sitemap.
- Show and guest page titles and descriptions are specific and well formed ("Area 51 with John Lear
  and Bob Lazar · Coast to Coast AM, December 12, 1992 | High Desert").
- The site footer credits archive.org; only the About box link is broken (fix 1).
- The 404 page ("Signal Lost") works and offers a way back.
- The live station and Request Line answer; the vote deadline is shown in Pacific.
- PWA shortcuts in the manifest point at real routes.
- `check:seo`, `check:csp` and the mutation testing cover the code well; nothing here duplicates the
  open items in `docs/NEXT.md`.
- No em dashes in the copy read, and nothing points players at another app or brand.
