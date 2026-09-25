#!/usr/bin/env node
/**
 * Everything nginx needs for the mirror that is not an episode, generated
 * from the committed index (data/torrents/episodes.json) and the .torrent
 * files. Run by scripts/deploy-mirror.sh into staging directories, which it
 * then swaps in.
 *
 *   node build-static.mjs --catalog <dir> [--nginx <dir>] [--index <episodes.json>] [--torrents <dir>]
 *
 *   <catalog>/<fileHash>   one per catalog episode: `{infohash, magnet}`, served
 *                          as /mirror/magnet/{fileHash}. Its existence is also
 *                          the allowlist for /mirror/{fileHash} (lib/nginx.mjs).
 *   <nginx>/http.conf, <nginx>/locations.conf
 *                          lib/nginx.mjs with the production parameters.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseTorrent } from "./lib/torrent-file.mjs";
import { magnetFor } from "./lib/magnet.mjs";
import { isPinnableName } from "./lib/pins.mjs";
import { renderMirrorNginx } from "./lib/nginx.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Write the catalog directory. Refuses (throws) on a missing torrent or an unusable fileHash. */
export async function buildCatalog({ index, torrentDir, outDir }) {
  await mkdir(outDir, { recursive: true, mode: 0o755 });
  let n = 0;
  for (const [fileHash, e] of Object.entries(index)) {
    if (!isPinnableName(fileHash)) throw new Error(`fileHash cannot be a file name: ${fileHash}`);
    const t = parseTorrent(await readFile(path.join(torrentDir, `${e.infohash}.torrent`)));
    if (t.infohash !== e.infohash) throw new Error(`${e.infohash}.torrent has infohash ${t.infohash}`);
    const body = { infohash: e.infohash, magnet: magnetFor({ infohash: e.infohash, name: t.name, webseed: t.urlList[0] }) };
    await writeFile(path.join(outDir, fileHash), JSON.stringify(body) + "\n", { mode: 0o644 });
    n++;
  }
  return n;
}

export async function writeNginx({ outDir, ...opts }) {
  await mkdir(outDir, { recursive: true });
  const { http, locations } = renderMirrorNginx(opts);
  await writeFile(path.join(outDir, "http.conf"), http, { mode: 0o644 });
  await writeFile(path.join(outDir, "locations.conf"), locations, { mode: 0o644 });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (k) => {
    const i = process.argv.indexOf(k);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  const index = JSON.parse(await readFile(arg("--index") ?? path.join(here, "episodes.json"), "utf8"));
  const catalog = arg("--catalog");
  if (catalog) {
    const n = await buildCatalog({ index, torrentDir: arg("--torrents") ?? "/var/lib/highdesert-mirror/torrents", outDir: catalog });
    console.log(`[build-static] ${n} catalog entries in ${catalog}`);
  }
  const nginx = arg("--nginx");
  if (nginx) {
    await writeNginx({ outDir: nginx });
    console.log(`[build-static] nginx includes in ${nginx}`);
  }
}
