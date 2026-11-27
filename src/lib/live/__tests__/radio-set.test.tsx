import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { YearDial, dialPosition, DIAL_FIRST_YEAR, DIAL_LAST_YEAR } from "@/components/radio/YearDial";
import { SWITCHBOARD_LINES, LAMP_LIT_MS, litLines } from "@/lib/live/switchboard";

/**
 * Live as a radio set (docs/UI-PLAN.md, push 2): the year dial under the show
 * on the air, and the Phone Lines' switchboard.
 */

const root = path.resolve(import.meta.dirname, "../../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

describe("the year dial", () => {
  it("spans the archive, 1992 to 2015", () => {
    const years = (JSON.parse(read("public/seed/library.json")) as { airDate?: string }[])
      .map((e) => Number((e.airDate ?? "").slice(0, 4)))
      .filter((y) => y > 1900);
    expect(DIAL_FIRST_YEAR).toBe(Math.min(...years));
    expect(DIAL_LAST_YEAR).toBe(Math.max(...years));
  });

  it("stands the needle at the air date, month included", () => {
    expect(dialPosition("1992-01-01")).toBe(0);
    expect(dialPosition("2015-12-31")).toBeCloseTo(23 / 24 + 11 / 12 / 24, 6);
    const jan = dialPosition("1997-01-10")!;
    const jul = dialPosition("1997-07-10")!;
    expect(jul - jan).toBeCloseTo(6 / 12 / 24, 6);
    expect(dialPosition("2001-05-01")!).toBeGreaterThan(dialPosition("2000-12-01")!);
  });

  it("draws no needle for a show with no usable date", () => {
    expect(dialPosition(null)).toBeNull();
    expect(dialPosition("unknown")).toBeNull();
    expect(renderToStaticMarkup(<YearDial airDate={null} />)).not.toContain('data-dial-part="needle"');
  });

  it("draws the needle where the date says, and keeps the face out of the accessibility tree", () => {
    const html = renderToStaticMarkup(<YearDial airDate="1997-03-13" />);
    expect(html).toContain('data-dial-part="needle"');
    expect(html).toContain(`data-needle="${dialPosition("1997-03-13")!.toFixed(3)}"`);
    expect(html).toContain('aria-hidden="true"');
  });

  it("is in the Live hero and the desktop console, beside the tuning band", () => {
    const live = read("src/components/live/LiveStation.tsx");
    const now = live.slice(live.indexOf("export function NowPlaying"));
    expect(now).toMatch(/<YearDial airDate=\{slot\.airDate\}/);
    expect(now).toMatch(/hd-tuning-band /);
    expect(live).toMatch(/"hd-radio-set /);
    expect(live.match(/data-testid="live-clock" className="hd-phosphor /g)).toHaveLength(2);
  });
});

describe("the switchboard", () => {
  it("has exactly the chat service's lines, in its order", () => {
    const names = read("services/live/lib/names.mjs");
    const block = names.slice(names.indexOf("export const LINES = ["), names.indexOf("];", names.indexOf("export const LINES = [")));
    const service = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(service.length).toBeGreaterThan(0);
    expect([...SWITCHBOARD_LINES]).toEqual(service);
  });

  it("lights a line for 20 minutes after a call on it, and no other", () => {
    const now = Date.parse("2026-11-27T05:00:00Z");
    const at = (msAgo: number) => new Date(now - msAgo).toISOString();
    const lit = litLines(
      [
        { line: "Line 3", at: at(60_000) },
        { line: "Area 51 Line", at: at(LAMP_LIT_MS - 1000) },
        { line: "Line 1", at: at(LAMP_LIT_MS + 60_000) },
        { line: "Line 2", at: "garbage" },
      ],
      now,
    );
    expect([...lit].sort()).toEqual(["Area 51 Line", "Line 3"]);
    expect(litLines([], now).size).toBe(0);
  });

  it("lights the lamps of the chat's recent calls and rings your own line", async () => {
    const { Switchboard } = await import("@/components/live/LiveChat");
    const recent = new Date(Date.now() - 60_000).toISOString();
    const chat = {
      messages: [{ id: 1, at: recent, name: "Night Owl", line: "Line 4", body: "hi" }],
      you: { name: "Me", line: "Wildcard Line", place: null, firstCall: false, admin: false },
    } as unknown as Parameters<typeof Switchboard>[0]["chat"];
    const html = renderToStaticMarkup(<Switchboard chat={chat} />);
    const lamps = [...html.matchAll(/<li ([^>]*)>/g)].map((m) => m[1]);
    expect(lamps).toHaveLength(SWITCHBOARD_LINES.length);
    const attrsOf = (line: string) => lamps.find((a) => a.includes(`title="${line}"`))!;
    expect(attrsOf("Line 4")).toContain("data-lit");
    expect(attrsOf("Line 4")).toContain('aria-label="Line 4, lit"');
    expect(attrsOf("Line 1")).not.toContain("data-lit");
    expect(attrsOf("Wildcard Line")).toContain("data-yours");
    expect(attrsOf("Line 4")).not.toContain("data-yours");
    expect(read("src/components/live/LiveChat.tsx")).toMatch(/<Switchboard chat=\{chat\} \/>/);
  });
});
