import { describe, it, expect, beforeEach } from "vitest";
import { useScannerStore } from "../scanner-store";

/**
 * Progress state for a local-file scan. The property worth pinning is that
 * starting a scan clears the previous one's counters: a second scan that
 * inherited the first's `newEpisodes` would report work it did not do, and the
 * scanner is an admin tool people run repeatedly in one session.
 */

const s = () => useScannerStore.getState();

beforeEach(() => {
  s().reset();
});

describe("starting a scan", () => {
  it("clears the previous run's counters", () => {
    s().updateProgress({ totalFiles: 40, processedFiles: 40, newEpisodes: 12, duplicates: 3 });
    s().addError("could not read foo.mp3");
    s().setCompleted();

    s().startScan();

    expect(s().status).toBe("scanning");
    expect(s().totalFiles).toBe(0);
    expect(s().processedFiles).toBe(0);
    expect(s().newEpisodes).toBe(0);
    expect(s().duplicates).toBe(0);
    expect(s().errors).toBe(0);
    expect(s().errorMessages).toEqual([]);
  });
});

describe("progress", () => {
  it("merges a partial update without clearing the fields it omits", () => {
    s().startScan();
    s().updateProgress({ totalFiles: 100 });
    s().updateProgress({ processedFiles: 10, currentFile: "1997-07-28.mp3" });

    expect(s().totalFiles).toBe(100);
    expect(s().processedFiles).toBe(10);
    expect(s().currentFile).toBe("1997-07-28.mp3");
  });

  it("finishing clears the current file so the UI does not freeze on the last name", () => {
    s().startScan();
    s().updateProgress({ currentFile: "1997-07-28.mp3" });

    s().setCompleted();
    expect(s().status).toBe("completed");
    expect(s().currentFile).toBe("");

    s().startScan();
    s().updateProgress({ currentFile: "x.mp3" });
    s().setCancelled();
    expect(s().status).toBe("cancelled");
    expect(s().currentFile).toBe("");
  });
});

describe("errors", () => {
  it("counts every error, and keeps the message", () => {
    s().addError("a");
    s().addError("b");
    expect(s().errors).toBe(2);
    expect(s().errorMessages).toEqual(["a", "b"]);
  });

  it("keeps the LAST hundred messages while still counting all of them", () => {
    // Which end is kept matters. A scan that fails on every file produces
    // thousands; the ones worth seeing are the most recent, and the count must
    // not be capped along with the list or the summary under-reports.
    for (let i = 1; i <= 150; i++) s().addError(`error ${i}`);

    expect(s().errors).toBe(150);
    expect(s().errorMessages).toHaveLength(100);
    expect(s().errorMessages[0]).toBe("error 51");
    expect(s().errorMessages.at(-1)).toBe("error 150");
  });

  it("reset returns to idle", () => {
    s().startScan();
    s().addError("boom");
    s().reset();

    expect(s().status).toBe("idle");
    expect(s().errors).toBe(0);
    expect(s().errorMessages).toEqual([]);
  });
});
