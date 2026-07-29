import { describe, it, expect, beforeEach } from "vitest";
import { useSearchStore } from "../search-store";

/**
 * The archive.org import panel tracks in-flight adds in two Sets. Sets are the
 * hazard here: mutating one in place leaves the reference unchanged, Zustand's
 * default equality sees no change, and the spinner on the row never clears
 * while the import actually succeeded. So these tests assert on identity as
 * well as content.
 */

const s = () => useSearchStore.getState();

beforeEach(() => {
  s().reset();
});

describe("tracking an in-flight add", () => {
  it("moves an id from adding to added", () => {
    s().startAdding("coast-1997-07-28");
    expect(s().addingIds.has("coast-1997-07-28")).toBe(true);
    expect(s().addedIds.has("coast-1997-07-28")).toBe(false);

    s().finishAdding("coast-1997-07-28");
    expect(s().addingIds.has("coast-1997-07-28")).toBe(false);
    expect(s().addedIds.has("coast-1997-07-28")).toBe(true);
  });

  it("replaces the Set rather than mutating it, so React sees the change", () => {
    const before = s().addingIds;
    s().startAdding("a");
    expect(s().addingIds).not.toBe(before);
    // And the old reference must not have been written through.
    expect(before.has("a")).toBe(false);
  });

  it("finishing one add leaves other in-flight adds alone", () => {
    s().startAdding("a");
    s().startAdding("b");
    s().finishAdding("a");

    expect([...s().addingIds]).toEqual(["b"]);
    expect([...s().addedIds]).toEqual(["a"]);
  });

  it("markAdded takes a batch without disturbing what is already there", () => {
    s().finishAdding("a");
    s().markAdded(["b", "c"]);
    expect([...s().addedIds].sort()).toEqual(["a", "b", "c"]);
  });

  it("markAdded with an empty batch is a no-op, not a wipe", () => {
    s().finishAdding("a");
    s().markAdded([]);
    expect([...s().addedIds]).toEqual(["a"]);
  });
});

describe("results and errors", () => {
  it("a fresh result set clears any previous error", () => {
    s().setError("archive.org timed out");
    expect(s().error).toBe("archive.org timed out");

    s().setResults([], 0, 1);
    expect(s().error).toBeNull();
  });

  it("setting an error also stops the loading state", () => {
    // Otherwise the panel shows a spinner and an error message at once, and the
    // spinner never goes away.
    s().setLoading(true);
    s().setError("boom");
    expect(s().loading).toBe(false);
  });

  it("reset clears everything, including the two Sets", () => {
    s().setQuery("art bell");
    s().setLoading(true);
    s().startAdding("a");
    s().finishAdding("a");
    s().setError("boom");

    s().reset();

    expect(s().query).toBe("");
    expect(s().results).toEqual([]);
    expect(s().totalResults).toBe(0);
    expect(s().page).toBe(1);
    expect(s().loading).toBe(false);
    expect(s().error).toBeNull();
    expect(s().addingIds.size).toBe(0);
    expect(s().addedIds.size).toBe(0);
  });
});
