/**
 * Frozen station days (Postgres `live_days`), and the published schedule.
 *
 * A day's program depends on community plays, which move all the time, so it
 * is generated **once** and frozen: every later read — after a restart, from a
 * second process, a week later for the repeat rule — gets the same bytes back.
 * Generation happens under a transaction-scoped advisory lock and re-checks
 * inside it, so two processes asking for a new day at the same instant cannot
 * freeze two different ones: the second waits, finds the first's, and returns
 * it. Inserts are `ON CONFLICT DO NOTHING` besides.
 *
 * `buildDays()` (src/lib/live/schedule.ts) builds any missing day of the
 * target's 14-day repeat window along with the target, and all of them are
 * frozen together — so the history a day was built against never shifts
 * under it afterwards.
 *
 * The outage swap is NOT frozen. It is applied per read from the current
 * archive.org verdict and mirror manifest (`buildSchedule`), and is itself
 * deterministic in those.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "@/services/stats/db/pool";
import {
  REPEAT_WINDOW_DAYS,
  STATION_ID_SEC,
  STATION_TZ,
  addDays,
  applyOutageSwap,
  buildDays,
  locate,
  pacificDay,
  upcoming,
  type BuildInputs,
  type CatalogRow,
  type DayProgram,
  type LiveSchedule,
  type ManifestSet,
} from "@/lib/live/schedule";

export type { LiveSchedule };

/** Fixed key for the generation lock. */
const LOCK_KEY = "high-desert:live_days";
/** How many upcoming slots `upNext` carries. Two, so a client has the one after next at a boundary. */
export const UP_NEXT = 2;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

let _catalog: CatalogRow[] | null = null;
let _byHash: Map<string, CatalogRow> | null = null;

/** The shipped catalog, read off disk once (not imported: ~2 MB into the bundle). */
export async function loadCatalog(): Promise<CatalogRow[]> {
  if (_catalog) return _catalog;
  const file = path.join(process.cwd(), "public", "seed", "library.json");
  const rows = JSON.parse(await readFile(file, "utf8")) as CatalogRow[];
  _catalog = rows.map((r) => ({
    fileHash: r.fileHash,
    fileName: r.fileName,
    archiveIdentifier: r.archiveIdentifier ?? null,
    title: r.title ?? null,
    airDate: r.airDate ?? null,
    guestName: r.guestName ?? null,
    showType: r.showType ?? null,
    duration: r.duration ?? null,
    sourceUrl: r.sourceUrl ?? null,
  }));
  _byHash = new Map(_catalog.map((r) => [r.fileHash, r]));
  return _catalog;
}

async function catalogByHash(): Promise<Map<string, CatalogRow>> {
  await loadCatalog();
  return _byHash!;
}

/** Community plays right now — `episode_plays`, the all-time counter. */
export async function loadPlays(): Promise<Map<string, number>> {
  const { rows } = await pool().query<{ episode_id: string; plays: string }>(
    "SELECT episode_id, plays FROM episode_plays WHERE plays > 0",
  );
  return new Map(rows.map((r) => [r.episode_id, Number(r.plays)]));
}

export interface DayDeps {
  loadCatalog?: () => Promise<readonly CatalogRow[]>;
  loadPlays?: () => Promise<ReadonlyMap<string, number>>;
}

// ---------------------------------------------------------------------------
// Frozen days
// ---------------------------------------------------------------------------

/** In-process copy of frozen days. A frozen day never changes, so this never goes stale. */
const cache = new Map<string, DayProgram>();
const CACHE_MAX = 16;

function remember(p: DayProgram): DayProgram {
  cache.set(p.day, p);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return p;
}

