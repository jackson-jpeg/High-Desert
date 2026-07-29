import { describe, it, expect, beforeEach } from "vitest";
import { useRadioDialStore } from "../radio-dial-store";

/**
 * The radio dial converts pointer deltas into a tuning position. Every setter
 * here exists to keep a stray NaN out of that position: the dial's transform is
 * derived from it, and once it is NaN the strip disappears and nothing the user
 * does brings it back — a broken page with no error anywhere.
 */

const s = () => useRadioDialStore.getState();

beforeEach(() => {
  useRadioDialStore.setState({
    position: 0,
    lockedEpisode: null,
    signalStrength: 0,
    scanning: null,
    staticEnabled: true,
    subStationIndex: 0,
    zoom: 2,
  });
});

describe("position stays a number", () => {
  it("refuses a non-finite position", () => {
    s().setPosition(NaN);
    expect(s().position).toBe(0);
    s().setPosition(Infinity);
    expect(s().position).toBe(0);
  });

  it("ignores a non-finite tuning delta rather than poisoning the position", () => {
    s().setPosition(120);
    s().tune(NaN);
    expect(s().position).toBe(120);
  });

  it("tunes relative to where the dial already is, in both directions", () => {
    s().setPosition(100);
    s().tune(25);
    expect(s().position).toBe(125);
    s().tune(-50);
    expect(s().position).toBe(75);
  });

  it("holds a position that overflows to a non-finite value", () => {
    s().setPosition(Number.MAX_VALUE);
    s().tune(Number.MAX_VALUE);
    expect(Number.isFinite(s().position)).toBe(true);
  });
});

describe("moving the dial resets the sub-station", () => {
  it("setPosition clears it", () => {
    // Sub-stations are the several episodes sharing one air date. Keeping index
    // 3 after tuning to a date that has one episode reads as an empty station.
    useRadioDialStore.setState({ subStationIndex: 3 });
    s().setPosition(500);
    expect(s().subStationIndex).toBe(0);
  });

  it("tune clears it too", () => {
    useRadioDialStore.setState({ subStationIndex: 3 });
    s().tune(1);
    expect(s().subStationIndex).toBe(0);
  });
});

describe("clamping", () => {
  it("zoom is held between 0.5 and 10 px per day", () => {
    s().setZoom(0);
    expect(s().zoom).toBe(0.5);
    s().setZoom(9999);
    expect(s().zoom).toBe(10);
    s().setZoom(4);
    expect(s().zoom).toBe(4);
  });

  it("signal strength is held to 0..1", () => {
    // It drives an opacity and a meter width; outside 0..1 the meter renders
    // past its own frame.
    s().setSignalStrength(-3);
    expect(s().signalStrength).toBe(0);
    s().setSignalStrength(50);
    expect(s().signalStrength).toBe(1);
    s().setSignalStrength(0.42);
    expect(s().signalStrength).toBe(0.42);
  });
});

describe("scanning and static", () => {
  it("scans in a direction and stops", () => {
    s().startScan("forward");
    expect(s().scanning).toBe("forward");
    s().startScan("backward");
    expect(s().scanning).toBe("backward");
    s().stopScan();
    expect(s().scanning).toBeNull();
  });

  it("toggles static on and off from whatever it currently is", () => {
    expect(s().staticEnabled).toBe(true);
    s().toggleStatic();
    expect(s().staticEnabled).toBe(false);
    s().toggleStatic();
    expect(s().staticEnabled).toBe(true);
  });
});
