// @vitest-environment node
import { beforeAll, afterAll, afterEach, it, expect } from "vitest";
import { TEST_DATABASE_URL, describeDb } from "@/test-support/test-db";
import { communityKey } from "@/lib/utils/community-key";
import { buildDay, type CatalogRow, type DayProgram } from "@/lib/live/schedule";

/**
 * A station day is frozen the first time it is asked for, and every later ask
 * — after a restart, from another process, after community plays have moved —
 * gets the same program back. Against real Postgres, through the real
 * `frozenDay`, on dates far enough out (2099) that nothing else writes them.
 */

type Days = typeof import("../days");
type Pool = typeof import("@/services/stats/db/pool");
let days: Days;
let poolMod: Pool;
let catalog: CatalogRow[];

beforeAll(async () => {
  if (!TEST_DATABASE_URL) return;
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  days = await import("../days");
  poolMod = await import("@/services/stats/db/pool");
  catalog = await days.loadCatalog();
});

afterAll(async () => {
  if (poolMod) await poolMod.pool().end();
});

const FROM = "2099-01-01";
afterEach(async () => {
  await poolMod.pool().query("DELETE FROM live_days WHERE day >= $1::date", [FROM]);
  await poolMod.pool().query("DELETE FROM live_overrides WHERE day >= $1::date", [FROM]);
  await poolMod.pool().query("DELETE FROM audio_checks WHERE reason = 'test-2099'");
  days.forgetOverrides();
  days.forgetFrozenDaysForTests();
});

/** Plays that rank the catalog one way, and plays that rank it the opposite way. */
function ranked(dir: 1 | -1): Map<string, number> {
  return new Map(catalog.map((r, i) => [communityKey(r)!, dir === 1 ? i + 1 : catalog.length - i]));
}

async function stored(day: string): Promise<DayProgram | undefined> {
  const { rows } = await poolMod
    .pool()
    .query<{ program: DayProgram }>("SELECT program FROM live_days WHERE day = $1::date", [day]);
  return rows[0]?.program;
}

describeDb("frozen station days (Postgres)", () => {
  it("freezes a day on first ask and serves it unchanged after community plays move and the process restarts", async () => {
    const day = "2099-03-10";
    const first = await days.frozenDay(day, { loadPlays: async () => ranked(1) });
    expect(first.day).toBe(day);
    expect(await stored(day)).toEqual(first);

    // A restart: the in-process copy is gone, and the plays now rank the other way.
    days.forgetFrozenDaysForTests();
    const again = await days.frozenDay(day, { loadPlays: async () => ranked(-1) });
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));

    // Control: those plays *would* have produced a different program — so it
    // was the freeze that held it, not a coincidence of the inputs.
    const recomputed = buildDay(day, { catalog, plays: ranked(-1) }, []);
    expect(recomputed.slots.map((s) => s.fileHash)).not.toEqual(first.slots.map((s) => s.fileHash));
  });

  it("freezes the whole repeat window with the day, so its history never shifts", async () => {
    const day = "2099-05-20";
    await days.frozenDay(day, { loadPlays: async () => ranked(1) });
    const { rows } = await poolMod
      .pool()
      .query<{ n: number }>("SELECT count(*)::int AS n FROM live_days WHERE day BETWEEN '2099-05-06' AND '2099-05-20'");
    expect(rows[0].n).toBe(15);

    // The next day is built against those frozen fourteen — no fan favorite repeats.
    const next = await days.frozenDay("2099-05-21", { loadPlays: async () => ranked(-1) });
    const aired = new Set<string>();
    for (let d = 7; d <= 20; d++) {
      const p = await stored(`2099-05-${String(d).padStart(2, "0")}`);
      for (const s of p!.slots) aired.add(s.fileHash);
    }
    const repeats = next.slots.filter((s) => s.kind === "fan-favorite" && aired.has(s.fileHash));
    expect(repeats).toEqual([]);
  });

  it("two processes asking for a new day at once freeze one program, not two", async () => {
    const day = "2099-08-01";
    // Different plays per caller: without the lock and the re-check inside it,
    // each would build and return its own.
    const [a, b] = await Promise.all([
      days.frozenDay(day, { loadPlays: async () => ranked(1) }),
      (async () => {
        days.forgetFrozenDaysForTests();
        return days.frozenDay(day, { loadPlays: async () => ranked(-1) });
      })(),
    ]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(await stored(day))).toBe(JSON.stringify(a));
  });

  it("never freezes a file that failed its walk: the swap is stored with the day, and logged", async () => {
    const day = "2099-09-14";
    const plan = buildDay(day, { catalog, plays: ranked(1) }, []);
    const badHash = plan.slots[1].fileHash;
    // Through the real table: one failed walk, and every off-day favorite passed.
    const okHashes = plan.ranking.filter((h) => !plan.slots.some((s) => s.fileHash === h)).slice(0, 50);
    await poolMod.pool().query(
      `INSERT INTO audio_checks (file_hash, ok, reason) SELECT h, h = ANY($2::text[]), 'test-2099' FROM unnest($1::text[]) h
       ON CONFLICT (file_hash) DO NOTHING`,
      [[badHash, ...okHashes], okHashes],
    );
    const lines: string[] = [];
    const p = await days.frozenDay(day, { loadPlays: async () => ranked(1), loadPinned: async () => null, log: (l) => lines.push(l) });
    expect(p.slots.some((s) => s.fileHash === badHash)).toBe(false);
    const swap = p.slots.find((s) => s.replaces === badHash)!;
    expect(swap).toMatchObject({ kind: "verify-swap", start: plan.slots[1].start });
    expect(okHashes).toContain(swap.fileHash);
    expect((await stored(day))!.slots[1]).toEqual(swap);
    expect(lines.some((l) => l.includes(`verify-swap ${day}`) && l.includes(badHash))).toBe(true);
    // The planned day for the nightly walk agrees with what was frozen.
    expect((await days.plannedDay(day)).frozen).toBe(true);
  });

  it("a breaker trip cuts the show on the air at the next schedule read, and the replacement follows a station ID", async () => {
    const day = "2099-10-02";
    const p = await days.frozenDay(day, { loadPlays: async () => ranked(1), loadPinned: async () => null });
    const A = p.slots[3];
    const cutAt = A.start + 30 * 60_000;
    const replacement = p.ranking.find((h) => !p.slots.some((s) => s.fileHash === h))!;
    const ctx = async () => ({ archiveDown: false, manifest: null });
    const before = await days.buildSchedule(cutAt + 1000, ctx);
    expect("slot" in before.now && before.now.slot.fileHash).toBe(A.fileHash);

    await poolMod.pool().query(
      "INSERT INTO live_overrides (slot_start, file_hash, day, cut_at, replacement, clients, kinds) VALUES ($1, $2, $3::date, $4, $5, 3, '{decode-error}')",
      [A.start, A.fileHash, day, cutAt, replacement],
    );
    days.forgetOverrides();
    const after = await days.buildSchedule(cutAt + 1000, ctx);
    expect(after.now).toMatchObject({ stationId: true });
    expect(after.upNext[0]).toMatchObject({ fileHash: replacement, kind: "breaker-swap", replaces: A.fileHash });
    const later = await days.buildSchedule(cutAt + 60_000, ctx);
    expect("slot" in later.now && later.now.slot.fileHash).toBe(replacement);
    // The frozen day itself is untouched.
    expect(JSON.stringify(await stored(day))).toBe(JSON.stringify(p));
  });
});
