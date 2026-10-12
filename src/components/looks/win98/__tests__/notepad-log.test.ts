import { describe, expect, it } from "vitest";
import { archiveLine, callerLabel, callLine, logTime, tuneinLine } from "../notepad-log";
import { tuneinText, type ArchiveLine, type LiveMessage, type TuneinNotice } from "@/services/live/client";

/** An ISO time for a local wall-clock hour and minute, so the test is time-zone proof. */
const at = (h: number, m: number) => new Date(2026, 9, 12, h, m).toISOString();

const call = (over: Partial<LiveMessage> = {}): LiveMessage => ({
  id: 1,
  at: at(22, 42),
  name: "Skeptic",
  place: "Reno",
  line: "Line 3",
  body: "message",
  ...over,
});

describe("logTime", () => {
  it("is a 12-hour clock in brackets", () => {
    expect(logTime(at(22, 42))).toBe("[10:42 PM]");
    expect(logTime(at(0, 5))).toBe("[12:05 AM]");
    expect(logTime(at(12, 0))).toBe("[12:00 PM]");
    expect(logTime("not a date")).toBe("[--:--]");
  });
});

describe("callLine", () => {
  it("reads as the brief's example", () => {
    expect(callLine(call())).toBe("[10:42 PM] Line 3, Skeptic from Reno: message");
  });

  it("drops the place when there is none", () => {
    expect(callLine(call({ place: null }))).toBe("[10:42 PM] Line 3, Skeptic: message");
    expect(callerLabel({ name: "Skeptic", place: "" })).toBe("Skeptic");
  });
});

describe("tune-ins and the archive are their own kinds of line", () => {
  it("marks a tune-in with asterisks and the chat's own wording", () => {
    const n = { at: at(22, 44), count: 1, places: ["Ohio"] } as unknown as TuneinNotice;
    expect(tuneinLine(n)).toBe(`[10:44 PM] *** ${tuneinText(n)} ***`);
    expect(tuneinLine(n)).not.toMatch(/Line \d/);
  });

  it("marks an archive moment as the archive's, never a caller's", () => {
    const a = { id: 1, at: at(22, 50), text: "Art signs on from Pahrump.", form: "description", speaker: null, episode: null, reason: "this-date" } as unknown as ArchiveLine;
    expect(archiveLine(a)).toBe("[10:50 PM] >>> From the archive: Art signs on from Pahrump.");
    expect(archiveLine({ ...a, reason: "on-air" })).toContain("From the archive, this show:");
  });

  it("puts a quote in quotation marks with its speaker", () => {
    const a = { id: 2, at: at(23, 0), text: "Good evening", form: "quote", speaker: "Art Bell", episode: null, reason: "archive" } as unknown as ArchiveLine;
    expect(archiveLine(a)).toBe("[11:00 PM] >>> From the archive: “Good evening” (Art Bell)");
  });

  it("uses no em dash", () => {
    expect(callLine(call())).not.toContain("—");
  });
});
