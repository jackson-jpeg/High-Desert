// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { renderMirrorNginx } from "../lib/nginx.mjs";
import { writeManifest } from "../lib/pins.mjs";
import { buildCatalog } from "../build-static.mjs";
import { verifyMirror } from "../verify.mjs";
import { fixtureMp3, torrentOf } from "./fixtures.mjs";

/**
 * The mirror as production runs it: a real nginx, started from the config
 * lib/nginx.mjs renders, with only the paths and the upstream moved. A stub
 * HTTP server stands in for archive.org — including the 302 from /download to
 * a storage node — and records every request, so "served from disk" and
 * "served from cache" are observed as *no request reached archive.org*, not
 * inferred from a header nginx chose to send.
 *
 * Ports the range/416 meaning of the torrent gateway's tests (which this
 * replaced) onto both paths: a pinned file off disk and a filled one.
 */

const NGINX = process.env.NGINX_BIN ?? "/usr/sbin/nginx";
const HAVE_NGINX = existsSync(NGINX);

// Names with the characters the real catalog has: spaces, $, #, ', [ ], ( ), commas.
const COLL = "fixture-coll";
const PINNED_NAME = "1995-08-21 - Coast to Coast AM - $95,000 Junk Mail #2 [h1] (Art's).mp3";
const FILLED_NAME = "1997-05-26 - Coast to Coast AM - Open Lines, Ramona's UFO #3 [x].mp3";
const ROGUE_NAME = "1998-01-01 - Coast to Coast AM - Redirects elsewhere.mp3";
const fh = (name) => `archive:${COLL}:${name}`;

const PINNED = fixtureMp3(1); // on our disk
const PINNED_UPSTREAM = fixtureMp3(99, 3200); // what archive.org would say for the same name: must never be served
const FILLED = fixtureMp3(2, 3300); // ~1.38 MB: crosses the 1 MiB slice boundary
const ROGUE = fixtureMp3(3, 100);

let tmp, stub, stubHits, nginx, base, index, manifestBody;

