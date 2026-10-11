#!/usr/bin/env node
/**
 * Each catalog collection's own storage servers, from archive.org's metadata
 * API (`d1`, `d2`, `dir`), written to data/archive-items.json.
 *
 * Why (2026-10-11): from about 15:45 UTC archive.org's /download for this
 * catalog redirected every caller (the VPS and a home connection alike) to
 * one cache node, dn720703.ca.archive.org, which answered 500 or 502, and
 * /download itself answered 502 for many files. 1 of 20 sampled shows played.
 * The item's own servers (ia800503 and ia600503) served the same files at
 * once. The mirror's fill (services/mirror/lib/nginx.mjs) and the scripts
 * that read whole files (scan-catalog-audio, repair-episode, verify-live-day)
 * fall back to these when /download fails.
 *
 * A collection's servers rarely change; when they do, the fallback 404s and
 * nothing is worse than without it. Re-run this and commit:
 *
 *   node scripts/archive-items.mjs            # writes data/archive-items.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ITEMS = path.join(ROOT, "data/archive-items.json");

/** `{identifier: {servers: [d1, d2], dir}}` from a metadata response. */
export function itemEntry(meta) {
  const servers = [meta.d1, meta.d2].filter((s) => typeof s === "string" && /^[a-z0-9.-]+\.archive\.org$/.test(s));
  if (!servers.length || typeof meta.dir !== "string" || !/^\/[A-Za-z0-9._/-]+$/.test(meta.dir)) return null;
  return { servers, dir: meta.dir };
}

/**
 * The URLs to try for a catalog row, in order: archive.org's /download, then
 * the item's own servers. `items` is data/archive-items.json.
 */
export function archiveUrls(row, items) {
  const urls = [row.sourceUrl || row.filePath].filter(Boolean);
  const it = items?.[row.archiveIdentifier];
  if (it && row.fileName) {
    for (const s of it.servers) urls.push(`https://${s}${it.dir}/${encodeURIComponent(row.fileName)}`);
  }
  return urls;
}

export function loadItems(file = ITEMS) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

async function main() {
  const catalog = JSON.parse(readFileSync(path.join(ROOT, "public/seed/library.json"), "utf8"));
  const ids = [...new Set(catalog.map((r) => r.archiveIdentifier).filter(Boolean))].sort();
  const out = {};
  for (const id of ids) {
    // archive.org's metadata API is slow when its storage is struggling, which
    // is exactly when this is run: one small field at a time
    // (/metadata/{id}/{field}), a few patient tries each.
    const meta = {};
    for (const field of ["d1", "d2", "dir"]) {
      for (let i = 0; i < 5 && meta[field] === undefined; i++) {
        try {
          const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}/${field}`, {
            headers: { "user-agent": "HighDesert-items/1 (highdesert.space)" },
            signal: AbortSignal.timeout(60_000),
          });
          if (res.ok) meta[field] = (await res.json()).result ?? null;
        } catch {
          /* try again */
        }
        if (meta[field] === undefined) await new Promise((r) => setTimeout(r, 5_000));
      }
      if (meta[field] === undefined) throw new Error(`${id}: metadata ${field} unreachable after 5 tries`);
    }
    const e = itemEntry(meta);
    if (!e) throw new Error(`${id}: no usable d1/d2/dir in its metadata`);
    out[id] = e;
    await new Promise((r) => setTimeout(r, 500));
  }
  writeFileSync(ITEMS, JSON.stringify(out, null, 2) + "\n");
  console.log(`[archive-items] ${ids.length} collections -> ${path.relative(ROOT, ITEMS)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[archive-items] ${err.message ?? err}`);
    process.exit(1);
  });
}
