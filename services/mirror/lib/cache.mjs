import { readFile, writeFile, readdir, stat, rm, mkdir, statfs, rename, access } from "node:fs/promises";
import path from "node:path";

/**
 * The bounded cache: one directory per torrent under `<root>/data/<infohash>`,
 * where webtorrent keeps what it has fetched. A `.complete` marker in that
 * directory means every piece is present and verified — a file, not a field in
 * `state.json`, because two processes decide it (the gateway when a torrent
 * finishes, the warm job after checking a webseed download) and only the
 * gateway owns `state.json`, which records when each entry was last served.
 * `pins.json` is the warm job's list of infohashes that are never evicted.
 *
 * Two limits, whichever bites first:
 *   - `maxBytes`: unpinned bytes on disk (pinned files have their own budget,
 *     enforced by the warm job);
 *   - `floorBytes`: free space on the filesystem never drops below this.
 * Eviction takes the least recently served unpinned entry that is not being
 * served right now, and repeats until both hold or nothing evictable is left.
 * Sizes are allocated blocks, not apparent length — a partial download is a
 * sparse file whose length is already the whole episode.
 */
export class Cache {
  constructor({ root, maxBytes, floorBytes, now = () => Date.now(), freeBytes }) {
    this.root = root;
    this.maxBytes = maxBytes;
    this.floorBytes = floorBytes;
    this.now = now;
    this.freeBytes = freeBytes ?? (async () => {
      const s = await statfs(this.root);
      return s.bavail * s.bsize;
    });
    this.state = { entries: {} };
    this.pins = new Set();
    /** Infohashes being served or downloaded right now: never evicted. */
    this.busy = new Set();
  }

  dir(infohash) {
    return path.join(this.root, "data", infohash);
  }

  async load() {
    await mkdir(path.join(this.root, "data"), { recursive: true });
    try {
      this.state = JSON.parse(await readFile(path.join(this.root, "state.json"), "utf8"));
    } catch {
      this.state = { entries: {} };
    }
    await this.loadPins();
  }

  async loadPins() {
    try {
      this.pins = new Set(JSON.parse(await readFile(path.join(this.root, "pins.json"), "utf8")));
    } catch {
      this.pins = new Set();
    }
  }

  async save() {
    const tmp = path.join(this.root, "state.json.tmp");
    await writeFile(tmp, JSON.stringify(this.state));
    await rename(tmp, path.join(this.root, "state.json"));
  }

  touch(infohash) {
    (this.state.entries[infohash] ??= { lastAccess: 0 }).lastAccess = this.now();
  }

  async markComplete(infohash) {
    await mkdir(this.dir(infohash), { recursive: true });
    await writeFile(path.join(this.dir(infohash), ".complete"), "");
  }

  isComplete(infohash) {
    return access(path.join(this.dir(infohash), ".complete")).then(() => true, () => false);
  }

  async bytesOf(infohash) {
    return duBytes(this.dir(infohash));
  }

  /** { total, pinned, unpinned, entries: [{infohash, bytes, pinned, lastAccess}] } */
  async usage() {
    let names = [];
    try {
      names = await readdir(path.join(this.root, "data"));
    } catch {
      /* empty */
    }
    const entries = [];
    for (const infohash of names) {
      entries.push({
        infohash,
        bytes: await this.bytesOf(infohash),
        pinned: this.pins.has(infohash),
        lastAccess: this.state.entries[infohash]?.lastAccess ?? 0,
      });
    }
    const pinned = entries.filter((e) => e.pinned).reduce((a, e) => a + e.bytes, 0);
    const unpinned = entries.filter((e) => !e.pinned).reduce((a, e) => a + e.bytes, 0);
    return { total: pinned + unpinned, pinned, unpinned, entries };
  }

  /** Evict until both limits hold. Returns the evicted infohashes. */
  async evict() {
    const evicted = [];
    const u = await this.usage();
    let unpinned = u.unpinned;
    let free = await this.freeBytes();
    const candidates = u.entries
      .filter((e) => !e.pinned && !this.busy.has(e.infohash))
      .sort((a, b) => a.lastAccess - b.lastAccess);
    for (const c of candidates) {
      if (unpinned <= this.maxBytes && free >= this.floorBytes) break;
      await rm(this.dir(c.infohash), { recursive: true, force: true });
      delete this.state.entries[c.infohash];
      unpinned -= c.bytes;
      free += c.bytes;
      evicted.push(c.infohash);
    }
    if (evicted.length) await this.save();
    return evicted;
  }
}

async function duBytes(p) {
  let s;
  try {
    s = await stat(p);
  } catch {
    return 0;
  }
  if (!s.isDirectory()) return s.blocks * 512;
  let sum = 0;
  for (const name of await readdir(p)) sum += await duBytes(path.join(p, name));
  return sum;
}
