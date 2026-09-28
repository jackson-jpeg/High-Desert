#!/usr/bin/env node
/**
 * Measures an episode's real runtime by walking every MPEG frame of the file,
 * streamed from archive.org (or read from a local path) and never saved.
 *
 * Why (docs/ios-stalls.md, "The catalog's durations"): seven files carry a
 * LAME "Info" tag written for a shorter recording than the file now holds
 * (the tag's frame and byte counts stop early; the file runs on). archive.org
 * derived its `length` from the tag, the catalog copied it, and the live
 * station schedules by the catalog's duration: 1999-01-25 was catalogued at
 * 18.39 s for a two-and-a-half hour broadcast. A tag cannot be trusted to
 * correct a tag, so this counts the frames themselves.
 *
 *   node scripts/measure-duration.mjs <url-or-path> [...]   # prints JSON lines
 *
 * Read-only. Run it niced (it is a byte walk, not a decode).
 */
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";

const BR = {
  1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** Layer III frame header at b[i], or null. */
export function frameAt(b, i) {
  if (i + 4 > b.length || b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) return null;
  const ver = (b[i + 1] >> 3) & 3;
  const layer = (b[i + 1] >> 1) & 3;
  if (ver === 1 || layer !== 1) return null;
  const bri = b[i + 2] >> 4;
  const sri = (b[i + 2] >> 2) & 3;
  if (bri === 0 || bri === 15 || sri === 3) return null;
  const br = BR[ver === 3 ? 1 : 2][bri] * 1000;
  const sr = SR[ver][sri];
  const spf = ver === 3 ? 1152 : 576;
  return { br, sr, spf, len: Math.floor(((spf / 8) * br) / sr) + ((b[i + 2] >> 1) & 1) };
}

/**
 * A frame walker fed in chunks. A frame counts only when the next one follows
 * it exactly (or it ends the input), so bytes that happen to look like a sync
 * word inside a tag or junk are not counted as audio.
 */
export function createWalker() {
  let carry = Buffer.alloc(0);
  let skip = 0; // ID3v2 bytes still to pass
  let started = false;
  let junk = false;
  const st = { frames: 0, seconds: 0, bytes: 0, resyncs: 0, bitrates: new Set(), sampleRates: new Set() };

  function push(chunk, final = false) {
    let b = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    let i = 0;
    if (!started) {
      if (b.length < 10 && !final) { carry = b; return; }
      started = true;
      if (b.toString("latin1", 0, 3) === "ID3") {
        skip = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]) + (b[5] & 0x10 ? 10 : 0);
      }
    }
    if (skip) {
      const n = Math.min(skip, b.length);
      skip -= n;
      i = n;
    }
    while (i + 4 <= b.length) {
      // A trailing ID3v1 tag (128 bytes) is not audio and not junk. Near the
      // end of what has arrived, wait: more bytes will show whether it ends the file.
      if (b.length - i <= 128 && b.toString("latin1", i, i + 3) === "TAG") break;
      const f = frameAt(b, i);
      if (f) {
        const next = i + f.len;
        if (next > b.length) break; // a partial frame: wait for more, or (final) drop it
        if (next + 4 > b.length && !final) break; // the next header is not here yet
        // Confirmed by the frame after it, the ID3v1 tag, or the end of the
        // file. Once in step (the previous frame counted and led here), the
        // header alone is enough: the last frame before a splice counts too.
        const ends = next + 4 > b.length || b.toString("latin1", next, next + 3) === "TAG";
        const inStep = st.frames > 0 && !junk;
        if (ends || inStep || frameAt(b, next)) {
          st.frames++;
          st.seconds += f.spf / f.sr;
          st.bytes += f.len;
          st.bitrates.add(f.br / 1000);
          st.sampleRates.add(f.sr);
          junk = false;
          i = next;
          continue;
        }
      }
      if (st.frames && !junk) st.resyncs++; // one per run of junk, not per byte
      junk = true;
      i++;
    }
    carry = b.subarray(i);
  }

  return {
    push,
    end() {
      push(Buffer.alloc(0), true);
      return {
        frames: st.frames,
        // Includes the tag frame, which is a silent frame of the same size:
        // players count it too, and it is one frame (~26 ms at worst).
        seconds: Math.round(st.seconds * 100) / 100,
        audioBytes: st.bytes,
        resyncs: st.resyncs,
        bitrates: [...st.bitrates].sort((a, b) => a - b),
        sampleRates: [...st.sampleRates].sort((a, b) => a - b),
      };
    },
  };
}

async function measure(src) {
  const w = createWalker();
  if (/^https?:/.test(src)) {
    const res = await fetch(src, { headers: { "user-agent": "HighDesert-duration-audit/1 (highdesert.space)" } });
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    for await (const chunk of res.body) w.push(Buffer.from(chunk));
  } else {
    for await (const chunk of createReadStream(src)) w.push(chunk);
  }
  return w.end();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const src of process.argv.slice(2)) {
    try {
      console.log(JSON.stringify({ src, ...(await measure(src)) }));
    } catch (err) {
      console.log(JSON.stringify({ src, error: String(err?.message ?? err) }));
    }
  }
}
