// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createGateway } from "../lib/gateway.mjs";
import { clientOptions } from "../lib/client-options.mjs";

/**
 * MIRROR_SEED=0 (2026-09-25): seeding 338 pins to a swarm with no outside
 * peers held highdesert-mirror at a third of the box's CPU. Fetch-only mode
 * still reads the pins — they are what protects a file from eviction — but
 * adds no torrent for them and announces nothing.
 */
function stubCache() {
  const cache = {
    pins: new Set(),
    loads: 0,
    async loadPins() {
      cache.loads++;
      cache.pins = new Set(["a".repeat(40), "b".repeat(40)]);
    },
    isComplete: async () => true,
  };
  return cache;
}

describe("fetch-only mode", () => {
  it("seedPins({ seed: false }) reads the pins and adds no torrent", async () => {
    const cache = stubCache();
    const added = [];
    const client = { add: (...a) => (added.push(a), { on() {}, once() {} }), get: () => null, torrents: [] };
    const logs = [];
    // As in the control below, each attempt to seed a pin with no .torrent on
    // disk is logged — so an empty log means no attempt was made at all.
    const g = createGateway({ cache, torrentDir: "/nonexistent", index: {}, client, log: (m) => logs.push(m) });
    await g.seedPins({ seed: false });
    expect(logs.filter((m) => m.startsWith("cannot seed"))).toEqual([]);
    expect(cache.loads).toBe(1);
    expect(cache.pins.size).toBe(2);
    expect(added).toEqual([]);
    expect(g.active.size).toBe(0);
  });

  it("control: seedPins() with seeding on does try to add each complete pin", async () => {
    const cache = stubCache();
    const tried = [];
    const g = createGateway({ cache, torrentDir: "/nonexistent", index: {}, client: {}, log: (m) => tried.push(m) });
    await g.seedPins();
    // No .torrent files exist here, so each add fails — and is logged, once per pin.
    expect(tried.filter((m) => m.startsWith("cannot seed"))).toHaveLength(2);
  });

  it("MIRROR_SEED=0 turns off the DHT and the trackers", async () => {
    const off = await clientOptions({ MIRROR_SEED: "0" }, { bootstrap: async () => ["192.0.2.10:6881"] });
    expect(off.dht).toBe(false);
    expect(off.tracker).toBe(false);
    const on = await clientOptions({}, { bootstrap: async () => ["192.0.2.10:6881"] });
    expect(on.dht).toEqual({ bootstrap: ["192.0.2.10:6881"] });
    expect(on.tracker).toBeUndefined();
  });
});
