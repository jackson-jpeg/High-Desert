import { describe, it, expect } from "vitest";
import notable from "../../../../data/notable.json";
import library from "../../../../public/seed/library.json";
import { airYear, HOOK_MAX, oneLine, showHook } from "@/lib/live/hook";

/**
 * The Live hero's one line on why the show is worth hearing: the catalog's
 * own words, trimmed, never invented (src/lib/live/hook.ts).
 */

describe("oneLine", () => {
  it("is the first sentence, as written", () => {
    expect(oneLine("John Lear and Bob Lazar discuss Area 51. Callers ask about S-4.")).toBe(
      "John Lear and Bob Lazar discuss Area 51.",
    );
  });

  it("does not end a sentence at an abbreviation or an initial", () => {
    expect(oneLine("Dr. Steven Greer and the U.S. Army files on contact. Then open lines.")).toBe(
      "Dr. Steven Greer and the U.S. Army files on contact.",
    );
  });

  it("cuts a long sentence at a word, marks the cut with an ellipsis, and never goes over the limit", () => {
    const long = `${"word ".repeat(60).trim()}.`;
    const out = oneLine(long)!;
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(HOOK_MAX + 1);
    expect(out).not.toMatch(/\s…$/);
    expect(long.startsWith(out.slice(0, -1))).toBe(true);
  });

  it("is nothing for nothing", () => {
    expect(oneLine(null)).toBeNull();
    expect(oneLine("   ")).toBeNull();
  });

  it("adds no em dash, whatever it is given (user-facing copy)", () => {
    expect(oneLine(`${"a ".repeat(100)}`)).not.toMatch(/—/);
  });
});

describe("showHook", () => {
  const notableHash = (notable as { fileHash: string; why: string }[])[0].fileHash;
  const why = (notable as { fileHash: string; why: string }[])[0].why;

  it("prefers a notable show's sourced reason over its summary", () => {
    expect(showHook({ fileHash: notableHash, aiSummary: "Something else entirely." })).toBe(oneLine(why));
  });

  it("falls back to the summary's first sentence, and to nothing", () => {
    expect(showHook({ fileHash: "archive:x:y.mp3", aiSummary: "One thing. Another." })).toBe("One thing.");
    expect(showHook({ fileHash: "archive:x:y.mp3" })).toBeNull();
    expect(showHook(null)).toBeNull();
  });

  it("every hook the catalog can produce is a prefix of its own words, under the limit", () => {
    const rows = library as { fileHash: string; aiSummary?: string }[];
    let checked = 0;
    for (const r of rows) {
      const h = showHook(r);
      if (!h) continue;
      checked++;
      expect(h.length).toBeLessThanOrEqual(HOOK_MAX + 1);
      const source = (notable as { fileHash: string; why: string }[]).find((n) => n.fileHash === r.fileHash)?.why ?? r.aiSummary!;
      expect(source.replace(/\s+/g, " ").startsWith(h.replace(/…$/, ""))).toBe(true);
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe("airYear", () => {
  it("is the year of a dated air date, else null", () => {
    expect(airYear("1992-12-12")).toBe("1992");
    expect(airYear("unknown")).toBeNull();
    expect(airYear(null)).toBeNull();
  });
});
