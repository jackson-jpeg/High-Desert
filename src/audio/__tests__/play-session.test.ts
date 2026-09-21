import { describe, it, expect, beforeEach } from "vitest";
import {
  __testing,
  beginStart,
  currentStart,
  isAbortError,
  isCurrentStart,
  isListenCounted,
  markListenCounted,
  startPositionFor,
} from "../play-session";

beforeEach(() => __testing.reset());

describe("start generations", () => {
  it("a newer start supersedes every older one", () => {
    const a = beginStart();
    const b = beginStart();
    expect(isCurrentStart(a)).toBe(false);
    expect(isCurrentStart(b)).toBe(true);
    expect(currentStart()).toBe(b);
  });

  it("the counted flag belongs to one start and resets with the next", () => {
    const a = beginStart();
    expect(isListenCounted()).toBe(false);
    markListenCounted(a);
    expect(isListenCounted()).toBe(true);
    beginStart();
    expect(isListenCounted()).toBe(false);
    markListenCounted(a); // a stale start cannot mark the new source counted
    expect(isListenCounted()).toBe(false);
  });

  it("recognises AbortError by name, whatever threw it", () => {
    expect(isAbortError(new DOMException("x", "AbortError"))).toBe(true);
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new DOMException("x", "NotAllowedError"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe("startPositionFor (HD-004)", () => {
  it("restarts a show saved within 30 s of its end", () => {
    expect(startPositionFor(10_797, 10_800)).toBe(0);
    expect(startPositionFor(10_771, 10_800)).toBe(0);
  });

  it("restarts a show saved past 95% even if more than 30 s remain", () => {
    // A 20-minute special: 95% is 60 s from the end.
    expect(startPositionFor(1_150, 1_200)).toBe(0);
  });

  it("resumes anything earlier", () => {
    expect(startPositionFor(615, 10_800)).toBe(615);
    expect(startPositionFor(10_000, 10_800)).toBe(10_000); // 92.6%, 800 s left
  });

  it("resumes when the duration is unknown — a missing duration is not evidence", () => {
    expect(startPositionFor(615, 0)).toBe(615);
    expect(startPositionFor(615, undefined)).toBe(615);
    expect(startPositionFor(615, NaN)).toBe(615);
  });

  it("treats nothing saved as the top", () => {
    expect(startPositionFor(undefined, 10_800)).toBe(0);
    expect(startPositionFor(-3, 10_800)).toBe(0);
  });
});
