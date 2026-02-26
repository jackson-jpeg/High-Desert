import { describe, it, expect } from "vitest";
import { parseArtBellFilename, isArtBellFilename } from "../filename-parser";

describe("parseArtBellFilename", () => {
  it("parses Coast to Coast AM format", () => {
    const result = parseArtBellFilename(
      "1992-12-12 - Coast to Coast AM with Art Bell - Area 51 - John Lear.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.airDate).toBe("1992-12-12");
    expect(result!.showType).toBe("coast");
    expect(result!.showName).toBe("Coast to Coast AM");
    expect(result!.guestName).toBe("Area 51");
    expect(result!.topic).toBe("John Lear");
  });

  it("parses Dreamland format", () => {
    const result = parseArtBellFilename(
      "1994-04-03 - Dreamland with Art Bell - Aliens, Abductions and More - Budd Hopkins.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.showType).toBe("dreamland");
    expect(result!.showName).toBe("Dreamland");
    expect(result!.guestName).toBe("Aliens, Abductions and More");
  });

  it("parses Dark Matter format", () => {
    const result = parseArtBellFilename(
      "2013-10-16 - Dark Matter with Art Bell - Tobias McGriff - James Fox - UFO Research.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.showType).toBe("coast");
    expect(result!.showName).toBe("Dark Matter");
    expect(result!.guestName).toBe("Tobias McGriff");
  });

  it("parses Gabcast format", () => {
    const result = parseArtBellFilename(
      "2013-11-12 - Gabcast - Art Calls into the Gabcast.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.showType).toBe("special");
    expect(result!.showName).toBe("Gabcast");
    expect(result!.guestName).toBe("Art Calls into the Gabcast");
  });

  it("returns null for missing date", () => {
    expect(parseArtBellFilename("random-file.mp3")).toBeNull();
  });

  it("strips file extensions", () => {
    const result = parseArtBellFilename(
      "1997-07-04 - Coast to Coast AM with Art Bell - Open Lines.flac",
    );
    expect(result).not.toBeNull();
    expect(result!.guestName).toBe("Open Lines");
  });

  it("handles single segment after show name", () => {
    const result = parseArtBellFilename(
      "2000-01-01 - Coast to Coast AM with Art Bell - Y2K Special.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.guestName).toBe("Y2K Special");
    expect(result!.topic).toBeUndefined();
  });

  it("parses Midnight in the Desert format", () => {
    const result = parseArtBellFilename(
      "2015-07-20 - Midnight in the Desert with Art Bell - Time Travel - Dr. David Anderson.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.airDate).toBe("2015-07-20");
    expect(result!.showType).toBe("special");
    expect(result!.showName).toBe("Midnight in the Desert");
    expect(result!.guestName).toBe("Time Travel");
    expect(result!.topic).toBe("Dr. David Anderson");
  });

  it("parses Area 2000 format", () => {
    const result = parseArtBellFilename(
      "1996-08-15 - Area 2000 - Secret Space Program - Richard Hoagland.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.airDate).toBe("1996-08-15");
    expect(result!.showType).toBe("special");
    expect(result!.showName).toBe("Area 2000");
    expect(result!.guestName).toBe("Secret Space Program");
    expect(result!.topic).toBe("Richard Hoagland");
  });

  it("handles multiple guests correctly", () => {
    const result = parseArtBellFilename(
      "1998-03-14 - Coast to Coast AM with Art Bell - Remote Viewing - Major Ed Dames - Lyn Buchanan - Joe McMoneagle.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.airDate).toBe("1998-03-14");
    expect(result!.showType).toBe("coast");
    expect(result!.showName).toBe("Coast to Coast AM");
    expect(result!.guestName).toBe("Remote Viewing");
    expect(result!.topic).toBe("Major Ed Dames - Lyn Buchanan - Joe McMoneagle");
  });

  it("handles topic-only episodes", () => {
    const result = parseArtBellFilename(
      "1999-12-31 - Coast to Coast AM with Art Bell - Y2K Countdown Special.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.airDate).toBe("1999-12-31");
    expect(result!.showType).toBe("coast");
    expect(result!.showName).toBe("Coast to Coast AM");
    expect(result!.guestName).toBe("Y2K Countdown Special");
    expect(result!.topic).toBeUndefined();
  });

  it("handles various date formats with spaces", () => {
    const result = parseArtBellFilename(
      "1992-12-12-Coast to Coast AM with Art Bell-Open Lines.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.airDate).toBe("1992-12-12");
    expect(result!.showType).toBe("coast");
    expect(result!.showName).toBe("Coast to Coast AM");
    expect(result!.guestName).toBe("Open Lines");
  });

  it("handles lowercase show names", () => {
    const result = parseArtBellFilename(
      "2001-01-01 - coast to coast am with art bell - open lines.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.airDate).toBe("2001-01-01");
    expect(result!.showType).toBe("coast");
    expect(result!.showName).toBe("coast to coast am");
    expect(result!.guestName).toBe("open lines");
  });
});9-11 - coast to coast am with art bell - 9/11 Special.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.airDate).toBe("2001-09-11");
    expect(result!.showType).toBe("coast");
    expect(result!.showName).toBe("Coast to Coast AM");
    expect(result!.guestName).toBe("9/11 Special");
  });

  it("handles Dreamland without 'with Art Bell'", () => {
    const result = parseArtBellFilename(
      "1995-06-15 - Dreamland - Crop Circles - Colin Andrews.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.airDate).toBe("1995-06-15");
    expect(result!.showType).toBe("dreamland");
    expect(result!.showName).toBe("Dreamland");
    expect(result!.guestName).toBe("Crop Circles");
    expect(result!.topic).toBe("Colin Andrews");
  });

  it("returns null for invalid date format", () => {
    expect(parseArtBellFilename("92-12-12 - Coast to Coast AM - Guest.mp3")).toBeNull();
  });

  it("returns null for missing show name", () => {
    expect(parseArtBellFilename("1992-12-12 - Guest Name.mp3")).toBeNull();
  });

  it("handles empty guest/topic segments", () => {
    const result = parseArtBellFilename(
      "1993-01-01 - Coast to Coast AM with Art Bell.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.airDate).toBe("1993-01-01");
    expect(result!.showType).toBe("coast");
    expect(result!.showName).toBe("Coast to Coast AM");
    expect(result!.guestName).toBeUndefined();
    expect(result!.topic).toBeUndefined();
  });

  it("generates correct title format", () => {
    const result = parseArtBellFilename(
      "1994-11-05 - Dreamland with Art Bell - Alien Abduction - Budd Hopkins.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.title).toBe("1994-11-05 - Dreamland - Alien Abduction - Budd Hopkins");
  });

  it("handles title without guest or topic", () => {
    const result = parseArtBellFilename(
      "1993-01-01 - Coast to Coast AM with Art Bell.mp3",
    );
    expect(result).not.toBeNull();
    expect(result!.title).toBe("1993-01-01 - Coast to Coast AM");
  });

describe("isArtBellFilename", () => {
  it("returns true for dated filenames", () => {
    expect(isArtBellFilename("1997-07-04 - Coast to Coast.mp3")).toBe(true);
  });

  it("returns false for non-dated filenames", () => {
    expect(isArtBellFilename("random-file.mp3")).toBe(false);
  });
});
