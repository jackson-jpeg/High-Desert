import { pool } from "@/services/stats/db/pool";
import { addDays, pacificDay, type DayProgram } from "@/lib/live/schedule";
import { frozenDay } from "@/services/live/days";

/**
 * The program a Tonight page shows (docs/show-pages.md, "Tonight"). Read-only
 * over `live_days`, with one exception that is the station's own rule: today
 * is frozen if nobody has tuned in yet (`frozenDay`, which every listener's
 * first schedule request does anyway). Any other day is read as it was
 * frozen, or not at all: a future day exists only once the station froze it.
 *
 * `available: false` is a server without a database (or one that failed):
 * the page degrades to the catalog's on-this-date list, as the stats do.
 */

export interface TonightData {
  available: boolean;
  program: DayProgram | null;
  /** Whether the day before and after have frozen programs (for the page's links). */
  prev: boolean;
  next: boolean;
}

export interface TonightDeps {
  now?: () => number;
  hasDatabase?: () => boolean;
  freeze?: (day: string) => Promise<DayProgram>;
  readDays?: (days: string[]) => Promise<Map<string, DayProgram>>;
}

async function readDays(days: string[]): Promise<Map<string, DayProgram>> {
  const { rows } = await pool().query<{ day: string; program: DayProgram }>(
    "SELECT to_char(day, 'YYYY-MM-DD') AS day, program FROM live_days WHERE day = ANY($1::date[])",
    [days],
  );
  return new Map(rows.map((r) => [r.day, r.program]));
}

export async function tonightData(day: string, deps: TonightDeps = {}): Promise<TonightData> {
  const hasDb = deps.hasDatabase ?? (() => !!process.env.DATABASE_URL);
  if (!hasDb()) return { available: false, program: null, prev: false, next: false };
  const today = pacificDay((deps.now ?? Date.now)());
  try {
    const around = await (deps.readDays ?? readDays)([addDays(day, -1), day, addDays(day, 1)]);
    let program = around.get(day) ?? null;
    let frozeNow = false;
    if (!program && day === today) {
      program = await (deps.freeze ?? frozenDay)(day);
      // Freezing a day freezes the missing days of its repeat window with it.
      frozeNow = true;
    }
    return {
      available: true,
      program,
      prev: frozeNow || around.has(addDays(day, -1)),
      next: around.has(addDays(day, 1)) && addDays(day, 1) <= addDays(today, 1),
    };
  } catch (err) {
    console.error("[tonight] program unavailable:", (err as Error).message);
    return { available: false, program: null, prev: false, next: false };
  }
}
