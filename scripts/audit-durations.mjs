#!/usr/bin/env node
/**
 * Does every episode in the catalog actually contain a broadcast?
 *
 * scripts/audit-episodes.mjs answers "is this file reachable and does the
 * origin serve it correctly", and for all 1,313 episodes the answer is yes.
 * That sweep still missed a file with no audio in it: 77KB of ID3 tag wrapping
 * a JPEG cover, zero MP3 frames, served with a clean 206 and the right content
 * type. Every HTTP-level check passes it. A listener presses play and gets
 * nothing, which from their side of the screen is exactly the "show won't
 * start" complaint we set out to fix.
 *
 * Metadata cannot find these either. Archive.org reports length "0" for five
 * episodes, but that is its VBR derive failing, not a claim about the audio —
 * two of those five are full three-hour shows. And the catalog's own duration
 * and fileSize never contradict each other, because both are copied from the
 * same archive.org record. There is nothing to cross-check offline.
 *
 * So this reads the audio. It pulls the first 64KB of each file and walks the
 * MP3 frame headers:
 *
 *   - zero frames        -> the file has no audio at all
 *   - frames present     -> extrapolate the full runtime from the frame rate in
 *                           the sample and compare against the catalog
 *
 * Extrapolation is only meaningful for CBR; for VBR it is an estimate, so the
 * mismatch threshold is deliberately loose (see MISMATCH_RATIO). The check that
 * matters, and the one with no false positives, is the zero-frame case.
 *
 * ~64KB x 1313 is about 84MB, versus 59GB to read every file in full.
 *
 * Read-only. Changes no data.
 *
 *   node scripts/audit-durations.mjs [--rate 3] [--limit N] [--out report.json]
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = join(__dirname, "..", "public", "seed", "library.json");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const RATE = Number(arg("rate", 3));
const LIMIT = Number(arg("limit", 0));
const OUT = arg("out", join(__dirname, "..", "duration-audit.json"));

const GAP_MS = Math.ceil(1000 / RATE);
const SAMPLE_BYTES = 65_536;
const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 30_000;

/**
 * How far the extrapolated runtime may drift from the catalog before it is
 * worth a human look. Wide, because extrapolating a VBR file from its first
 * 64KB is a genuine estimate — a show that opens on quiet speech and gets
 * louder will read short. Narrowing this would produce a list nobody trusts.
 */
const MISMATCH_RATIO = 0.5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- MPEG audio frame header tables -----------------------------------------
// Indexed [versionRow][bitrateIndex] and [versionId][sampleRateIndex].
const BITRATES = [
  [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448], // V1 L1
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384], //     V1 L2
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], //      V1 L3
  [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256], //     V2 L1
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160], //          V2 L2/L3
];
const SAMPLE_RATES = [
  [11025, 12000, 8000], // MPEG 2.5
  [0, 0, 0], // reserved
  [22050, 24000, 16000], // MPEG 2
  [44100, 48000, 32000], // MPEG 1
];

/**
 * Where the audio starts, given the first few bytes of the file.
 *
 * These rips carry cover art inside the ID3v2 tag, and the tag is routinely
 * larger than any sample worth pulling — often 100KB or more. Reading a fixed
 * window from byte zero therefore lands entirely inside the artwork, finds no
 * frames, and reports a perfectly good three-hour broadcast as empty. The first
 * version of this script did exactly that to 10 of the first 12 episodes.
 *
 * A tag's syncsafe length is the one part of it worth trusting, so read that
 * and start the sample after it.
 */
function audioOffset(head) {
  if (head.length < 10 || head.toString("latin1", 0, 3) !== "ID3") return 0;
  const size =
    (head[6] << 21) | (head[7] << 14) | (head[8] << 7) | head[9];
  if (size < 0) return 0;
  // ID3v2.4 may append a 10-byte footer, flagged in bit 4 of the flags byte.
  const footer = head[5] & 0x10 ? 10 : 0;
  return 10 + size + footer;
}

