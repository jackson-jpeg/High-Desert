import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Dexie from "dexie";

/**
 * A first seed says "Loaded N episodes from catalog", except on the station,
 * where that toast sat on a phone's one Listen live tap. Driven through the
 * real seed against fake-indexeddb, with the real catalog served.
 */

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), caller: vi.fn() }));
vi.mock("@/stores/toast-store", () => ({ toast, useToastStore: { getState: () => ({ toasts: [] }) } }));

const catalogJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../public/seed/library.json"), "utf8"));

beforeEach(async () => {
  toast.success.mockClear();
  await Dexie.delete("HighDesertDB");
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: () => Promise.resolve(catalogJson) }) as Response));
});

afterEach(async () => {
  const { db } = await import("../index");
  db.close();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

async function seedAt(pathname: string) {
  window.history.replaceState({}, "", pathname);
  const { seedLibraryIfEmpty } = await import("../seed");
  expect(await seedLibraryIfEmpty()).toBe(true);
}

describe("the first seed's toast", () => {
  it("is shown in the library", async () => {
    await seedAt("/library");
    expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^Loaded [\d,]+ episodes from catalog$/));
  });

  it("is not shown on the station, where it would cover Listen live", async () => {
    await seedAt("/live");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("only /live itself is the station", async () => {
    const { announcesSeed } = await import("../seed");
    expect(announcesSeed("/live/")).toBe(false);
    expect(announcesSeed("/lively")).toBe(true);
    expect(announcesSeed("/")).toBe(true);
  });
});
