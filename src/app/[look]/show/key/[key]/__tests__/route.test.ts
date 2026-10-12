// @vitest-environment node
import { describe, it, expect } from "vitest";
import { GET } from "../route";

/** The library's "Show page" link lands here and is sent on to the slug (docs/show-pages.md). */

const call = (key: string, query = "") => GET(new Request(`http://127.0.0.1/show/key/${key}${query}`), { params: Promise.resolve({ key }) });
const AREA_51 = "ultimate-ultimate-art-bell-collection--1992-12-12_-_Coast_to_Coast_AM_with_Art_Bell_-_Area_51_-_John_Lear_-_Bob_Lazar";

describe("/show/key/<communityKey>", () => {
  it("is a permanent redirect to the show's page, relative to this site", async () => {
    const res = await call("ultimate-ultimate-art-bell-collection--1992-12-12_-_Coast_to_Coast_AM_with_Art_Bell_-_Area_51_-_John_Lear_-_Bob_Lazar");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/show/1992-12-12-area-51-john-lear-bob-lazar");
  });

  it("carries a moment's second to the show page, and drops a malformed one", async () => {
    expect((await call(AREA_51, "?t=5025")).headers.get("location")).toBe("/show/1992-12-12-area-51-john-lear-bob-lazar?t=5025");
    expect((await call(AREA_51, "?t=1h")).headers.get("location")).toBe("/show/1992-12-12-area-51-john-lear-bob-lazar");
  });

  it("is a 404 for a key that is no show", async () => {
    expect((await call("coll--nothing")).status).toBe(404);
  });
});
