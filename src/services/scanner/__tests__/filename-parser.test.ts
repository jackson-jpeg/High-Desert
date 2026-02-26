import { describe, it, expect } from "vitest";
import { parseFilename } from "../filename-parser";

describe("parseFilename (scanner parser)", () => {
  describe("Art Bell long format", () => {
    it("parses Art Bell YYYY-MM-DD Guest Name", () => {
      const result = parseFilename("Art Bell 1997-01-15 Richard Hoagland.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Richard Hoagland");
      expect(result.showType).toBe("coast");
    });

    it("parses with dashes and spaces", () => {
      const result = parseFilename("Art Bell - 1997-01-15 - John Lear.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("John Lear");
      expect(result.showType).toBe("coast");
    });

    it("handles topic instead of guest", () => {
      const result = parseFilename("Art Bell 1997-12-31 Open Lines.mp3");
      expect(result.airDate).toBe("1997-12-31");
      expect(result.topic).toBe("Open Lines");
      expect(result.guestName).toBeUndefined();
      expect(result.showType).toBe("coast");
    });
  });

  describe("Compact AB format", () => {
    it("parses ab_YYMMDD_guest", () => {
      const result = parseFilename("ab_970115_Richard_Hoagland.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Richard Hoagland");
      expect(result.showType).toBe("coast");
    });

    it("parses ab-YYMMDD-guest", () => {
      const result = parseFilename("ab-970115-John Lear.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("John Lear");
      expect(result.showType).toBe("coast");
    });

    it("handles ab YYMMDD guest", () => {
      const result = parseFilename("ab 970115 Whitley Strieber.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Whitley Strieber");
      expect(result.showType).toBe("coast");
    });

    it("handles topic for ab format", () => {
      const result = parseFilename("ab_970115_open_lines.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.topic).toBe("Open Lines");
      expect(result.guestName).toBeUndefined();
    });
  });

  describe("Coast to Coast format", () => {
    it("parses Coast to Coast AM - YYYY-MM-DD - Guest", () => {
      const result = parseFilename("Coast to Coast AM - 1997-01-15 - Richard Hoagland.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Richard Hoagland");
      expect(result.showType).toBe("coast");
    });

    it("parses without AM suffix", () => {
      const result = parseFilename("Coast to Coast - 1997-01-15 - John Lear.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("John Lear");
      expect(result.showType).toBe("coast");
    });

    it("handles various separators", () => {
      const result = parseFilename("Coast_to_Coast_AM-1997.01.15-Richard_Hoagland.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Richard Hoagland");
      expect(result.showType).toBe("coast");
    });
  });

  describe("Dreamland format", () => {
    it("parses dreamland_YYYYMMDD_guest", () => {
      const result = parseFilename("dreamland_19980115_whitley_strieber.mp3");
      expect(result.airDate).toBe("1998-01-15");
      expect(result.guestName).toBe("Whitley Strieber");
      expect(result.showType).toBe("dreamland");
    });

    it("parses dreamland-YYYY-MM-DD-guest", () => {
      const result = parseFilename("dreamland-1998-01-15-budd-hopkins.mp3");
      expect(result.airDate).toBe("1998-01-15");
      expect(result.guestName).toBe("Budd Hopkins");
      expect(result.showType).toBe("dreamland");
    });

    it("handles dreamland with date only", () => {
      const result = parseFilename("dreamland_19980115.mp3");
      expect(result.airDate).toBe("1998-01-15");
      expect(result.showType).toBe("dreamland");
      expect(result.guestName).toBeUndefined();
    });

    it("handles topic for dreamland", () => {
      const result = parseFilename("dreamland_19980115_open_lines.mp3");
      expect(result.airDate).toBe("1998-01-15");
      expect(result.topic).toBe("Open Lines");
      expect(result.showType).toBe("dreamland");
    });
  });

  describe("Date-first format", () => {
    it("parses YYYY-MM-DD Guest Name", () => {
      const result = parseFilename("1997-01-15 Richard Hoagland.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Richard Hoagland");
    });

    it("parses YYYY.MM.DD Guest Name", () => {
      const result = parseFilename("1997.01.15 John Lear.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("John Lear");
    });

    it("detects show type from guest name", () => {
      const result = parseFilename("1997-01-15 Coast to Coast with John Lear.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("John Lear");
      expect(result.showType).toBe("coast");
    });

    it("handles topic detection", () => {
      const result = parseFilename("1997-12-31 Open Lines.mp3");
      expect(result.airDate).toBe("1997-12-31");
      expect(result.topic).toBe("Open Lines");
      expect(result.guestName).toBeUndefined();
    });
  });

  describe("Short date format", () => {
    it("parses YYMMDD_guest", () => {
      const result = parseFilename("970115_Richard_Hoagland.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Richard Hoagland");
    });

    it("parses YYMMDD-guest", () => {
      const result = parseFilename("970115-John Lear.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("John Lear");
    });

    it("handles YYMMDD guest with spaces", () => {
      const result = parseFilename("970115 Whitley Strieber.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Whitley Strieber");
    });

    it("handles invalid dates", () => {
      const result = parseFilename("990231_Invalid_Date.mp3");
      expect(result.airDate).toBeUndefined();
    });
  });

  describe("Edge cases and messy filenames", () => {
    it("handles underscores in names", () => {
      const result = parseFilename("1997-01-15 Richard_Hoagland_and_John_Lear.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Richard Hoagland And John Lear");
    });

    it("handles multiple dashes", () => {
      const result = parseFilename("1997-01-15--Richard--Hoagland--Area-51.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Richard Hoagland Area 51");
    });

    it("handles extra spaces", () => {
      const result = parseFilename("  1997-01-15   Richard   Hoagland  .mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Richard Hoagland");
    });

    it("handles mixed case show types", () => {
      const result = parseFilename("COAST TO COAST - 1997-01-15 - John Lear.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("John Lear");
      expect(result.showType).toBe("coast");
    });

    it("handles special characters in names", () => {
      const result = parseFilename("1997-01-15 Dr._J._Allen_Hynek.mp3");
      expect(result.airDate).toBe("1997-01-15");
      expect(result.guestName).toBe("Dr. J. Allen Hynek");
    });

    it("handles long guest names with topics", () => {
      const result = parseFilename("dreamland_19980523_whitley_strieber_communion_and_ufo_research.mp3");
      expect(result.airDate).toBe("1998-05-23");
      expect(result.guestName).toBe("Whitley Strieber Communion And Ufo Research");
      expect(result.showType).toBe("dreamland");
    });

    it("handles year 2000+ correctly", () => {
      const result = parseFilename("ab_030115_art_bell_returns.mp3");
      expect(result.airDate).toBe("2003-01-15");
      expect(result.guestName).toBe("Art Bell Returns");
    });

    it("handles year 1988-1999 correctly", () => {
      const result = parseFilename("ab_880101_first_show.mp3");
      expect(result.airDate).toBe("1988-01-01");
      expect(result.guestName).toBe("First Show");
    });
  });

  describe("Fallback behavior", () => {
    it("returns show type for unrecognized formats", () => {
      const result = parseFilename("random_coast_file.mp3");
      expect(result.showType).toBe("coast");
      expect(result.airDate).toBeUndefined();
      expect(result.guestName).toBeUndefined();
    });

    it("finds loose date in filename", () => {
      const result = parseFilename("some_random_file_1997-01-15_here.mp3");
      expect(result.airDate).toBe("1997-01-15");
    });

    it("returns unknown for no patterns matched", () => {
      const result = parseFilename("completely_random.mp3");
      expect(result.showType).toBe("unknown");
      expect(result.airDate).toBeUndefined();
    });
  });

  describe("Consistency with archive parser", () => {
    it("extracts same guest name as archive parser for similar format", () => {
      const scannerResult = parseFilename("1997-01-15 Richard Hoagland.mp3");
      // Archive parser would parse: "1997-01-15 - Coast to Coast AM with Art Bell - Richard Hoagland"
      // Both should extract "Richard Hoagland" as guest
      expect(scannerResult.guestName).toBe("Richard Hoagland");
      expect(scannerResult.airDate).toBe("1997-01-15");
    });

    it("handles date formats consistently", () => {
      const scannerResult = parseFilename("1997-01-15 John Lear.mp3");
      expect(scannerResult.airDate).toBe("1997-01-15");
    });

    it("handles topic keywords consistently", () => {
      const scannerResult = parseFilename("1997-12-31 Open Lines.mp3");
      expect(scannerResult.topic).toBe("Open Lines");
      expect(scannerResult.guestName).toBeUndefined();
    });
  });
});