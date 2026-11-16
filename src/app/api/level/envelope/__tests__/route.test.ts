// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { unpackEnvelope, ENVELOPE_VERSION } from "@/lib/audio/level-envelope";

/** /api/level/envelope: a catalog show's two-pass envelope, binary; a 404 while it has none. */

const readEnvelope = vi.fn(async (_h: string, _v: number): Promise<Int8Array | null> => null);
vi.mock("@/services/stats/db/envelopes", () => ({ readEnvelope }));
const { GET } = await import("../route");

const AREA_51 = "ultimate-ultimate-art-bell-collection--1992-12-12_-_Coast_to_Coast_AM_with_Art_Bell_-_Area_51_-_John_Lear_-_Bob_Lazar";
let ip = 0;
const call = (key: string) => {
  ip += 1;
  return GET(new NextRequest(`http://127.0.0.1/api/level/envelope?key=${encodeURIComponent(key)}`, { headers: { "x-forwarded-for": `10.9.0.${ip}` } }));
};

beforeEach(() => {
  readEnvelope.mockClear();
  process.env.DATABASE_URL = "postgres://test";
});

describe("/api/level/envelope", () => {
  it("serves the stored envelope for the show's file, binary, cacheable a day", async () => {
    readEnvelope.mockResolvedValueOnce(new Int8Array([0, 4, -8]));
    const res = await call(AREA_51);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    const e = unpackEnvelope(await res.arrayBuffer())!;
    expect(Array.from(e.gainDb)).toEqual([0, 1, -2]);
    const [hash, version] = readEnvelope.mock.calls[0];
    expect(hash).toMatch(/^archive:ultimate-ultimate-art-bell-collection:1992-12-12 /);
    expect(version).toBe(ENVELOPE_VERSION);
  });

  it("no envelope yet: 404 none, cached briefly (one may arrive)", async () => {
    const res = await call(AREA_51);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "none" });
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("is a 404 for a key that is no catalog show and a 400 for a malformed one, without asking the database", async () => {
    expect((await call("coll--nothing")).status).toBe(404);
    expect((await call("not a key")).status).toBe(400);
    expect(readEnvelope).not.toHaveBeenCalled();
  });

  it("a database error is a 503, never a broken player", async () => {
    readEnvelope.mockRejectedValueOnce(new Error("down"));
    expect((await call(AREA_51)).status).toBe(503);
  });
});
