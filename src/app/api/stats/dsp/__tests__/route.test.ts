// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { DSP_EVENTS } from "@/lib/audio/dsp-events";

/** /api/stats/dsp: only the vocabulary is counted, and the schema agrees with it. */

const recordDspEvent = vi.fn(async () => {});
const dspTotals = vi.fn(async () => Object.fromEntries(DSP_EVENTS.map((e) => [e, 0])));
vi.mock("@/services/stats/db/dsp", () => ({ recordDspEvent, dspTotals }));
const { POST, GET } = await import("../route");

let ip = 0;
function post(body: unknown) {
  ip += 1;
  return POST(
    new NextRequest("http://localhost/api/stats/dsp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": `10.8.0.${ip}` },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  recordDspEvent.mockClear();
  dspTotals.mockClear();
});

describe("POST /api/stats/dsp", () => {
  it("counts every event in the vocabulary, once each", async () => {
    for (const event of DSP_EVENTS) {
      const r = await post({ event });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ ok: true });
    }
    expect(recordDspEvent.mock.calls.map((c) => (c as unknown[])[0])).toEqual([...DSP_EVENTS]);
  });

  it("refuses anything else, and stores nothing for it", async () => {
    for (const b of [{ event: "level" }, { event: "LEVEL-ON" }, { event: 1 }, {}, { event: "fallback-cors" }]) {
      expect((await post(b)).status).toBe(400);
    }
    expect(recordDspEvent).not.toHaveBeenCalled();
  });
});

describe("GET /api/stats/dsp", () => {
  it("answers 7, 30 or 90 days, else 7", async () => {
    for (const [q, d] of [["30", 30], ["90", 90], ["5", 7], ["", 7]] as const) {
      const r = await GET(new NextRequest(`http://localhost/api/stats/dsp?days=${q}`, { headers: { "x-forwarded-for": `10.8.1.${d}` } }));
      expect(r.status).toBe(200);
      expect((await r.json()).days).toBe(d);
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect(dspTotals.mock.calls.map((c) => (c as unknown[])[0])).toEqual([30, 90, 7, 7]);
  });
});

describe("the schema", () => {
  it("allows exactly the events the app sends", () => {
    const sql = readFileSync("scripts/schema.sql", "utf8");
    const block = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS dsp_daily"));
    const check = block.slice(block.indexOf("CHECK (event IN ("), block.indexOf("))"));
    const words = [...check.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(words).toEqual([...DSP_EVENTS]);
  });
});
