#!/usr/bin/env node
/**
 * Is the mirror answering, as a browser would see it? scripts/deploy-mirror.sh
 * runs this against https://highdesert.space after installing, and rolls back
 * on a non-zero exit. test/nginx.test.mjs runs it against the test nginx, so
 * the deploy's own check is known to pass on a working mirror and — the
 * mutations in scripts/mutate-check.mjs — to fail on a broken one.
 *
 *   node verify.mjs <site> [--index episodes.json]
 *
 * Checks: the manifest (200, its shape, at least one pin) and a 304 for its
 * ETag; a pinned episode's first 4 KiB (206, exact Content-Range) and a range
 * past its end (416); an unpinned episode's first 4 KiB, which is a fill from
 * archive.org (206); its magnet link; and an unknown fileHash (404).
 *
 * The fill needs archive.org. If it fails *and* archive.org is not answering
 * from here either, that is reported and does not fail the check: a deploy
 * during an outage is exactly when the pins matter, and rolling back would
 * not bring archive.org back.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

async function archiveAnswers() {
  try {
    const res = await fetch("https://archive.org/", { method: "HEAD", signal: AbortSignal.timeout(10_000) });
    return res.status < 500;
  } catch {
    return false;
  }
}

export async function verifyMirror(site, index, { archiveUp = archiveAnswers, timeoutMs = 30_000 } = {}) {
  const lines = [];
  let ok = true;
  const pass = (m) => lines.push(`ok    ${m}`);
  const fail = (m) => {
    ok = false;
    lines.push(`FAIL  ${m}`);
  };
  const get = (p, headers = {}) => fetch(new URL(p, site), { headers, signal: AbortSignal.timeout(timeoutMs) });
  const ep = (fh, prefix = "/mirror/") => `${prefix}${encodeURIComponent(fh)}`;

  let manifest;
  try {
    const res = await get("/mirror/manifest");
    const body = await res.json();
    if (res.status !== 200 || !Array.isArray(body.fileHashes) || typeof body.version !== "string") {
      fail(`manifest: HTTP ${res.status}`);
    } else if (body.fileHashes.length === 0) {
      fail("manifest: no pinned episodes");
    } else {
      manifest = body;
      pass(`manifest: ${body.count} pinned (${body.version})`);
      const etag = res.headers.get("etag");
      const again = etag ? await get("/mirror/manifest", { "if-none-match": etag }) : null;
      if (again?.status === 304) pass("manifest: 304 for its ETag");
      else fail(`manifest: ETag ${etag} → HTTP ${again?.status}, expected 304`);
    }
  } catch (err) {
    fail(`manifest: ${err.message}`);
  }

  if (manifest) {
    const fh = manifest.fileHashes[0];
    const len = index[fh]?.length;
    const r = await get(ep(fh), { range: "bytes=0-4095" }).catch((e) => ({ status: e.message, headers: new Headers() }));
    const body = r.arrayBuffer ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
    if (r.status === 206 && r.headers.get("content-range") === `bytes 0-4095/${len}` && body.length === 4096) {
      pass(`pinned 206: ${fh}`);
    } else {
      fail(`pinned: HTTP ${r.status} ${r.headers.get("content-range")} (${body.length} bytes), expected 206 bytes 0-4095/${len}`);
    }
    const past = await get(ep(fh), { range: `bytes=${len}-` }).catch((e) => ({ status: e.message }));
    if (past.status === 416) pass("pinned 416 past the end");
    else fail(`past the end: HTTP ${past.status}, expected 416`);
  }

  const held = new Set(manifest?.fileHashes ?? []);
  const unpinned = Object.keys(index).find((fh) => !held.has(fh));
  if (unpinned) {
    const r = await get(ep(unpinned), { range: "bytes=0-4095" }).catch((e) => ({ status: e.message, headers: new Headers() }));
    const body = r.arrayBuffer ? Buffer.from(await r.arrayBuffer()) : Buffer.alloc(0);
    if (r.status === 206 && body.length === 4096) {
      pass(`unpinned 206 (filled): ${unpinned}`);
    } else if (!(await archiveUp())) {
      lines.push(`warn  unpinned: HTTP ${r.status}, but archive.org is not answering from here either — not a mirror fault`);
    } else {
      fail(`unpinned: HTTP ${r.status} (${body.length} bytes), expected a 206 fill from archive.org`);
    }
    const mag = await get(ep(unpinned, "/mirror/magnet/")).catch((e) => ({ status: e.message }));
    const m = mag.status === 200 ? await mag.json() : null;
    if (m?.magnet?.startsWith(`magnet:?xt=urn:btih:${index[unpinned].infohash}`)) pass("magnet link");
    else fail(`magnet: HTTP ${mag.status}`);
  }

  const unknown = await get(ep("archive:not-a-collection:not-an-episode.mp3")).catch((e) => ({ status: e.message }));
  if (unknown.status === 404) pass("unknown fileHash 404");
  else fail(`unknown fileHash: HTTP ${unknown.status}, expected 404`);

  return { ok, lines };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const site = process.argv[2] ?? "https://highdesert.space";
  const i = process.argv.indexOf("--index");
  const index = JSON.parse(await readFile(i > 0 ? process.argv[i + 1] : path.join(here, "episodes.json"), "utf8"));
  const { ok, lines } = await verifyMirror(site, index);
  for (const l of lines) console.log(`[verify] ${l}`);
  process.exit(ok ? 0 : 1);
}
