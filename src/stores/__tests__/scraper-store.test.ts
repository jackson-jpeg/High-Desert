import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useScraperStore } from "../scraper-store";

/**
 * Progress for the archive.org catalog scrape — a long, multi-phase job an admin
 * watches. Note this store's error policy is the OPPOSITE of scanner-store's:
 * that one keeps the last 100, this one keeps the FIRST 200 and drops the rest.
 * Both are defensible and neither is documented anywhere else, so both are
 * pinned in their own file.
 */

const s = () => useScraperStore.getState();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-29T00:00:00Z"));
  s().reset();
});
afterEach(() => vi.useRealTimers());

describe("starting a scrape", () => {
  it("clears the previous run and stamps the start time", () => {
    s().updateProgress({ fetched: 900, imported: 40, errors: 2 });
    s().addError("stale");

    s().start();

    expect(s().phase).toBe("scraping");
    expect(s().fetched).toBe(0);
    expect(s().imported).toBe(0);
    expect(s().errors).toBe(0);
    expect(s().errorMessages).toEqual([]);
    expect(s().startedAt).toBe(Date.parse("2026-07-29T00:00:00Z"));
    expect(s().currentItem).toBeNull();
  });

  it("records when the scraping phase began", () => {
    s().start();
    expect(s().phaseTimes.scraping).toBe(Date.parse("2026-07-29T00:00:00Z"));
  });
});

describe("phases", () => {
  it("timestamps each phase as it is entered, keeping the earlier ones", () => {
    s().start();
    vi.setSystemTime(Date.parse("2026-07-29T00:05:00Z"));
    s().setPhase("importing");
    vi.setSystemTime(Date.parse("2026-07-29T00:09:00Z"));
    s().setPhase("categorizing");

    expect(s().phase).toBe("categorizing");
    expect(s().phaseTimes.scraping).toBe(Date.parse("2026-07-29T00:00:00Z"));
    expect(s().phaseTimes.importing).toBe(Date.parse("2026-07-29T00:05:00Z"));
    expect(s().phaseTimes.categorizing).toBe(Date.parse("2026-07-29T00:09:00Z"));
  });

  it("clears the current item on a phase change", () => {
    // Otherwise the panel goes on naming an identifier from the previous phase
    // while the new one has not reported anything yet.
    s().start();
    s().setCurrentItem("ultimate-art-bell-1997");
    s().setPhase("importing");
    expect(s().currentItem).toBeNull();
  });

  it("carries the current item while one phase is running", () => {
    s().start();
    s().setCurrentItem("a");
    expect(s().currentItem).toBe("a");
    s().setCurrentItem(null);
    expect(s().currentItem).toBeNull();
  });
});

describe("errors", () => {
  it("counts every error", () => {
    s().addError("a");
    s().addError("b");
    expect(s().errors).toBe(2);
    expect(s().errorMessages).toEqual(["a", "b"]);
  });

  it("keeps the FIRST two hundred messages and keeps counting past that", () => {
    // Opposite end to scanner-store, deliberately: a scrape that goes wrong
    // usually goes wrong the same way from the start, and the first failures
    // are the diagnostic ones. The count must not stop at the cap.
    for (let i = 1; i <= 250; i++) s().addError(`error ${i}`);

    expect(s().errors).toBe(250);
    expect(s().errorMessages).toHaveLength(200);
    expect(s().errorMessages[0]).toBe("error 1");
    expect(s().errorMessages.at(-1)).toBe("error 200");
  });

  it("reset clears the timings as well as the counters", () => {
    s().start();
    s().setPhase("importing");
    s().addError("boom");

    s().reset();

    expect(s().phase).toBe("idle");
    expect(s().startedAt).toBeNull();
    expect(s().phaseTimes).toEqual({});
    expect(s().errorMessages).toEqual([]);
    expect(s().errors).toBe(0);
  });
});
