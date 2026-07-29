# Handoff — branch cleanup and `deleteEpisode` coverage

**Date:** 2026-07-29
**Branch:** `main`. Push state is recorded at the bottom, from `git status` output, not from intent.

Follows `docs/handoff-2026-07-29-mutation-audit.md`. Three pieces of work: the mutation
audit table read back in full, branch cleanup, and the first item-B module — `deleteEpisode`.

---

## 1. The mutation audit, re-run

Re-run from a clean tree at the top of this session rather than quoted from the previous
handoff, so the table below is output rather than recollection.

```
[mutate-check] 18 mutation(s)
  red    duration-sanity          src/audio/__tests__/duration-sanity.test.ts
  red    watchdog-activation      src/audio/__tests__/playback-watchdog.test.ts
  red    viz-cycle                src/audio/visualizations/__tests__/registry.test.ts
  red    dedup-key                src/db/__tests__/deduplicate.test.ts
  red    reconcile-tombstones     src/db/__tests__/reconcile.test.ts
  red    global-install           src/hooks/__tests__/global-listeners.test.ts
  red    heartbeat-playing        src/hooks/__tests__/listening-heartbeat.test.ts
  red    restored-play-count      src/hooks/__tests__/play-reporting.test.ts
  red    prime-preload            src/hooks/__tests__/restore-play.test.ts
  red    file-size-floor          src/lib/utils/__tests__/format-size.test.ts
  red    retry-429                src/lib/utils/__tests__/retry.test.ts
  red    search-operator-strip    src/lib/utils/__tests__/search-parser.test.ts
  red    streak-today             src/lib/utils/__tests__/streak.test.ts
  red    filename-show-name       src/services/archive/__tests__/filename-parser.test.ts
  red    clear-field-delete       src/services/episodes/__tests__/clear-field.test.ts
  red    verification-marker      src/app/api/playback-event/__tests__/verification-marker.test.ts
  red    allowlist-gate           src/services/stats/__tests__/allowlist.test.ts
  red    catalog-key              src/services/stats/__tests__/catalog.test.ts

[mutate-check] all 18 mutations went red.
```

**Survivors: none.** The one finding was on the first pass and is closed:
`filename-show-name` survived because every fixture in `filename-parser.test.ts` named one
of the six shows in `SHOW_PATTERNS`, which overwrites `showName` with a clean label, so the
`with Art Bell` strip never executed. 0 of 1,312 catalog filenames reach it either — but
the parser also serves the local-file scanner and the archive.org import, where the
filename is whatever someone else named it.

### CI timing — decided, left serial

The run is ~3 minutes: 18 sequential `vitest` invocations, serial because parallel runs
would collide on the shared source files they mutate.

**It stays serial.** Grouping mutations by target file to run disjoint groups concurrently
would put shared-state reasoning inside the one tool whose entire value is being
trustworthy, and a concurrency bug there produces a green that means nothing — which is
the exact failure mode this codebase keeps hitting. Revisit at fifteen minutes, not three.

---

## 2. Branches

### Deleted — three, all provably merged

Ancestry re-confirmed with `git merge-base --is-ancestor origin/<b> main` in the same
command that did the delete, so the check could not go stale between the two.

| branch | tip | restorable by |
|---|---|---|
| `agent/review-and-update-phase-3-plan-md-implem` | `7889355560d2a70d5a3ad5299521d04c2354c9a9` | that SHA |
| `fix/responsive-resize-dvh` | `f2daa3134654146f9386f64f53580b08b6b7eb4e` | that SHA |
| `fix/library-wipe-recovery` | `3cbb38c585f9036f0f7f9233d05411b171fa106c` | that SHA |

Local and remote both gone. Only `fix/library-wipe-recovery` had a local branch.

### Kept, with a verdict — the two one-commit branches

**Neither is worth merging.** Note that `git diff --stat main...origin/<b>` is misleading
here: the three-dot form diffs against the merge base, which for a five-month-old branch
shows main's own work as if the branch removed it. The useful question is whether the
branch's single commit holds content main lacks.

**`self-host` @ `dd38149`** — "chore(deps): Next.js 16.2.2 -> 16.2.12".
Its content is **already on main**: `package.json` reads `"next": "^16.2.12"` and
`"eslint-config-next": "^16.2.12"`. The bump was applied to main independently rather than
merged, which is why the branch is not an ancestor. Nothing to take. The commit message —
the advisory-surface analysis, and why the `music-metadata-browser` "fix" is a downgrade
rather than a fix — is the only thing on it with residual value, and it is preserved here
by reference.

**`agent/audit-and-update-dependencies-for-next-j` @ `2d9d054`** (2026-02-22) — "Update
dependencies for Next.js 16 and React 19 compatibility". Touches `package.json` only, and
is stale in three separate ways:

- It **reintroduces `@anthropic-ai/sdk`** (bumping it to `^0.75.0`). That dependency is
  gone from main — AI categorisation is offline-only now and ships as data in
  `public/seed/library.json`. Merging this would put an AI SDK back into the app.
