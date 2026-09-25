// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildDay, pacificDay, addDays, locate, type CatalogRow, type DayProgram } from "@/lib/live/schedule";

/**
 * GET /api/live/schedule and GET /api/live/time, through the real routes and
 * the real schedule service. Only the edges are replaced: the database answers
 * with days frozen by the real `buildDay`, and the archive.org verdict and the
 * mirror manifest are fixtures.
 */

const CATALOG: CatalogRow[] = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../../../../../public/seed/library.json"), "utf8"),
);

const frozen = new Map<string, DayProgram>();
function frozenFor(day: string): DayProgram {
  if (!frozen.has(day)) frozen.set(day, buildDay(day, { catalog: CATALOG, plays: new Map() }, []));
  return frozen.get(day)!;
}
let failDb = false;

vi.mock("@/services/stats/db/pool", () => ({
  pool: () => ({
    query: async (sql: string, params: string[]) => {
      if (failDb) throw new Error("database down");
      if (!sql.includes("FROM live_days")) throw new Error(`unexpected query: ${sql}`);
      const [from, to] = params;
      const rows = [];
      for (let d = from; d <= to; d = addDays(d, 1)) rows.push({ day: d, program: frozenFor(d) });
      return { rows };
    },
    connect: async () => {
      throw new Error("a frozen day must be read, not generated");
    },
  }),
}));

let verdict: { up: boolean; status: number; checkedAt: number } | null = null;
vi.mock("@/services/archive/server-verdict", () => ({
  archiveVerdictPrompt: async () => verdict,
}));
let manifest: { version: string; fileHashes: Set<string> } | null = null;
vi.mock("@/services/live/manifest", () => ({ mirrorManifest: async () => manifest }));

const { GET } = await import("../schedule/route");
const { GET: TIME } = await import("../time/route");
const { forgetFrozenDaysForTests } = await import("@/services/live/days");

let ip = 0;
function req(url: string): NextRequest {
  ip += 1;
  return new NextRequest(`http://localhost${url}`, { headers: { "x-forwarded-for": `203.0.113.${ip % 250}` } });
}

beforeEach(() => {
  verdict = { up: true, status: 200, checkedAt: Date.now() };
  manifest = null;
  failDb = false;
  forgetFrozenDaysForTests();
});
afterEach(() => vi.useRealTimers());

describe("GET /api/live/schedule", () => {
  it("publishes now playing, start, offset, up next, the rest of the day and the guide — no-store", async () => {
    const res = await GET(req("/api/live/schedule"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();

    expect(Object.keys(body).sort()).toEqual(
      ["day", "guide", "now", "outage", "rest", "serverNow", "stationIdSec", "tz", "upNext"].sort(),
    );
    expect(body.tz).toBe("America/Los_Angeles");
    expect(body.day).toBe(pacificDay(body.serverNow));
    expect(body.stationIdSec).toBe(8);
    expect(body.outage).toBe(false);

    const today = frozenFor(body.day);
    expect(body.guide).toEqual(today.slots);
    const expected = locate([...today.slots, ...frozenFor(addDays(body.day, 1)).slots], body.serverNow, today.end);
    expect(body.now).toEqual(expected);
    if ("slot" in body.now) {
      expect(Object.keys(body.now).sort()).toEqual(["endsAt", "offsetSec", "slot", "startedAt"]);
      expect(body.now.offsetSec).toBeCloseTo((body.serverNow - body.now.startedAt) / 1000, 6);
    }

    expect(body.upNext).toHaveLength(2);
    expect(body.upNext[0].start).toBeGreaterThan(body.serverNow);
    for (const s of [...body.upNext, ...body.rest]) {
      expect(Object.keys(s).sort()).toEqual(
        ["airDate", "duration", "end", "episodeId", "fileHash", "guestName", "kind", "showType", "sourceUrl", "start", "title"].sort(),
      );
    }
    // The rest is today's, after up next, in order.
    for (const s of body.rest) expect(s.start).toBeLessThan(today.end);
    const starts = [...body.upNext, ...body.rest].map((s: { start: number }) => s.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it("reaches into tomorrow for up next during the day's last show", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const today = frozenFor("2026-09-25");
    const last = today.slots[today.slots.length - 1];
    vi.setSystemTime(last.start + 60_000);
    const body = await (await GET(req("/api/live/schedule"))).json();
    expect(body.day).toBe("2026-09-25");
    expect(body.now.slot.fileHash).toBe(last.fileHash);
    expect(body.upNext[0]).toEqual(frozenFor("2026-09-26").slots[0]);
    expect(body.upNext[0].start).toBe(today.end);
    expect(body.rest).toEqual([]);
  });

  it("swaps what the mirror cannot play while archive.org is down", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const today = frozenFor("2026-09-25");
    vi.setSystemTime(today.slots[0].start + 1000);
    verdict = { up: false, status: 0, checkedAt: Date.now() };
    // The mirror holds the first slot and the top of the ranking.
    manifest = { version: "m1", fileHashes: new Set([today.slots[0].fileHash, ...today.ranking.slice(0, 60)]) };
    const body = await (await GET(req("/api/live/schedule"))).json();
    expect(body.outage).toBe(true);
    expect(body.guide[0]).toEqual(today.slots[0]);
    body.guide.forEach((s: { fileHash: string; kind: string; start: number }, i: number) => {
      expect(s.start).toBe(today.slots[i].start);
      expect(manifest!.fileHashes.has(s.fileHash)).toBe(true);
      if (!manifest!.fileHashes.has(today.slots[i].fileHash)) expect(s.kind).toBe("outage-swap");
    });
    expect(body.guide.some((s: { kind: string }) => s.kind === "outage-swap")).toBe(true);
  });

  it("publishes the frozen day unswapped when the manifest cannot be read", async () => {
    verdict = { up: false, status: 0, checkedAt: Date.now() };
    manifest = null;
    const body = await (await GET(req("/api/live/schedule"))).json();
    expect(body.outage).toBe(true);
    expect(body.guide).toEqual(frozenFor(body.day).slots);
  });

  it("is 503 without a database", async () => {
    failDb = true;
    const res = await GET(req("/api/live/schedule"));
    expect(res.status).toBe(503);
  });
});

describe("GET /api/live/time", () => {
  it("returns this server's clock, no-store", async () => {
    const before = Date.now();
    const res = await TIME(req("/api/live/time"));
    const body = await res.json();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(Object.keys(body)).toEqual(["now"]);
    expect(body.now).toBeGreaterThanOrEqual(before);
    expect(body.now).toBeLessThanOrEqual(Date.now());
  });
});
