# High Desert handoff, 2026-10-12: categories for the community shows

Status: **shipped** (see "Ship" at the end).

## What you asked

1. Categorize the 101 community rows in this session, without an API key:
   use the catalog's category list and the categorizer's rules, log every
   assignment in `docs/community-sources.md`, get the categories into
   libraries that already exist, and bump `SEED_VERSION`.
2. Keep "right now" in the slow-archive notice.

## 1. The 101 categories

- **How:** each show was read by title, guest and topic. Each got one category
  from `CATEGORIES` in `scripts/categorize-library.py`, under that script's
  rules: the most specific category that fits, "Open Lines" for call-in nights,
  "Other" only when nothing fits, and Halloween and Ghost to Ghost shows as
  Paranormal & Ghosts.
- **Precedent:** where the catalog already had the same guest or subject, I
  followed its majority. For example, Michio Kaku has 18 of 22 shows in
  Science & Physics, and Bigfoot shows are Cryptozoology. A themed call-in
  night ("Open Lines: Pact with the Devil") stays Open Lines, as 90 of the
  catalog's 104 Open Lines titles already do.
- **Result:**

  | Category | Shows |
  |---|---|
  | UFOs & Aliens | 19 |
  | Open Lines | 19 |
  | Paranormal & Ghosts | 12 |
  | Psychology & Consciousness | 8 |
  | Cryptozoology | 7 |
  | Technology & Invention | 6 |
  | Science & Physics | 5 |
  | Space & Astronomy | 5 |
  | Other | 5 |
  | Religion & Spirituality | 4 |
  | Conspiracy & Government | 3 |
  | Earth Changes & Environment | 3 |
  | Health & Medicine | 2 |
  | Crime & Mystery | 2 |
  | Ancient Mysteries | 1 |

  Every seed row now has a category.
- **Two to check by ear:**
  - 2015-10-27, Tish Owen: no topic, and I could not identify the guest. It
    is filed as Other.
  - 1997-02-19, Strange Universe: the TV show mixed UFOs and the paranormal.
    It is filed as Paranormal & Ghosts.
- **The log:** every assignment, with a one-line reason, is in
  `docs/community-sources.md` under "Categories, assigned by hand". The same
  list is in `data/community-categories.json`, and a test holds the seed, the
  list and the doc's table equal.
- **Only the category was assigned.** These rows still have no summary or
  tags, and their `aiStatus` is still `pending`. Nothing reads that field
  any more.

## 2. Existing libraries

- **Why the bump alone was not enough:** bumping `SEED_VERSION` (now
  `2026-10-12-a`) re-runs reconcile. Reconcile only adds rows that are
  missing and never changes one that exists, so on its own the bump would
  not have categorized anything a visitor already had.
- **The new refresh:** `refreshCatalogCategories()` in
  `src/db/catalog-flags.ts`, modeled on the notable refresh:
  - it sets `aiCategory` on a listed row only where the row has none, so a
    category set by hand is kept;
  - it never touches another field and never adds or deletes a row;
  - it runs once per `CATEGORIES_VERSION`, under the seed lock, in one
    transaction;
  - the layout calls it right after the notable refresh.
- **Tests:** `src/db/__tests__/community-categories.test.ts` runs it against
  the real catalog on fake-indexeddb, with user data on the listed rows. It
  checks every field of every row before and after, and checks that a
  category set by hand survives, the run-once gate, and the layout wiring.
- **Mutations:** four (`categories-refresh-*`), all red.
- **Full suite** (in a worktree with the chat service's dependencies
  installed): 215 files, 2,057 tests passed.

## 3. The slow-archive notice

Kept as it is: "archive.org is slow right now. Playing from the High Desert
mirror." Nothing changed.

## Hook blocks this session

None.

## Ship

- **PR:** one PR, from `session/2026-10-12-categories`.
- **Deploy:** `deploy.sh` under `heavy -- nice -n 10 ionice -c2 -n7`. The
  mirror and the chat did not change.
- **This folder:** the handoff, `community-sources.md` with the full
  assignment log, and a phone screenshot of the library after the deploy.
