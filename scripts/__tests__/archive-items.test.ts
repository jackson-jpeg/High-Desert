// @vitest-environment node
import { describe, expect, it } from "vitest";
import http from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { archiveUrls, itemEntry } from "../archive-items.mjs";
import { check } from "../verify-live-day.mjs";
import { directFromItems } from "../../services/mirror/lib/nginx.mjs";

/**
 * When archive.org's /download fails (2026-10-11: one failing cache node for
 * everyone, then "Sorry, we're kinda busy"), whole-file readers fall back to
 * the collection's own servers from data/archive-items.json.
 */

const ITEMS = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../data/archive-items.json"), "utf8"));
const CATALOG = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../public/seed/library.json"), "utf8"));

function mp3(frames: number): Buffer {
  const buf = Buffer.alloc(417 * frames);
  for (let i = 0; i < frames; i++) buf.writeUInt32BE(0xfffb9004, i * 417);
  return buf;
}

describe("data/archive-items.json", () => {
  it("names a server and a directory for every collection in the catalog", () => {
    const ids = new Set(CATALOG.map((r: { archiveIdentifier?: string }) => r.archiveIdentifier).filter(Boolean));
    for (const id of ids) {
      expect(ITEMS[id], id).toBeTruthy();
      expect(ITEMS[id].servers[0]).toMatch(/^[a-z0-9.-]+\.archive\.org$/);
      expect(ITEMS[id].dir).toBe(ITEMS[id].dir.replace(/[^A-Za-z0-9._/-]/g, ""));
    }
  });

  it("the mirror's nginx gets each collection's first server", () => {
    const d = directFromItems(ITEMS);
    expect(d["ultimate-ultimate-art-bell-collection"]).toBe(`https://${ITEMS["ultimate-ultimate-art-bell-collection"].servers[0]}${ITEMS["ultimate-ultimate-art-bell-collection"].dir}`);
  });

  it("itemEntry refuses anything that is not an archive.org server and a plain path", () => {
    expect(itemEntry({ d1: "ia1.us.archive.org", dir: "/1/items/x" })).toEqual({ servers: ["ia1.us.archive.org"], dir: "/1/items/x" });
    expect(itemEntry({ d1: "evil.example.com", dir: "/1/items/x" })).toBeNull();
    expect(itemEntry({ d1: "ia1.us.archive.org", dir: "/1/items/x y" })).toBeNull();
  });
});

describe("archiveUrls", () => {
  it("/download first, then each own server, the name encoded once", () => {
    const row = CATALOG.find((r: { archiveIdentifier: string }) => r.archiveIdentifier === "ultimate-ultimate-art-bell-collection");
    const urls = archiveUrls(row, ITEMS);
    expect(urls[0]).toBe(row.sourceUrl);
    expect(urls.slice(1)).toEqual(ITEMS[row.archiveIdentifier].servers.map((s: string) => `https://${s}${ITEMS[row.archiveIdentifier].dir}/${encodeURIComponent(row.fileName)}`));
    // The same path archive.org's own /download URL ends in.
    expect(new URL(urls[1]).pathname.split("/").pop()).toBe(new URL(row.sourceUrl).pathname.split("/").pop());
  });

  it("a collection it does not know: /download only", () => {
    expect(archiveUrls({ sourceUrl: "https://archive.org/download/x/a.mp3", archiveIdentifier: "x", fileName: "a.mp3" }, ITEMS)).toEqual(["https://archive.org/download/x/a.mp3"]);
  });
});

describe("a walk falls back when /download fails", () => {
  it("/download 502, the own server serves: walked, and said so", async () => {
    const body = mp3(400);
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(req.url!);
      if (req.url!.startsWith("/download/")) {
        res.writeHead(502);
        return res.end("Sorry, we're kinda busy");
      }
      res.writeHead(200, { "content-length": body.length });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    try {
      const row = { fileHash: "archive:c:a b.mp3", archiveIdentifier: "c", fileName: "a b.mp3", sourceUrl: `http://127.0.0.1:${port}/download/c/a%20b.mp3`, duration: 10 };
      const items = { c: { servers: ["unused"], dir: "/x" } };
      // archiveUrls builds https URLs to archive.org hosts; point the fallback at the stub instead.
      const urls = [row.sourceUrl, `http://127.0.0.1:${port}/1/items/c/a%20b.mp3`];
      const r = await check(row, { stateDir: "/nonexistent", repaired: new Set(), items, urlsFor: () => urls });
      expect(r).toMatchObject({ ok: true, from: "archive" });
      expect(hits).toEqual(["/download/c/a%20b.mp3", "/1/items/c/a%20b.mp3"]);
    } finally {
      server.close();
    }
  });
});