- Five of its seven floor bumps are **already exceeded** by what is installed:
  eslint 9.39.2 (wants ^9.17.0), tailwindcss 4.1.18 (^4.0.1), typescript 5.9.3 (^5.7.2),
  @types/react 19.2.14 (^19.0.2), @tailwindcss/postcss 4.1.18 (^4.0.1).
- It deletes the trailing newline on `package.json`.

Only two floors are genuinely below the branch's ask: `zustand` (installed 5.0.11, branch
wants ^5.0.14) and `@types/node` (installed 20.19.33, branch wants ^22.10.2 — and the VPS
runs Node v22.23.1, so `@types/node: ^20` *is* a real mismatch worth fixing).
**Both are one-line edits to make directly on main**, not a reason to merge a branch that
also restores a removed dependency. Neither merged nor deleted, per instruction.

**`eevee/high-desert`** — untouched, as instructed. 292 commits. Not a stale branch.

---

## 3. `deleteEpisode` — item B, first module

`src/services/episodes/__tests__/delete-episode.test.ts`, 15 tests, end to end against
`fake-indexeddb`. Real database, real service functions, assertions on stored rows.

### What is proven

**The cascade, by what survives.** Every cascade test seeds a *neighbour* — another
episode with its own history row, bookmark and playlist membership — and asserts the
neighbour is intact afterwards. The incident here was blast radius, and a test that only
checks the target row is gone cannot see a cascade that took the whole table with it.

Also covered: a playlist that never held the episode is not rewritten, checked via its
`updatedAt` staying at its seeded value. A blanket rewrite would bump "last modified"
across the user's entire collection, which is a data-quality loss no other assertion here
would notice.

**The tombstone**, read back out of `userPrefs` as stored JSON rather than through the
helper that wrote it. Including the case that matters most in the other direction:
`deleteEpisode` on an id that does not exist writes **no** tombstone. A tombstone for a
hash that was never deleted would suppress a legitimate catalog row forever.

**`reconcileLibrary()` honouring it, end to end** — the real function, with `fetch` stubbed
to serve a small catalog, not the pure `planReconcile` that `reconcile.test.ts` already
covers.

### The control test, and why it is the point

```
it("CONTROL: a row removed without a tombstone IS restored", ...)
```

It deletes the same row with `db.episodes.delete()` — no tombstone — and asserts reconcile
**does** bring it back, returning 1.

Without it, "reconcile restored nothing" is not evidence of anything. A `reconcileLibrary`
that silently returned 0 for an unrelated reason — a closed version gate, a failed fetch, a
thrown error swallowed by its own `catch` — would satisfy the tombstone test perfectly.
That is precisely the shape of the defect in `docs/disconnected-checks.md`, and it is worth
noticing that the trap was live here: `reconcileLibrary` has a blanket `try/catch` that
returns 0 on **any** throw, so a test asserting only `toBe(0)` is one exception away from
passing for the wrong reason permanently.

A third test covers the middle case: after deleting one episode deliberately and losing
another the way the dedup bug did, reconcile restores exactly the second and not the first.
The tombstone must suppress one row, not switch reconcile off.

### Mutations — four on `management.ts`, not one

The convention has been one designated line per module. `management.ts` gets four, because
it writes to five tables, its batch form is what deleted 1,312 of 1,313 episodes, and all
user data lives only in the visitor's IndexedDB with no server backup. One anchor would
have left two of the three properties unobserved.

| id | mutated line | verdict |
|---|---|---|
| `clear-field-delete` | `delete row[key];` → `row[key] = undefined;` | red |
| `delete-tombstone` | `await addTombstone(episode.fileHash);` → `await Promise.resolve();` | red |
| `delete-cascade-history` | `await db.history.where("episodeId").equals(id).delete();` → `await Promise.resolve();` | red |
| `delete-playlist-scrub` | `episodeIds: pl.episodeIds.filter(...)` → `episodeIds: pl.episodeIds,` | red |

`delete-tombstone` going red is the second, independent proof that the control test works:
with the tombstone write removed, reconcile restored the row and the suite noticed.

**22 mutations total, all red.**

### One thing observed but not changed

`deleteEpisode` captures `usePlayerStore.getState()` once, then calls `store.stop()` — which
clears the queue — and afterwards computes a queue index from that now-stale snapshot and
calls `store.removeFromQueue(queueIdx)`. The result is correct in both paths, but by two
different routes: when the deleted episode is the one playing, `stop()` has already emptied
the queue and `removeFromQueue` returns early at its bounds check; when it is merely
queued, `stop()` never runs and the index is live and correct. Both are now pinned by
tests. Not changed — it works, and rewriting the play path was not in scope.

---

## State

- **198 tests, 19 files** — all passing
- **22 of 22 mutations red**
- `npx tsc --noEmit` — clean
- `npm run lint` — clean
- Deploy and push state: see the final section of the session log; verified with command
  output, per the standing rule that a status line asserting intent is a disconnected check.

## Not done this session

- The 12s deadline re-evaluation — waiting on a week of `retried:false` data
- The rest of item B (40 remaining untested modules; `rate-limit.ts` is next after this one)
- `eevee/high-desert` — needs a decision
- `zustand` ^5.0.11 → ^5.0.14 and `@types/node` ^20 → ^22, the two live nuggets salvaged
  from the dependency branch above
