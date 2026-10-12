import { describe, expect, it } from "vitest";
import { ledTime, marqueeText, nextRate, PLAYBACK_RATES, streamReadout } from "../winamp";

describe("nextRate", () => {
  it("steps through every rate and wraps", () => {
    let r: number = PLAYBACK_RATES[0];
    const seen: number[] = [r];
    for (let i = 1; i < PLAYBACK_RATES.length; i++) {
      r = nextRate(r);
      seen.push(r);
    }
    expect(seen).toEqual([...PLAYBACK_RATES]);
    expect(nextRate(2)).toBe(0.5);
    expect(nextRate(1)).toBe(1.25);
  });
});

describe("ledTime", () => {
  it("counts minutes past 59, as Winamp did", () => {
    expect(ledTime(0, 0, false)).toBe("00:00");
    expect(ledTime(65, 100, false)).toBe("01:05");
    expect(ledTime(172 * 60 + 5, 3 * 3600, false)).toBe("172:05");
  });

  it("shows the time left with a minus", () => {
    expect(ledTime(30, 90, true)).toBe("-01:00");
    expect(ledTime(100, 90, true)).toBe("-00:00");
  });

  it("falls back to elapsed when the length is unknown, and ignores junk", () => {
    expect(ledTime(30, 0, true)).toBe("00:30");
    expect(ledTime(Number.NaN, Number.NaN, false)).toBe("00:00");
    expect(ledTime(-5, 10, false)).toBe("00:00");
  });
});

describe("marqueeText", () => {
  it("numbers the track and adds its length", () => {
    expect(marqueeText({ index: 0, title: "Area 51", duration: 3600 })).toMatch(/^1\. Area 51 \(1:00:00\) {2}\*\*\* {2}$/);
    expect(marqueeText({ index: 4, title: "X", duration: 0 })).toBe("5. X  ***  ");
  });
});

describe("streamReadout", () => {
  it("uses the episode's own figures", () => {
    expect(streamReadout({ bitrate: 128, sampleRate: 48_000 })).toEqual({ kbps: "128", khz: "48", mono: false });
  });

  it("falls back to the common rip", () => {
    expect(streamReadout({})).toEqual({ kbps: "64", khz: "44", mono: true });
  });
});
