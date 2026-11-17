# The Library search

The search box (`src/lib/library/filter-episodes.ts`, `parseSearch`) takes
operators (`guest:`, `year:`, `tag:`, `has:`, `duration:`, `rating:` …) and
free text. Free text is an exact, case-insensitive substring match over the
file name, title, guest, topic, air date, description, category, series and
tags.

## Close spellings (2026-11-17)

Until 2026-11-17 a misspelt name found nothing at all: "Lazaar", "Hogland",
"Coast to Cost". `src/lib/library/fuzzy-search.ts` is the fallback.

- **Only when the exact match finds no row.** An exact hit is never outranked
  or joined by a guess, so every sort stays monotonic and every group header
  counts its rows (`sort-properties.test.ts`). The other criteria (show tabs,
  filters, operators) apply first, and the fallback searches what they leave.
- **Words, not substrings.** A show's words are those of its title, guest,
  topic, tags, category and series, lowercased with accents dropped. Not the
  description or the file name: matched loosely against a paragraph, a guess
  finds something for anything.
- **Every query word must be met** by one of the show's words: the same
  word, a word it begins, or one within `maxEdits` (an insert, delete,
  substitution or swap of two neighbours). Under 3 letters a word is ignored
  ("to", "of"); 3 letters must be exact or a prefix; 4 to 7 letters may be 1
  edit away; 8 and up, 2.
- **"Did you mean" says what the results say.** For each query word that the
  results spell differently, the spelling carried by the most matching shows
  (then the nearest) is offered. The note above the list (`SpellingNote`)
  reads "No exact match for "…". Showing close spellings." and its button puts
  the corrected search in the box, operators kept as typed
  (`correctedSearch`). A word still being typed (a prefix) is never called a
  misspelling.
- When the fallback finds nothing either, the page says "No episodes
  matching" as before.

Tests: `src/lib/library/__tests__/fuzzy-search.test.ts` (the real catalog,
with a control that each misspelling has no exact match), and the free-text
block of `filter-episodes.test.ts`, which now asserts each of its matches is
exact. Mutations: `library-search-fuzzy-*`.