async function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** archive.org, in miniature: /download → 302 → /node, which answers byte ranges. */
function startStub() {
  const files = new Map([
    [PINNED_NAME, PINNED_UPSTREAM],
    [FILLED_NAME, FILLED],
    [ROGUE_NAME, ROGUE],
  ]);
  stubHits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://stub");
    const p = decodeURIComponent(url.pathname);
    stubHits.push({ path: p, range: req.headers.range ?? null, headers: req.headers });
    const dl = new RegExp(`^/download/${COLL}/(.+)$`).exec(p);
    if (dl) {
      const port = server.address().port;
      const to = dl[1] === ROGUE_NAME ? `http://127.0.0.2:${port}/evil/${url.pathname.split("/").pop()}` : `http://127.0.0.1:${port}/node/${COLL}/${url.pathname.split("/").pop()}`;
      res.writeHead(302, { location: to });
      return res.end();
    }
    const node = new RegExp(`^/node/${COLL}/(.+)$`).exec(p);
    const body = node && files.get(node[1]);
    if (!body) {
      res.writeHead(404);
      return res.end();
    }
    const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? "");
    if (!m) {
      res.writeHead(200, { "content-type": "audio/mpeg", "content-length": body.length, "set-cookie": "tracker=1" });
      return res.end(body);
    }
    const start = Number(m[1]);
    const end = Math.min(m[2] === "" ? body.length - 1 : Number(m[2]), body.length - 1);
    if (start >= body.length) {
      res.writeHead(416, { "content-range": `bytes */${body.length}` });
      return res.end();
    }
    res.writeHead(206, {
      "content-type": "audio/mpeg",
      "content-range": `bytes ${start}-${end}/${body.length}`,
      "content-length": end - start + 1,
    });
    res.end(body.subarray(start, end + 1));
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function waitFor(url, ms = 10_000) {
  const until = Date.now() + ms;
  for (;;) {
    try {
      await fetch(url);
      return;
    } catch {
      if (Date.now() > until) throw new Error(`nginx never answered ${url}`);
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

async function setup() {
  tmp = await mkdtemp(path.join(tmpdir(), "hd-nginx-"));
  await chmod(tmp, 0o755);
  const stateDir = path.join(tmp, "state");
  const torrentDir = path.join(tmp, "torrents");
  for (const d of [stateDir, torrentDir, path.join(stateDir, "pins"), path.join(tmp, "logs"), path.join(tmp, "temp")]) {
    await mkdir(d, { recursive: true });
  }
  stub = await startStub();
  const up = `http://127.0.0.1:${stub.address().port}`;

  index = {};
  for (const [name, bytes] of [[PINNED_NAME, PINNED], [FILLED_NAME, FILLED], [ROGUE_NAME, ROGUE]]) {
    const t = await torrentOf(name, bytes, `https://archive.org/download/${COLL}/${encodeURIComponent(name)}`);
    await writeFile(path.join(torrentDir, `${t.infohash}.torrent`), t.buf);
    index[fh(name)] = { infohash: t.infohash, length: t.length, pieceLength: t.parsed.pieceLength };
  }
  await buildCatalog({ index, torrentDir, outDir: path.join(stateDir, "catalog") });
  await writeFile(path.join(stateDir, "pins", fh(PINNED_NAME)), PINNED);
  manifestBody = await writeManifest({ stateDir, index });

  const { http: httpConf, locations } = renderMirrorNginx({
    stateDir,
    cacheDir: path.join(tmp, "cache"),
    fillSocket: path.join(tmp, "fill.sock"),
    upstream: up,
    followPattern: "^http://127\\.0\\.0\\.1:[0-9]+/node/",
  });
  await writeFile(path.join(tmp, "http.conf"), httpConf);
  await writeFile(path.join(tmp, "locations.conf"), locations);
  const port = await freePort();
  const T = path.join(tmp, "temp");
  await writeFile(
    path.join(tmp, "nginx.conf"),
    `daemon off;
worker_processes 1;
pid ${tmp}/nginx.pid;
error_log ${tmp}/logs/error.log info;
${userInfo().uid === 0 ? "user root;" : ""}
events { worker_connections 128; }
http {
    access_log ${tmp}/logs/access.log;
    client_body_temp_path ${T}/body;
    proxy_temp_path ${T}/proxy;
    fastcgi_temp_path ${T}/fastcgi;
    uwsgi_temp_path ${T}/uwsgi;
    scgi_temp_path ${T}/scgi;
    include ${tmp}/http.conf;
    server {
        listen 127.0.0.1:${port};
        include ${tmp}/locations.conf;
        location / { return 404; }
    }
}
`,
  );
  nginx = spawn(NGINX, ["-p", `${tmp}/`, "-e", `${tmp}/logs/error.log`, "-c", `${tmp}/nginx.conf`], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  nginx.stderr.on("data", (d) => (stderr += d));
  const exited = new Promise((resolve) => nginx.once("exit", (code) => resolve(code)));
  base = `http://127.0.0.1:${port}`;
  await Promise.race([
    waitFor(`${base}/`),
    exited.then(async (code) => {
      const log = await readFile(`${tmp}/logs/error.log`, "utf8").catch(() => "");
      throw new Error(`nginx exited ${code}: ${stderr}\n${log}`);
    }),
  ]);
}

const url = (fileHash, prefix = "/mirror/") => `${base}${prefix}${encodeURIComponent(fileHash)}`;

async function get(u, headers = {}) {
  const res = await fetch(u, { headers });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
}

const hitsFor = (name) => stubHits.filter((h) => h.path.endsWith(name));

if (!HAVE_NGINX && process.env.CI) {
  describe("the mirror's nginx config", () => {
    it(`needs nginx at ${NGINX} in CI`, () => {
      expect.fail(`${NGINX} is missing: this suite is the only test of the mirror's serving path`);
    });
  });
}

describe.skipIf(!HAVE_NGINX)("the mirror, served by a real nginx", () => {
  beforeAll(setup, 30_000);
  afterAll(async () => {
    if (nginx && nginx.exitCode === null) {
      const gone = new Promise((r) => nginx.once("exit", r));
      nginx.kill("SIGQUIT");
      await gone;
    }
    await new Promise((r) => (stub ? stub.close(r) : r()));
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  describe("a pinned episode comes off our disk", () => {
    const U = () => url(fh(PINNED_NAME));

    it("bytes=0- → 206, the whole file, a correct Content-Range — and archive.org is never asked", async () => {
      const r = await get(U(), { range: "bytes=0-" });
      expect(r.status).toBe(206);
      expect(r.headers.get("content-range")).toBe(`bytes 0-${PINNED.length - 1}/${PINNED.length}`);
      expect(r.headers.get("content-type")).toBe("audio/mpeg");
      expect(Number(r.headers.get("content-length"))).toBe(PINNED.length);
      expect(r.body.equals(PINNED)).toBe(true);
      expect(hitsFor(PINNED_NAME)).toEqual([]);
    });

    it("a mid-file range → exactly those bytes", async () => {
      const a = 600_001;
      const b = 700_123;
      const r = await get(U(), { range: `bytes=${a}-${b}` });
      expect(r.status).toBe(206);
      expect(r.headers.get("content-range")).toBe(`bytes ${a}-${b}/${PINNED.length}`);
      expect(r.body.equals(PINNED.subarray(a, b + 1))).toBe(true);
    });

    it("a suffix range → the last N bytes", async () => {
      const r = await get(U(), { range: "bytes=-500" });
      expect(r.status).toBe(206);
      expect(r.body.equals(PINNED.subarray(PINNED.length - 500))).toBe(true);
    });

    it("a range past the end → 416 with bytes */length", async () => {
      const r = await get(U(), { range: `bytes=${PINNED.length}-` });
      expect(r.status).toBe(416);
      expect(r.headers.get("content-range")).toBe(`bytes */${PINNED.length}`);
    });

    it("no Range → 200, the whole file, advertising byte ranges", async () => {
      const r = await get(U());
      expect(r.status).toBe(200);
      expect(r.headers.get("accept-ranges")).toBe("bytes");
      expect(r.body.equals(PINNED)).toBe(true);
      expect(hitsFor(PINNED_NAME)).toEqual([]);
    });
  });

  describe("an unpinned episode is filled from archive.org through the cache", () => {
    const U = () => url(fh(FILLED_NAME));
    // Straddles the 1 MiB slice boundary: two slices, two upstream ranges.
    const A = 1_048_000;
    const B = 1_049_999;

    it("a range → 206 with the right bytes, fetched by following archive.org's 302", async () => {
      const r = await get(U(), { range: `bytes=${A}-${B}`, cookie: "session=listener-secret", "x-forwarded-for": "203.0.113.9" });
      expect(r.status).toBe(206);
      expect(r.headers.get("content-range")).toBe(`bytes ${A}-${B}/${FILLED.length}`);
      expect(r.body.equals(FILLED.subarray(A, B + 1))).toBe(true);
      const hits = hitsFor(FILLED_NAME);
      expect(hits.some((h) => h.path.startsWith(`/download/${COLL}/`))).toBe(true);
      const node = hits.filter((h) => h.path.startsWith(`/node/${COLL}/`));
      expect(node.map((h) => h.range).sort()).toEqual(["bytes=0-1048575", "bytes=1048576-2097151"]);
      // Nothing of the listener reaches archive.org.
      for (const h of hits) {
        expect(h.headers.cookie).toBeUndefined();
        expect(h.headers["x-forwarded-for"]).toBeUndefined();
        expect(h.headers["user-agent"]).toMatch(/^highdesert\.space mirror/);
      }
    });

    it("the same range again, and another inside the same slices, come from the cache: archive.org is not asked again", async () => {
      const before = hitsFor(FILLED_NAME).length;
      const again = await get(U(), { range: `bytes=${A}-${B}` });
      expect(again.body.equals(FILLED.subarray(A, B + 1))).toBe(true);
      const other = await get(U(), { range: "bytes=10-20000" });
      expect(other.status).toBe(206);
      expect(other.body.equals(FILLED.subarray(10, 20001))).toBe(true);
      expect(hitsFor(FILLED_NAME).length).toBe(before);
    });

    it("the whole file, without Range → 200 and every byte", async () => {
      const r = await get(U());
      expect(r.status).toBe(200);
      expect(r.body.equals(FILLED)).toBe(true);
    });

    it("a range past the end → 416 with bytes */length", async () => {
      const r = await get(U(), { range: `bytes=${FILLED.length}-` });
      expect(r.status).toBe(416);
      expect(r.headers.get("content-range")).toBe(`bytes */${FILLED.length}`);
    });

    it("a redirect anywhere but a storage node is refused (502), not followed", async () => {
      const r = await get(url(fh(ROGUE_NAME)), { range: "bytes=0-99" });
      expect(r.status).toBe(502);
      expect(stubHits.some((h) => h.path.startsWith("/evil/"))).toBe(false);
    });
  });

  describe("only catalog episodes: not an open proxy", () => {
    it.each([
      ["an unknown file in the catalog's collection", `/mirror/${encodeURIComponent(fh("1999-01-01 - Not in the catalog.mp3"))}`],
      ["another collection", `/mirror/${encodeURIComponent("archive:someone-elses-item:big.iso")}`],
      ["a path that tries to climb", `/mirror/${encodeURIComponent("archive:x:..%2F..%2Fetc%2Fpasswd")}`],
      ["a slash in the file name", `/mirror/archive:${COLL}:a/b.mp3`],
      ["anything else under /mirror/", "/mirror/health"],
    ])("%s → 404, and archive.org never sees it", async (_label, p) => {
      const before = stubHits.length;
      const r = await get(`${base}${p}`);
      expect(r.status).toBe(404);
      expect(stubHits.length).toBe(before);
    });

    it("only GET (and HEAD): a POST is refused before the fill", async () => {
      const before = stubHits.length;
      const res = await fetch(url(fh(FILLED_NAME)), { method: "POST", body: "x" });
      expect(res.status).toBe(403);
      expect(stubHits.length).toBe(before);
    });
  });

  describe("GET /mirror/manifest", () => {
    it("is the pinned set, as JSON, with an ETag", async () => {
      const res = await fetch(`${base}/mirror/manifest`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json");
      expect(res.headers.get("etag")).toBeTruthy();
      expect(res.headers.get("cache-control")).toBe("max-age=60");
      const m = await res.json();
      expect(m).toEqual(manifestBody);
      expect(m.fileHashes).toEqual([fh(PINNED_NAME)]);
      expect(m.count).toBe(1);
      expect(m.pinned).toBe(1);
    });

    it("answers 304 to the ETag a client echoes back verbatim (src/services/mirror/manifest.ts)", async () => {
      const first = await fetch(`${base}/mirror/manifest`);
      const etag = first.headers.get("etag");
      const again = await fetch(`${base}/mirror/manifest`, { headers: { "if-none-match": etag } });
      expect(again.status).toBe(304);
      const stale = await fetch(`${base}/mirror/manifest`, { headers: { "if-none-match": '"not-it"' } });
      expect(stale.status).toBe(200);
    });
  });

  describe("GET /mirror/magnet/{fileHash}", () => {
    it("→ the episode's magnet: its infohash, its name and the archive.org webseed", async () => {
      const res = await fetch(url(fh(FILLED_NAME), "/mirror/magnet/"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json");
      const { magnet, infohash } = await res.json();
      expect(infohash).toBe(index[fh(FILLED_NAME)].infohash);
      expect(magnet).toMatch(new RegExp(`^magnet:\\?xt=urn:btih:${infohash}&dn=`));
      expect(decodeURIComponent(magnet)).toContain(FILLED_NAME);
      expect(decodeURIComponent(magnet)).toContain(`ws=https://archive.org/download/${COLL}/`);
    });

    it("an unknown episode → 404", async () => {
      const res = await fetch(url(fh("nope.mp3"), "/mirror/magnet/"));
      expect(res.status).toBe(404);
    });
  });

  describe("scripts/deploy-mirror.sh's verification (verify.mjs)", () => {
    it("passes every check on this mirror: manifest + 304, pinned 206 + 416, unpinned fill, magnet, unknown 404", async () => {
      const { ok, lines } = await verifyMirror(base, index, { archiveUp: async () => true });
      expect(lines.filter((l) => !l.startsWith("ok"))).toEqual([]);
      expect(ok).toBe(true);
      expect(lines).toHaveLength(7);
    });

    it("fails when an unpinned episode cannot be served while archive.org is up", async () => {
      // An index that claims more than the catalog directory holds: the
      // mirror (rightly) 404s the extra one, and the check must say so.
      const extra = { ...index, "archive:fixture-coll:0000 Only in the index.mp3": { infohash: "f".repeat(40), length: 10 } };
      const first = Object.keys(extra).sort()[0];
      expect(first).toBe("archive:fixture-coll:0000 Only in the index.mp3");
      const reordered = Object.fromEntries([[first, extra[first]], ...Object.entries(index)]);
      const { ok, lines } = await verifyMirror(base, reordered, { archiveUp: async () => true });
      expect(ok).toBe(false);
      expect(lines.some((l) => l.startsWith("FAIL  unpinned"))).toBe(true);
    });
  });
});