async function readFrozen(from: string, to: string): Promise<Map<string, DayProgram>> {
  const { rows } = await pool().query<{ day: string; program: DayProgram }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, program
       FROM live_days WHERE day BETWEEN $1::date AND $2::date`,
    [from, to],
  );
  return new Map(rows.map((r) => [r.day, r.program]));
}

/**
 * The frozen program for `day` (Pacific yyyy-mm-dd), generating and freezing
 * it — and any missing day of its repeat window — if this is the first ask.
 */
export async function frozenDay(day: string, deps: DayDeps = {}): Promise<DayProgram> {
  const hit = cache.get(day);
  if (hit) return hit;

  // Fast path: already frozen, by this process or another.
  const existing = (await readFrozen(day, day)).get(day);
  if (existing) return remember(existing);

  // Inputs are read before taking the lock, to keep it short. If another
  // process wins the race, these are simply not used.
  const [catalog, plays] = await Promise.all([
    (deps.loadCatalog ?? loadCatalog)(),
    (deps.loadPlays ?? loadPlays)(),
  ]);
  const inputs: BuildInputs = { catalog, plays };

  const client = await pool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [LOCK_KEY]);
    const { rows } = await client.query<{ day: string; program: DayProgram }>(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, program
         FROM live_days WHERE day BETWEEN $1::date AND $2::date`,
      [addDays(day, -2 * REPEAT_WINDOW_DAYS), day],
    );
    const frozen = new Map(rows.map((r) => [r.day, r.program]));
    const won = frozen.get(day);
    if (won) {
      await client.query("COMMIT");
      return remember(won);
    }
    const built = buildDays(day, inputs, frozen);
    // Return the day as the database holds it, not the object just built:
    // jsonb normalises key order, and the first answer must be byte-for-byte
    // what every later read returns.
    let target: DayProgram | null = null;
    for (const p of built) {
      const res = await client.query<{ program: DayProgram }>(
        `INSERT INTO live_days (day, program) VALUES ($1::date, $2::jsonb)
         ON CONFLICT (day) DO NOTHING RETURNING program`,
        [p.day, JSON.stringify(p)],
      );
      if (p.day === day) target = res.rows[0]?.program ?? null;
    }
    await client.query("COMMIT");
    if (!target) throw new Error(`live_days: ${day} was not frozen`);
    return remember(target);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Tests only: forget the in-process copies (the database keeps them). */
export function forgetFrozenDaysForTests(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// The published schedule
// ---------------------------------------------------------------------------

export interface ScheduleContext {
  /** archive.org is known down. */
  archiveDown: boolean;
  /** The mirror's manifest, when readable. Only consulted while archive.org is down. */
  manifest: ManifestSet | null;
}

/** Everything but the reads: what is on at `now`, from frozen days. Pure. */
export function assembleSchedule(
  now: number,
  today: DayProgram,
  tomorrow: DayProgram | null,
  ctx: ScheduleContext,
  byHash: ReadonlyMap<string, CatalogRow>,
): LiveSchedule {
  const swap = (p: DayProgram) =>
    ctx.archiveDown && ctx.manifest ? applyOutageSwap(p, ctx.manifest, byHash) : p;
  const t = swap(today);
  const n = tomorrow ? swap(tomorrow) : null;
  const run = n ? [...t.slots, ...n.slots] : t.slots;
  const future = upcoming(run, now);
  const upNext = future.slice(0, UP_NEXT);
  return {
    day: t.day,
    tz: STATION_TZ,
    serverNow: now,
    stationIdSec: STATION_ID_SEC,
    now: locate(run, now, n ? n.end : t.end),
    upNext,
    rest: future.slice(UP_NEXT).filter((s) => s.start < t.end),
    guide: t.slots,
    outage: ctx.archiveDown,
  };
}

/** Does `now` need tomorrow's program to fill `upNext`? */
export function needsTomorrow(today: DayProgram, now: number): boolean {
  return upcoming(today.slots, now).length < UP_NEXT;
}

export async function buildSchedule(
  now: number,
  ctx: () => Promise<ScheduleContext>,
  deps: DayDeps = {},
): Promise<LiveSchedule> {
  const day = pacificDay(now);
  const today = await frozenDay(day, deps);
  const tomorrow = needsTomorrow(today, now) ? await frozenDay(addDays(day, 1), deps) : null;
  return assembleSchedule(now, today, tomorrow, await ctx(), await catalogByHash());
}