/**
 * Walk MPEG frame headers in a buffer that is already positioned at the audio.
 *
 * Deliberately does not trust a Xing/Info header: the files that matter here
 * are exactly the ones whose headers are missing or lying. Counting frames is
 * the only thing that cannot be faked by a bad tag.
 */
function walkFrames(buf) {
  let i = 0;
  let frames = 0;
  let seconds = 0;
  let audioBytes = 0;

  while (i < buf.length - 4) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
      i++;
      continue;
    }
    const versionId = (buf[i + 1] >> 3) & 3;
    const layer = (buf[i + 1] >> 1) & 3;
    const bitrateIdx = (buf[i + 2] >> 4) & 15;
    const rateIdx = (buf[i + 2] >> 2) & 3;
    const padding = (buf[i + 2] >> 1) & 1;

    if (
      versionId === 1 || // reserved
      layer === 0 || // reserved
      bitrateIdx === 0 || // "free" — unparseable
      bitrateIdx === 15 || // invalid
      rateIdx === 3 // reserved
    ) {
      i++;
      continue;
    }

    const isV1 = versionId === 3;
    const row = isV1
      ? layer === 3
        ? 0
        : layer === 2
          ? 1
          : 2
      : layer === 3
        ? 3
        : 4;
    const kbps = BITRATES[row][bitrateIdx];
    const sampleRate = SAMPLE_RATES[versionId][rateIdx];
    if (!kbps || !sampleRate) {
      i++;
      continue;
    }

    // Layer 1 is 384 samples/frame; layers 2 and 3 are 1152, halved for MPEG 2
    // and 2.5 in layer 3.
    const samples =
      layer === 3 ? 384 : isV1 || layer === 2 ? 1152 : 576;
    const frameLen =
      Math.floor(((samples / 8) * kbps * 1000) / sampleRate) + padding;
    if (frameLen < 4) {
      i++;
      continue;
    }

    frames++;
    seconds += samples / sampleRate;
    audioBytes += frameLen;
    i += frameLen;
  }

  return { frames, seconds, audioBytes };
}

