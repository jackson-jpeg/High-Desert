import { describe, expect, it } from "vitest";
import { archiveLabel, archiveLine, archiveText, callerLabel, callHead, callLine, logTime, tuneinLine } from "../notepad-log";
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

describe("a call is a block: its head, then the message on its own line", () => {
  it("names the caller, then where they are calling from, the line and the time", () => {
    expect(callHead(call())).toBe("Skeptic, calling from Reno · [10:42 PM]");
    expect(callLine(call())).toBe("Skeptic, calling from Reno · [10:42 PM]\nmessage");
  });

  it("drops the place when there is none", () => {
    expect(callHead(call({ place: null }))).toBe("Skeptic · Line 3 · [10:42 PM]");
    expect(callerLabel({ name: "Skeptic", place: "" })).toBe("Skeptic");
  });

  it("keeps an old generated name and its place apart (control: the name is untouched)", () => {
    expect(callerLabel({ name: "Night Owl in Flagstaff", place: "Asuncion" })).toBe("Night Owl in Flagstaff, calling from Asuncion");
    expect(callerLabel({ name: "Night Owl", place: "Asuncion" })).toBe("Night Owl, calling from Asuncion");
  });
});

describe("tune-ins and the archive are their own kinds of line", () => {
  it("marks a tune-in with asterisks and the chat's own wording", () => {
    const n = { at: at(22, 44), count: 1, places: ["Ohio"] } as TuneinNotice;
    expect(tuneinLine(n)).toBe(`[10:44 PM] *** ${tuneinText(n)} ***`);
    expect(tuneinLine(n)).not.toMatch(/Line \d/);
  });

  it("heads an archive moment as the archive's, never a caller's", () => {
    const a = { id: "1", at: at(22, 50), text: "Art signs on from Pahrump.", form: "moment", speaker: null, episode: null, reason: "this-date" } as ArchiveLine;
    expect(archiveLabel(a)).toBe(">>> From the archive");
    expect(archiveLabel({ ...a, reason: "on-air" })).toBe(">>> From the archive, this show");
    expect(archiveText(a)).toBe("Art signs on from Pahrump.");
    expect(archiveLine(a)).toBe(">>> From the archive [10:50 PM]\nArt signs on from Pahrump.");
  });

  it("puts a quote in quotation marks with its speaker", () => {
    const a = { id: "2", at: at(23, 0), text: "Good evening", form: "quote", speaker: "Art Bell", episode: null, reason: "archive" } as ArchiveLine;
    expect(archiveText(a)).toBe("“Good evening” (Art Bell)");
    expect(archiveText({ ...a, speaker: null })).toBe("“Good evening”");
  });

  it("uses no em dash", () => {
    for (const s of [callLine(call()), callHead(call({ place: null })), archiveLabel({ reason: "on-air" } as ArchiveLine)]) {
      expect(s).not.toContain("—");
    }
  });
});
