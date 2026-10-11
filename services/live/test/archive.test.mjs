import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { archiveLine, createArchiveVoice, loadMoments, pacificMonthDay, pickMoment, scheduleReader } from "../lib/archive.mjs";
import { ARCHIVE_INTERVAL_MS, ARCHIVE_QUIET_MS, MAX_MESSAGE_CHARS } from "../lib/config.mjs";

/**
 * Archive moments (2026-10-11): lines from the show's history when the room
 * is quiet. Never a caller, tied to the show on the air, at most one an hour.
 */

const MIN = 60_000;
const moments = loadMoments();
const catalog = JSON.parse(readFileSync(path.join(process.cwd(), "public", "seed", "library.json"), "utf8"));

describe("the moments", () => {
  it("fifty, each with its own id", () => {
    expect(moments).toHaveLength(50);
    expect(new Set(moments.map((m) => m.id)).size).toBe(50);
  });

  it("every linked episode is exactly one show in the catalog", () => {
    const bad = moments
      .filter((m) => m.episode)
      .filter((m) => catalog.filter((r) => r.airDate === m.episode.airDate && r.title === m.episode.title).length !== 1)
      .map((m) => m.id);
    expect(bad).toEqual([]);
  });

  it("a quote names its speaker; a description never claims to be one", () => {
    for (const m of moments) {
      if (m.form === "quote") expect(m.speaker, m.id).toBeTruthy();
      else {
        expect(m.form ?? "moment", m.id).toBe("moment");
        expect(m.speaker, m.id).toBeUndefined();
      }
    }
  });

  it("copy a listener reads: no em dash, short enough for a call", () => {
    for (const m of moments) {
      expect(m.text, m.id).not.toContain("—");
      expect([...m.text].length, m.id).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    }
  });
});

describe("pickMoment: tied to the show on the air", () => {
  const area51 = { title: "Coast to Coast AM - Open Lines with Area 51 Employees", airDate: "1997-09-11", guestName: null };
  // A night in October, Pacific: no moment's episode aired on 10-11 or 10-12.
  const night = Date.parse("2026-10-11T08:00:00Z");

  it("the very episode first", () => {
    const { moment, reason } = pickMoment(moments, area51, { now: night, random: () => 0 });
    expect(moment.id).toBe("area-51-caller");
    expect(reason).toBe("on-air");
  });

  it("then a moment on the show's topic", () => {
    const slot = { title: "Coast to Coast AM - Phoenix Lights Follow-up", airDate: "1997-03-14", guestName: null };
    const { moment, reason } = pickMoment(moments, slot, { now: night, random: () => 0 });
    expect(reason).toBe("topic");
    expect(moment.tags).toContain("phoenix lights");
  });

  it("then one that aired on this date", () => {
    const slot = { title: "Coast to Coast AM - Gardening", airDate: "1999-01-01", guestName: "Nobody" };
    // 1997-09-11 (the Area 51 call) in Pacific time.
    const sept11 = Date.parse("2026-09-11T20:00:00Z");
    expect(pacificMonthDay(sept11)).toBe("09-11");
    const { moment, reason } = pickMoment(moments, slot, { now: sept11, random: () => 0 });
    expect(reason).toBe("this-date");
    expect(moment.episode.airDate.slice(5)).toBe("09-11");
  });

  it("otherwise anything, and nothing used recently while there is a choice", () => {
    const { reason } = pickMoment(moments, null, { now: night, random: () => 0 });
    expect(reason).toBe("archive");
    const recent = moments.slice(0, 49).map((m) => m.id);
    expect(pickMoment(moments, null, { now: night, recent, random: () => 0 }).moment.id).toBe(moments[49].id);
  });

  it("a quote keeps its speaker on the line; a description has none", () => {
    const quote = archiveLine(moments.find((m) => m.form === "quote"), "archive", night);
    expect(quote).toMatchObject({ form: "quote", speaker: "Art Bell" });
    const moment = archiveLine(moments.find((m) => m.id === "area-51-caller"), "on-air", night);
    expect(moment).toMatchObject({ form: "moment", speaker: null, episode: { airDate: "1997-09-11" } });
  });
});

describe("the voice: rare, and only into a quiet room", () => {
  function voice({ listeners = 1, slot = null } = {}) {
    let t = Date.parse("2026-10-11T08:00:00Z");
    const sent = [];
    const v = createArchiveVoice({
      moments,
      broadcast: (l) => sent.push(l),
      listeners: () => listeners,
      onAir: async () => slot,
      now: () => t,
      random: () => 0,
      checkMs: 0,
    });
    return { v, sent, advance: (ms) => (t += ms), at: () => t };
  }

  it("nothing until the room has been quiet for twenty minutes, counted from the start", async () => {
    const { v, sent, advance } = voice();
    advance(ARCHIVE_QUIET_MS - MIN);
    await v.tick();
    expect(sent).toHaveLength(0);
    advance(MIN);
    await v.tick();
    expect(sent).toHaveLength(1);
  });

  it("a call resets the quiet", async () => {
    const { v, sent, advance, at } = voice();
    advance(ARCHIVE_QUIET_MS - MIN);
    v.noteCall(at());
    advance(2 * MIN);
    await v.tick();
    expect(sent).toHaveLength(0);
    advance(ARCHIVE_QUIET_MS);
    await v.tick();
    expect(sent).toHaveLength(1);
  });

  it("at most one an hour, however quiet", async () => {
    const { v, sent, advance } = voice();
    advance(ARCHIVE_QUIET_MS);
    await v.tick();
    advance(ARCHIVE_INTERVAL_MS - MIN);
    await v.tick();
    expect(sent).toHaveLength(1);
    advance(MIN);
    await v.tick();
    expect(sent).toHaveLength(2);
    expect(sent[1].id).not.toBe(sent[0].id);
  });

  it("never to an empty room", async () => {
    const { v, sent, advance } = voice({ listeners: 0 });
    advance(3 * ARCHIVE_INTERVAL_MS);
    await v.tick();
    expect(sent).toHaveLength(0);
  });

  it("picks for the show on the air, and keeps the last few for hello", async () => {
    const slot = { title: "Coast to Coast AM - Open Lines with Area 51 Employees", airDate: "1997-09-11", guestName: null };
    const { v, sent, advance } = voice({ slot });
    advance(ARCHIVE_QUIET_MS);
    await v.tick();
    expect(sent[0]).toMatchObject({ id: "area-51-caller", reason: "on-air" });
    expect(v.recent()).toEqual(sent);
  });

  it("a schedule that cannot be read still leaves a line, from anywhere", async () => {
    const read = scheduleReader("http://127.0.0.1:1/none", { fetchImpl: async () => { throw new Error("down"); } });
    expect(await read()).toBeNull();
    const ok = scheduleReader("x", { fetchImpl: async () => ({ ok: true, json: async () => ({ now: { slot: { title: "T" } } }) }) });
    expect(await ok()).toEqual({ title: "T" });
    const gap = scheduleReader("x", { fetchImpl: async () => ({ ok: true, json: async () => ({ now: { stationId: true } }) }) });
    expect(await gap()).toBeNull();
  });
});