async function range(url, from, to) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Range: `bytes=${from}-${to}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
      // 5xx and 429 are archive.org under load; a retry there is the documented
      // way to talk to the service, not papering over a broken file.
      if (res.status >= 500 || res.status === 429) {
        lastError = `HTTP ${res.status}`;
        await sleep(1000 * attempt * attempt);
        continue;
      }
      // 416 is not an error when we are asking for the bytes after the ID3
      // tag: it means there are none, which is the whole finding.
      if (res.status === 416) return { unsatisfiable: true };
      if (res.status !== 206 && res.status !== 200) {
        return { error: `HTTP ${res.status}` };
      }
      return { buf: Buffer.from(await res.arrayBuffer()) };
    } catch (err) {
      lastError = err.message;
      await sleep(1000 * attempt * attempt);
    }
  }
  return { error: lastError ?? "unreachable" };
}

/**
 * Pull a window of actual audio, skipping any ID3 tag.
 *
 * Costs one request when the tag is small enough that the first window already
 * contains audio, two when the artwork pushes the audio past it.
 */
async function sampleAudio(url) {
  const first = await range(url, 0, SAMPLE_BYTES - 1);
  if (first.error) return first;

  const offset = audioOffset(first.buf);
  if (offset === 0) return { buf: first.buf, offset };
  if (offset < first.buf.length) {
    return { buf: first.buf.subarray(offset), offset };
  }

  const second = await range(url, offset, offset + SAMPLE_BYTES - 1);
  if (second.error) return second;
  // Nothing exists past the tag: the file is metadata and stops. This is
  // exactly the defect this script was written to find, and reporting it as an
  // unreachable file would bury it among transient network noise — which is
  // what happened on the first full sweep.
  if (second.unsatisfiable) return { buf: Buffer.alloc(0), offset };
  return { buf: second.buf, offset };
}

const raw = JSON.parse(await readFile(SEED, "utf8"));
const all = Array.isArray(raw) ? raw : raw.episodes;
const episodes = LIMIT ? all.slice(0, LIMIT) : all;

console.log(
  `Reading the first ${(SAMPLE_BYTES / 1024) | 0}KB of ${episodes.length} episodes at ~${RATE}/sec ` +
    `(~${Math.ceil((episodes.length * GAP_MS) / 60000)} min)\n`,
);

const results = [];
const started = Date.now();

for (let n = 0; n < episodes.length; n++) {
  const ep = episodes[n];
  const t0 = Date.now();

  const row = {
    title: ep.title,
    airDate: ep.airDate,
    fileName: ep.fileName,
    sourceUrl: ep.sourceUrl,
    fileSize: ep.fileSize ?? null,
    catalogDuration: ep.duration ?? null,
    flags: [],
  };

  const { buf, offset, error } = await sampleAudio(ep.sourceUrl);
  if (error) {
    row.flags.push("unreachable");
    row.error = error;
  } else {
    const { frames, seconds, audioBytes } = walkFrames(buf);
    row.framesInSample = frames;
    row.tagBytes = offset;

    if (frames === 0) {
      // Nothing recoverable. The file is a tag, or a container we cannot read.
      row.flags.push("no-audio");
    } else if (ep.fileSize && audioBytes > 0) {
      // Scale the sample's seconds-per-audio-byte up to the audio in the file
      // — the tag is not audio and counting it would inflate every estimate,
      // most on exactly the files whose artwork is largest.
      const estimated =
        (seconds / audioBytes) * Math.max(0, ep.fileSize - offset);
      row.estimatedDuration = Math.round(estimated);

      if (estimated <= 5) {
        row.flags.push("no-audio");
      } else if (ep.duration) {
        const ratio = estimated / ep.duration;
        if (ratio < MISMATCH_RATIO || ratio > 1 / MISMATCH_RATIO) {
          row.flags.push("duration-mismatch");
          row.ratio = Number(ratio.toFixed(2));
        }
      }
    }
  }

  results.push(row);

  if (row.flags.length) {
    console.log(
      `  ✗ [${n + 1}/${episodes.length}] ${row.flags.join(",")} — ${row.title}` +
        (row.estimatedDuration != null
          ? ` (est ${row.estimatedDuration}s vs catalog ${row.catalogDuration ?? "—"}s)`
          : ""),
    );
  }
  if ((n + 1) % 200 === 0) {
    const flagged = results.filter((r) => r.flags.length).length;
    console.log(
      `  … ${n + 1}/${episodes.length} — ${results.length - flagged} ok, ${flagged} flagged ` +
        `(${((Date.now() - started) / 60000).toFixed(1)} min)`,
    );
  }

  const spent = Date.now() - t0;
  if (spent < GAP_MS) await sleep(GAP_MS - spent);
}

const flagged = results.filter((r) => r.flags.length);
const byFlag = {};
for (const r of flagged) for (const f of r.flags) byFlag[f] = (byFlag[f] ?? 0) + 1;

console.log("\n" + "─".repeat(60));
console.log(
  `checked ${results.length} · ok ${results.length - flagged.length} · flagged ${flagged.length}`,
);
for (const [f, n] of Object.entries(byFlag)) console.log(`  ${f}: ${n}`);

await writeFile(
  OUT,
  JSON.stringify(
    { generatedAt: new Date().toISOString(), counts: byFlag, results },
    null,
    2,
  ),
);
console.log(`\nreport → ${OUT}`);

// Non-zero only for files with no audio: those are catalog defects that need a
// decision. A duration mismatch is a hint for a human, not a build failure.
process.exit(byFlag["no-audio"] ? 1 : 0);
