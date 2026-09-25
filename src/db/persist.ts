/**
 * Ask the browser to keep this origin's storage (HD-010).
 *
 * Everything a listener owns — favourites, ratings, positions, history,
 * bookmarks, playlists — lives only in this origin's IndexedDB, and by default
 * that storage is "best-effort": Chrome evicts whole origins under disk
 * pressure, and Safari clears script-writable storage after seven days without
 * interaction. `navigator.storage.persist()` is the one request that moves it
 * out of that pool.
 *
 * Asked **once per profile, after the first meaningful write** — not on the
 * seed. The seed is the catalog, which any visit can refetch; asking for it
 * would spend the one request (Firefox shows a prompt) on data that does not
 * need keeping, from a visitor who has not done anything yet. Chrome's grant
 * heuristics also weigh engagement, so the request is more likely to succeed
 * after an interaction than on first paint.
 *
 * "Meaningful write" is observed with Dexie table hooks on the database
 * itself rather than by calling this from each write site. The sites are
 * scattered (management.ts, the player's position saves (the `progress` table),
 * the queue panel, the dedup merge, import), and a list of call sites is the
 * kind of check that goes quiet when a new write path is added without it.
 * A hook sees every write to the table, whoever makes it.
 */
import Dexie, { type Table, type Transaction } from "dexie";

/** UserPrefs key recording that persist() has been asked. Never re-asked once set. */
export const PERSIST_REQUESTED_PREF = "storage-persist-requested";

/**
 * Episode fields a listener changes by acting. A put that changes none of
 * these (the layout persisting a resolved `sourceUrl`, an admin metadata edit)
 * is not the listener's data.
 *
 * `playbackPosition` is no longer one of them: since v9 it lives in the
 * `progress` table (HD-016), which is watched below — every write there is
 * the listener's.
 */
const USER_EPISODE_FIELDS = ["favoritedAt", "rating", "flaggedAt"] as const;

// Minimal structural view of the database, so this module does not import
// `@/db` (which imports this one to install the hooks).
interface PrefRow { id?: number; key: string; value: string }
interface HookableDb {
  userPrefs: {
    where(index: string): { equals(v: string): { first(): Promise<PrefRow | undefined> } };
    add(row: PrefRow): Promise<unknown>;
  };
  episodes: Table;
  bookmarks: Table;
  playlists: Table;
  progress: Table;
}

let _db: HookableDb | null = null;
/** In-flight or settled request for this page load. Concurrent writes share one. */
let _request: Promise<void> | null = null;

type PersistOutcome = "requested" | "already-requested" | "already-persisted" | "unsupported";

async function requestOnce(db: HookableDb): Promise<PersistOutcome> {
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  // Unsupported (old Safari, some embedded webviews, jsdom): nothing to ask.
  // Deliberately *not* recorded — a browser update may add it, and then the
  // next write should ask.
  if (!storage || typeof storage.persist !== "function") return "unsupported";

  if (await db.userPrefs.where("key").equals(PERSIST_REQUESTED_PREF).first()) {
    return "already-requested";
  }

  // An installed PWA (or a site the user bookmarked, in Firefox) may already
  // be persistent. Record it so the question is never put.
  const already = typeof storage.persisted === "function" ? await storage.persisted() : false;
  if (!already) {
    try {
      await storage.persist();
    } catch {
      // A rejection is an answer too; recording it below means it is not retried.
    }
  }
  await db.userPrefs.add({ key: PERSIST_REQUESTED_PREF, value: already ? "already" : String(Date.now()) });
  return already ? "already-persisted" : "requested";
}

/**
 * Request persistent storage unless this profile already has. Safe to call
 * any number of times: one call per page load does any work, and one per
 * profile ever reaches `navigator.storage.persist()`. Never rejects.
 */
export function requestPersistentStorage(): Promise<void> {
  const db = _db;
  if (!db) return Promise.resolve();
  if (!_request) {
    // Outside any transaction the caller may be inside: the hook fires
    // mid-transaction, and userPrefs is not always in its scope.
    _request = Dexie.ignoreTransaction(() => requestOnce(db)).then(
      () => undefined,
      (err) => {
        console.warn("[persist] could not request persistent storage:", err);
        // Let a later write try again: nothing was recorded.
        _request = null;
      },
    );
  }
  return _request;
}

/** After the transaction that made a user write has committed — never for one that aborts. */
function afterCommit(trans: Transaction): void {
  trans.on("complete", () => {
    void requestPersistentStorage();
  });
}

/**
 * Install the write observers. Called once, from `src/db/index.ts`, on the
 * app's one database instance.
 */
export function installPersistRequest(db: HookableDb): void {
  _db = db;

  db.episodes.hook("updating", (mods, _key, _obj, trans) => {
    const changed = mods as Record<string, unknown>;
    if (USER_EPISODE_FIELDS.some((f) => f in changed)) afterCommit(trans);
  });

  db.bookmarks.hook("creating", (_key, _obj, trans) => afterCommit(trans));

  // Where the listener is in a show (HD-016). Nothing but a listen, a seek
  // save, an import or a merge of the listener's own rows writes here — the
  // seed never does — so every write counts.
  db.progress.hook("creating", (_key, _obj, trans) => afterCommit(trans));
  db.progress.hook("updating", (_mods, _key, _obj, trans) => afterCommit(trans));

  // A playlist created in a transaction that is also writing episodes is the
  // seed's (`seedLibraryIfEmpty` restores playlists shipped in a v2 envelope),
  // not the listener's. Every other playlist write is theirs.
  db.playlists.hook("creating", (_key, _obj, trans) => {
    if (!trans.storeNames.includes("episodes")) afterCommit(trans);
  });
  db.playlists.hook("updating", (_mods, _key, _obj, trans) => afterCommit(trans));
  db.playlists.hook("deleting", (_key, _obj, trans) => afterCommit(trans));
}
