import { describe, it, expect } from "vitest";
import { STATION_WELCOME_DAYS, stationWelcomeShows, type WelcomeInputs } from "../station-welcome";

/**
 * Who sees "On the air now" above the Library: a desktop browser that arrived
 * new, in its first week, until it tunes in or closes the window. Each case
 * changes one input from a visitor who does see it, so each is its own control.
 */

const DAY = 86_400_000;
const cohort = "2026-11-18";
const arrivedAt = Date.parse(`${cohort}T00:00:00Z`);

function seen(over: Partial<WelcomeInputs> = {}): boolean {
  return stationWelcomeShows({
    arrival: { cohort },
    isMobile: false,
    done: false,
    tuned: false,
    hasEpisode: false,
    now: arrivedAt + 3_600_000,
    ...over,
  });
}

describe("stationWelcomeShows", () => {
  it("shows to a new desktop visitor on the day it arrived", () => {
    expect(seen()).toBe(true);
  });

  it("shows on the last day of the first week, not the day after", () => {
    expect(seen({ now: arrivedAt + STATION_WELCOME_DAYS * DAY - 1 })).toBe(true);
    expect(seen({ now: arrivedAt + STATION_WELCOME_DAYS * DAY })).toBe(false);
  });

  it("never to a browser that arrived with a library", () => {
    expect(seen({ arrival: { excluded: true } })).toBe(false);
  });

  it("never before the funnel's verdict", () => {
    expect(seen({ arrival: null })).toBe(false);
  });

  it("never on a phone (its first screen is already the station)", () => {
    expect(seen({ isMobile: true })).toBe(false);
  });

  it("never once closed or tuned in once", () => {
    expect(seen({ done: true })).toBe(false);
  });

  it("not while tuned in, or while a show is loaded", () => {
    expect(seen({ tuned: true })).toBe(false);
    expect(seen({ hasEpisode: true })).toBe(false);
  });

  it("never for an unreadable cohort", () => {
    expect(seen({ arrival: { cohort: "not-a-day" } })).toBe(false);
  });
});
