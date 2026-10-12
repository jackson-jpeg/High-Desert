// @vitest-environment node
import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../route";

/** The Share buttons ask here for a show's page by its community key (src/lib/shows/share.ts). */

const call = (key: string) => GET(new NextRequest(`http://127.0.0.1/api/shows/link?key=${encodeURIComponent(key)}`));
const AREA_51 = "ultimate-ultimate-art-bell-collection--1992-12-12_-_Coast_to_Coast_AM_with_Art_Bell_-_Area_51_-_John_Lear_-_Bob_Lazar";

describe("/api/shows/link", () => {
  it("answers a catalog show's slug and page, cacheable for a day", async () => {
    const res = await call(AREA_51);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slug: "1992-12-12-area-51-john-lear-bob-lazar", path: "/show/1992-12-12-area-51-john-lear-bob-lazar" });
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("is a 404 for a key that is no catalog show, and a 400 for a malformed one", async () => {
    expect((await call("coll--nothing")).status).toBe(404);
    expect((await call("not a key")).status).toBe(400);
  });
});
