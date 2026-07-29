# `Table.update()` and `undefined` — correcting the record

`b88378d` ("fix(episodes): ratings and favourites could not be cleared or seen",
2026-07-27) fixed a real, reproduced bug and gave a wrong reason for half of it.
The wrong reason was then written into `CLAUDE.md`, into a docblock in
`src/services/episodes/management.ts`, and into a regression test built so that
it could not disprove itself. It survived two days and one full session before
anything checked it against Dexie.

Git history is left alone. This file is the correction.

## What the commit claimed

> Dexie's `Table.update()` ignores keys whose value is `undefined`, so
> `update(id, { rating: undefined })` writes nothing. All three toggle-off paths
> in `services/episodes/management.ts` were written that way: the function
> returned the new state and the toast fired while the row was untouched.

## What Dexie 4.3.0 actually does

It deletes the key. Verified against the installed library, in the project, on
the VPS:

```
dexie 4.3.0
update() returned: 1
"rating" in row: false
row: {"id":1,"favoritedAt":99}
```

Not an accident of this version, either — it falls out of the implementation.
`Table.prototype.update` is a one-line delegation to the very call
`applyEpisodeFields` makes by hand:

```js
Table.prototype.update = function (keyOrObject, modifications) {
    ...
    return this.where(":id").equals(keyOrObject).modify(modifications);
};
```

and `modify` applies each entry through `setByKeyPath`, which branches on
exactly this:

```js
if (value === undefined) {
    ...
    delete obj[keyPath];
}
else
    obj[keyPath] = value;
```

`update()` **is** `.modify()`. There was never a difference to work around.

## The premise was never true *for this project*

`dexie` is pinned `^4.3.0` in `package.json` and resolves to 4.3.0 in
`package-lock.json` in **every commit that has ever touched the lockfile**, back
to the initial commit `782fec0` (2026-02-12). It has never been upgraded. So
this is not a case of behaviour changing under us — the claim was false on the
day it was written.

## How a regression test let it survive

The test added alongside the fix said so itself:

> It asserts the merge semantics rather than standing up Dexie (fake-indexeddb
> is not a dependency, and adding one for this is not worth it), including a
> test that documents the Dexie behaviour being worked around, so it fails
> loudly if Dexie ever changes.

It could not fail loudly if Dexie ever changed, because it never called Dexie.
The "test that documents the Dexie behaviour" was a hand-written model of what
the author believed Dexie did, asserted against itself. It agreed with the
belief by construction, and would have gone on agreeing with it through any
Dexie release, including one that broke the app.

This is the same shape as the other two mirrors found in the item-A audit, and
the same shape as the watchdog defect in
[`phantom-failures.md`](./phantom-failures.md): a check with no connection to the
thing it checks, reporting confidently. A test that cannot observe the subject
cannot distinguish "correct" from "I cannot see".

`src/services/episodes/__tests__/clear-field.test.ts` now imports
`fake-indexeddb/auto`, opens the real database, and drives `toggleFavorite`,
`rateEpisode` and `toggleFlag` through full on→off cycles, asserting
`"favoritedAt" in row === false` on the record actually stored. One of its six
tests calls `db.episodes.update(id, { rating: undefined })` directly, so the
claim above is now pinned to Dexie rather than to a belief about it.

## What was really wrong, then

Defect 1 in that commit is untouched by any of this and is independently
confirmed: the library's detail panel rendered `selectedEpisode`, a `useState`
snapshot taken when the row was clicked, and nothing refreshed it. The write
landed in IndexedDB and the list row updated; the open panel kept rendering the
stale object. The commit's own measurement shows it plainly — click the 4th
star, stars stay empty, **stored rating 4**, reopen the panel, `★★★★☆`.

That accounts for the reported symptom on its own, and it accounts for the
"clearing does nothing" half too: clear a rating from inside the panel and the
panel goes on showing the old value, from the same stale snapshot, for the same
reason. Nothing was ever needed at the `update()` call site to explain it.

The panel now renders `selectedEpisodeLive`, re-read from the live query. That
is the fix that mattered.

## Why `applyEpisodeFields` stays anyway

It is a wrapper that does, explicitly, what `update()` does implicitly. Keeping
it is not a hedge against the claim above being wrong a second time — the
delegation is right there in the library source. It stays because:

- **It states the intent.** `applyEpisodeFields(id, { favoritedAt: undefined })`
  reads as "remove this field". `update(id, { favoritedAt: undefined })` reads,
  to most people, as "leave it alone" — which is what a reasonable person
  assumed, wrote down, and got into three files. The name is worth the wrapper
  even though the behaviour is identical.
- **It does not depend on a third-party library's treatment of `undefined`
  staying put.** Dexie is entitled to change this in a major version. All user
  data — favourites, ratings, playback positions, history, bookmarks — lives only
  in the visitor's IndexedDB and there is no server backup, so the cost of
  finding out the hard way is unrecoverable.

It is **not load-bearing** for the behaviour, and nothing should be written down
as if it were. If it is ever removed, `update()` is a correct replacement.

## Where the false claim was, and is not any more

| | |
|---|---|
| `CLAUDE.md`, "Dexie: clearing a field" | Rewritten as a correction (`50dd320`) |
| `docs/high-desert-handoff-2026-07-29.md`, "Things to know" | Left as written — it is a historical record, and this file is what corrects it |
| `src/services/episodes/management.ts`, `applyEpisodeFields` docblock | Rewritten |
| `src/services/episodes/__tests__/clear-field.test.ts` | Rewritten onto `fake-indexeddb` |
| `b88378d` commit message | Left alone. History is not rewritten |
