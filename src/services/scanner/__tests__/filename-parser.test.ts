import { describe, it, expect } from "vitest";
import { parseFilename, type ParsedFilename } from "../filename-parser";
import catalog from "../../../../public/seed/library.json";

/**
 * The local-file scanner's filename parser (HD-015 item 6).
 *
 * It had no tests, and the first thing a test from real data found was that
 * it mangled every real filename: the collection names its files
 * "YYYY-MM-DD - Coast to Coast AM with Art Bell - <guest/topic>.mp3", which
 * fell through to the date-first pattern and came out as guest
 * "With  - Area 51 - John Lear - Bob Lazar". All 1,312 catalog files did.
 *
 * So the cases here are the catalog's own filenames, taken from
 * public/seed/library.json rather than invented, plus the older conventions
 * the parser was written for, which must keep working.
 */

type Row = { fileName: string; airDate: string; showType: string };
const ROWS = catalog as Row[];

describe("real catalog filenames", () => {
  const CASES: [string, ParsedFilename][] = [
    [
      "1992-12-12 - Coast to Coast AM with Art Bell - Area 51 - John Lear - Bob Lazar.mp3",
      { airDate: "1992-12-12", showType: "coast", guestName: "Area 51", topic: "John Lear - Bob Lazar" },
    ],
    [
      "1994-04-03 - Dreamland with Art Bell - Aliens, Abductions and More - Budd Hopkins.mp3",
      { airDate: "1994-04-03", showType: "dreamland", guestName: "Aliens, Abductions and More", topic: "Budd Hopkins" },
    ],
    [
      "1993-10-30 - Coast to Coast AM with Art Bell - Ghost to Ghost 1993.mp3",
      { airDate: "1993-10-30", showType: "coast", guestName: "Ghost to Ghost 1993" },
    ],
    [
      "2013-09-16 - Dark Matter with Art Bell - First Show - Michio Kaku - Fate of the Universe.mp3",
      { airDate: "2013-09-16", showType: "coast", guestName: "First Show", topic: "Michio Kaku - Fate of the Universe" },
    ],
    [
      "2013-11-12 - Gabcast - Art Calls into the Gabcast.mp3",
      { airDate: "2013-11-12", showType: "special", guestName: "Art Calls into the Gabcast" },
    ],
    // Irregular separators, as they occur in the catalog.
    [
      "2001-05-08  -Coast to Coast AM with Art Bell -  Neil Slade - The Brain.mp3",
      { airDate: "2001-05-08", showType: "coast", guestName: "Neil Slade", topic: "The Brain" },
    ],
    [
      "1999-03-05-  Coast to Coast AM with Art Bell - Art Bell- CNN Larry King LIVE .mp3",
      { airDate: "1999-03-05", showType: "coast", guestName: "Art Bell- CNN Larry King LIVE" },
    ],
    // Day "00": not a date. Left undefined rather than guessed.
    [
      "1999-12-00 - Coast to Coast AM with Art Bell -  Best Sound Clips.mp3",
      { airDate: undefined, showType: "coast", guestName: "Best Sound Clips" },
    ],
  ];

  it.each(CASES)("%s", (fileName, expected) => {
    expect(ROWS.some((r) => r.fileName === fileName), "the case must be a real catalog filename").toBe(true);
    expect(parseFilename(fileName)).toEqual(expected);
  });

  it("parses every catalog filename's air date, and never leaks the host credit into a name", () => {
    expect(ROWS.length).toBeGreaterThan(1000);
    const wrongDate: string[] = [];
    const leaked: string[] = [];
    for (const row of ROWS) {
      const p = parseFilename(row.fileName);
      if (p.airDate !== row.airDate && !row.fileName.startsWith("1999-12-00")) wrongDate.push(row.fileName);
      for (const text of [p.guestName, p.topic]) {
        if (text && (/^with\b/i.test(text) || /with art bell/i.test(text) || /^\s*-/.test(text))) leaked.push(`${row.fileName} → ${text}`);
      }
    }
    expect(wrongDate).toEqual([]);
    expect(leaked).toEqual([]);
  });

  it("agrees with the catalog's show type wherever the catalog says coast or dreamland", () => {
    // The catalog's "special" is curation (Ghost to Ghost, New Year's
    // predictions, Dark Matter) that a filename cannot know. Its coast and
    // dreamland labels come from the show name, and the parser must match.
    const disagree = ROWS.filter((r) => r.showType !== "special" && parseFilename(r.fileName).showType !== r.showType).map((r) => r.fileName);
    expect(disagree).toEqual([]);
  });

  it("a directory prefix is ignored", () => {
    expect(parseFilename("/Volumes/Archive/Art Bell/1994-04-03 - Dreamland with Art Bell - Aliens, Abductions and More - Budd Hopkins.mp3").showType).toBe("dreamland");
  });
});

describe("the older conventions the parser was written for", () => {
  const CASES: [string, ParsedFilename][] = [
    ["Art Bell 1997-01-15 Richard Hoagland.mp3", { airDate: "1997-01-15", showType: "coast", guestName: "Richard Hoagland" }],
    ["Art Bell - 1997-01-15 - Open Lines.mp3", { airDate: "1997-01-15", showType: "coast", topic: "Open Lines" }],
    ["ab_970115.mp3", { airDate: "1997-01-15", showType: "coast" }],
    ["ab-030704_whitley_strieber.mp3", { airDate: "2003-07-04", showType: "coast", guestName: "Whitley Strieber" }],
    [
      "Coast to Coast AM - 1998-05-23 - Whitley Strieber.mp3",
      { airDate: "1998-05-23", showType: "coast", guestName: "Whitley Strieber" },
    ],
    ["dreamland_19980523_whitley_strieber.mp3", { airDate: "1998-05-23", showType: "dreamland", guestName: "Whitley Strieber" }],
    ["dreamland-1998-05-23-ghost_to_ghost.mp3", { airDate: "1998-05-23", showType: "dreamland", topic: "Ghost To Ghost" }],
    ["dreamland_19980523.mp3", { airDate: "1998-05-23", showType: "dreamland" }],
    // Date-first with no " - Show - " structure stays with parseDateFirst.
    ["1997-01-15 Richard Hoagland.mp3", { airDate: "1997-01-15", showType: "unknown", guestName: "Richard Hoagland" }],
    ["1997-01-15 - Richard Hoagland.mp3", { airDate: "1997-01-15", showType: "unknown", guestName: "Richard Hoagland" }],
    ["970115_richard_hoagland.mp3", { airDate: "1997-01-15", showType: "unknown", guestName: "Richard Hoagland" }],
    // Outside the Art Bell era, or no date at all.
    ["Art Bell 1985-01-01 Too Early.mp3", { airDate: undefined, showType: "coast", guestName: "Too Early" }],
    ["random recording.mp3", { showType: "unknown" }],
  ];

  it.each(CASES)("%s", (fileName, expected) => {
    expect(parseFilename(fileName)).toEqual(expected);
  });
});
