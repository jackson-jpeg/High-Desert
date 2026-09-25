import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * HD-027: the archive.org proxies forward what the client sent, so the
 * validation in front of them is the whole of their input handling. These call
 * the real route handlers with `fetch` stubbed and read back the URL that
 * would have gone to archive.org.
 */

import { GET as search } from "../search/route";
import { GET as scrape } from "../scrape/route";
import { GET as metadata } from "../metadata/route";

let ipSeq = 0;
function req(url: string, ip?: string): NextRequest {
  // A fresh address per call unless told otherwise: the limiter is a shared Map.
  ipSeq += 1;
  return new NextRequest(url, { headers: { "x-forwarded-for": ip ?? `203.0.113.${ipSeq % 250}` } });
}

const fetchMock = vi.fn<(url: string, init?: unknown) => Promise<Response>>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/metadata/")) {
      return Response.json({ metadata: { identifier: "x" }, files: [] });
    }
    return Response.json({ response: { numFound: 250, docs: [] } });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

/** The query string that was sent upstream. */
function upstream(): URLSearchParams {
  expect(fetchMock).toHaveBeenCalledTimes(1);
  return new URL(fetchMock.mock.calls[0][0]).searchParams;
}

describe("/api/archive/search", () => {
  it("strips parentheses, so q cannot close the group and escape the Art Bell filter", async () => {
    await search(req("https://highdesert.space/api/archive/search?q=" + encodeURIComponent("x) OR (collection:anything")));
    const q = upstream().get("q")!;
    expect(q).toBe('(x OR collection:anything) AND mediatype:audio AND (creator:"Art Bell" OR title:"Coast to Coast")');
    // Exactly the three groups the route writes itself, balanced.
    expect(q.split("(").length - 1).toBe(2);
    expect(q.split(")").length - 1).toBe(2);
  });

  it("sends a default for a non-numeric rows/page, never NaN", async () => {
    await search(req("https://highdesert.space/api/archive/search?q=ufo&rows=abc&page=zz"));
    const p = upstream();
    expect(p.get("rows")).toBe("30");
    expect(p.get("page")).toBe("1");
  });

  it("clamps rows and page into range", async () => {
    await search(req("https://highdesert.space/api/archive/search?q=ufo&rows=-5&page=-2"));
    let p = upstream();
    expect(p.get("rows")).toBe("1");
    expect(p.get("page")).toBe("1");

    fetchMock.mockClear();
    await search(req("https://highdesert.space/api/archive/search?q=ufo&rows=5000"));
    p = upstream();
    expect(p.get("rows")).toBe("100");
  });
});

describe("/api/archive/scrape", () => {
  it("rows=0 is clamped to 1, so totalPages is a finite number", async () => {
    const res = await scrape(req("https://highdesert.space/api/archive/scrape?rows=0"));
    expect(upstream().get("rows")).toBe("1");
    const body = await res.json();
    expect(body.totalPages).toBe(250);
    expect(Number.isFinite(body.totalPages)).toBe(true);
  });

  it("a non-numeric rows/page gets the default", async () => {
    const res = await scrape(req("https://highdesert.space/api/archive/scrape?rows=nope&page=nope"));
    const p = upstream();
    expect(p.get("rows")).toBe("100");
    expect(p.get("page")).toBe("1");
    expect((await res.json()).totalPages).toBe(3);
  });

  it("caps rows at 200", async () => {
    await scrape(req("https://highdesert.space/api/archive/scrape?rows=9999"));
    expect(upstream().get("rows")).toBe("200");
  });
});

describe("/api/archive/metadata", () => {
  it("is rate-limited per client like search and scrape", async () => {
    const ip = "192.0.2.77";
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push((await metadata(req("https://highdesert.space/api/archive/metadata?id=abc", ip))).status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    // The refused request never reached archive.org.
    expect(fetchMock).toHaveBeenCalledTimes(30);
  });

  it("keys on the client, not globally — another client is still served", async () => {
    const res = await metadata(req("https://highdesert.space/api/archive/metadata?id=abc", "192.0.2.78"));
    expect(res.status).toBe(200);
  });
});
