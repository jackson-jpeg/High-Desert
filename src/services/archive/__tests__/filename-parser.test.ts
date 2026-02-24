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
});

describe("isArtBellFilename", () => {
  it("returns true for dated filenames", () => {
    expect(isArtBellFilename("1997-07-04 - Coast to Coast.mp3")).toBe(true);
  });

  it("returns false for non-dated filenames", () => {
    expect(isArtBellFilename("random-file.mp3")).toBe(false);
  });
});
