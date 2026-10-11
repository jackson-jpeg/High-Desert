#!/usr/bin/env node
/**
 * Re-encodes one catalog episode whose archive.org file changes stream
 * configuration midstream, to one channel layout and one sample rate, and
 * installs the copy where the mirror serves it ahead of everything else:
 * `<stateDir>/repaired/<fileHash>` (services/mirror/lib/nginx.mjs). The
 * original on archive.org is never touched; its size, digest and segments
 * are recorded beside the copy's in src/data/repaired-episodes.json, which the
 * player (src/audio/sources.ts: a repaired show plays from the mirror only),
 * the mirror's manifest and pinning (services/mirror/lib/pins.mjs) and the
 * station's pre-air check all read.
 *
 * Why (docs/broken-episodes.md): every Chromium engine refuses a midstream
 * change of channels or sample rate ("Unsupported midstream configuration
 * change"), and an MPEG Layer III frame cannot be rewritten to another layout
 * without decoding it. So this is lossy, once, and only for files the frame
 * walk has shown to be broken. Mono is right for AM talk radio.
 *
 *   node scripts/repair-episode.mjs <fileHash> [--kbps 64] [--rate 44100] [--channels 1] [--state DIR] [--dry-run]
 *
 * Run it niced, under heavy (an ffmpeg encode of a three-hour show).
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile, chown } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWalker } from "./measure-duration.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RECORD = path.join(ROOT, "src/data/repaired-episodes.json");
const UA = "HighDesert-repair/1 (highdesert.space)";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
}

/** Bytes, sha256 and the frame walk of a file on disk, in one read. */
export async function examine(file) {
  const w = createWalker();
  const h = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(file)) {
    w.push(chunk);
    h.update(chunk);
    bytes += chunk.length;
  }
  const r = w.end();
  return { bytes, sha256: h.digest("hex"), seconds: r.seconds, frames: r.frames, bitrates: r.bitrates, segments: r.segments };
}

/**
 * The copy is acceptable only as one configuration throughout, the layout
 * asked for, and the same broadcast: within two seconds of the original's
 * frame-counted runtime.
 */
export function acceptRepair(original, copy, { rate, channels }) {
  const problems = [];
  if (copy.segments.length !== 1) problems.push(`${copy.segments.length} configurations`);
  const seg = copy.segments[0];
  if (seg && seg.sampleRate !== rate) problems.push(`sample rate ${seg.sampleRate}, wanted ${rate}`);
  if (seg && seg.mono !== (channels === 1)) problems.push(`mono=${seg.mono}, wanted channels=${channels}`);
  if (Math.abs(copy.seconds - original.seconds) > 2) problems.push(`runtime ${copy.seconds}s against the original's ${original.seconds}s`);
  return problems;
}

async function main() {
  const fileHash = process.argv[2];
  if (!fileHash?.startsWith("archive:")) throw new Error("usage: repair-episode.mjs <fileHash> [--kbps 64] [--rate 44100] [--channels 1]");
  const kbps = Number(arg("--kbps", "64"));
  const rate = Number(arg("--rate", "44100"));
  const channels = Number(arg("--channels", "1"));
  const stateDir = arg("--state", "/var/lib/highdesert-mirror");
  const dry = process.argv.includes("--dry-run");

  const catalog = JSON.parse(await readFile(path.join(ROOT, "public/seed/library.json"), "utf8"));
  const row = catalog.find((r) => r.fileHash === fileHash);
  if (!row) throw new Error(`${fileHash} is not in the catalog (restore it first: docs/broken-episodes.md)`);

  const work = path.join(stateDir, "tmp", `repair-${process.pid}`);
  await mkdir(work, { recursive: true, mode: 0o700 });
  const orig = path.join(work, "original.mp3");
  const out = path.join(work, "repaired.mp3");
  try {
    // The original, byte for byte as archive.org serves it: a pin if there is one.
    const pin = path.join(stateDir, "pins", fileHash);
    const pinned = await stat(pin).then((s) => s.isFile(), () => false);
    if (pinned) {
      await pipeline(createReadStream(pin), createWriteStream(orig));
    } else {
      const res = await fetch(row.sourceUrl, { headers: { "user-agent": UA } });
      if (!res.ok) throw new Error(`${row.sourceUrl}: HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(orig));
    }
    const original = await examine(orig);
    if (row.fileSize && original.bytes !== row.fileSize) throw new Error(`original is ${original.bytes} bytes, catalog says ${row.fileSize}`);
    console.error(`[repair] original: ${original.bytes} bytes, ${original.seconds}s, ${original.segments.length} configurations`);

    // Decode everything, downmix and resample to one layout, encode CBR.
    // aresample=async=1 keeps time continuous across the configuration change.
    const args = [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-i", orig,
      "-map", "0:a:0", "-map_metadata", "0",
      "-af", `aresample=${rate}:async=1`,
      "-ac", String(channels), "-ar", String(rate),
      "-c:a", "libmp3lame", "-b:a", `${kbps}k`,
      "-id3v2_version", "3", "-write_xing", "1",
      out,
    ];
    execFileSync("ffmpeg", args, { stdio: ["ignore", "inherit", "inherit"] });
    const copy = await examine(out);
    const problems = acceptRepair(original, copy, { rate, channels });
    if (problems.length) throw new Error(`the copy is not acceptable: ${problems.join("; ")}`);
    console.error(`[repair] copy: ${copy.bytes} bytes, ${copy.seconds}s, one configuration`);

    const entry = {
      fileHash,
      airDate: row.airDate,
      reason: "midstream-change",
      original: { bytes: original.bytes, sha256: original.sha256, seconds: original.seconds, segments: original.segments },
      repaired: {
        bytes: copy.bytes,
        sha256: copy.sha256,
        seconds: copy.seconds,
        sampleRate: rate,
        channels,
        bitrateKbps: kbps,
        encoder: `ffmpeg ${args.map((a) => (a === orig ? "<original>" : a === out ? "<copy>" : a)).join(" ")}`,
      },
      repairedAt: new Date().toISOString().slice(0, 10),
    };
    if (dry) {
      console.log(JSON.stringify(entry, null, 2));
      return;
    }

    // Install: by rename on the same filesystem, so the name only ever holds a whole copy.
    const dir = path.join(stateDir, "repaired");
    await mkdir(dir, { recursive: true, mode: 0o755 });
    const target = path.join(dir, fileHash);
    const tmp = path.join(dir, `.${process.pid}.tmp`);
    await pipeline(createReadStream(out), createWriteStream(tmp, { mode: 0o644 }));
    try {
      const { uid, gid } = await stat(path.join(stateDir, "pins"));
      await chown(dir, uid, gid);
      await chown(tmp, uid, gid);
    } catch {
      /* a test directory */
    }
    await rename(tmp, target);

    let record = [];
    try {
      record = JSON.parse(await readFile(RECORD, "utf8"));
    } catch {
      /* first repair */
    }
    record = [...record.filter((e) => e.fileHash !== fileHash), entry].sort((a, b) => (a.fileHash < b.fileHash ? -1 : 1));
    await writeFile(RECORD, JSON.stringify(record, null, 2) + "\n");
    console.log(JSON.stringify({ installed: target, ...entry.repaired }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`[repair] ${err.message ?? err}`);
    process.exit(1);
  });
}
