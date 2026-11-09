#!/usr/bin/env node
/**
 * Station Breaks: render the spoken spots (docs/station-breaks.md).
 *
 *   node scripts/make-station-breaks.mjs            # every spot
 *   node scripts/make-station-breaks.mjs sogojet    # one
 *   node scripts/make-station-breaks.mjs --voice en_US-norman-medium --out /tmp/x   # audition
 *
 * Reads data/station-breaks/spots.json. For each spot: the voice (Piper, self
 * hosted, no API; or a human take at data/station-breaks/recorded/<id>.wav),
 * then ffmpeg: a short synthesized sting, the voice, an AM radio texture (band
 * limited 300 Hz to 3.2 kHz, compressed, a little soft clipping and hiss),
 * loudness to LOUDNESS_LUFS, mono MP3. Writes public/audio/breaks/<id>.mp3
 * and src/data/station-break-audio.json (durations, which the schedule's
 * timing is built from, and digests).
 *
 * Needs: ffmpeg/ffprobe, and Piper at $PIPER_BIN (default
 * ~/.local/share/hd-piper-venv/bin/piper) with voices in $PIPER_VOICES
 * (default ~/.local/share/hd-piper-voices, `<model>.onnx` + `.onnx.json`
 * from huggingface.co/rhasspy/piper-voices). Runs niced; it is a few seconds
 * of CPU per spot.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SPOTS = path.join(ROOT, "data/station-breaks/spots.json");
const RECORDED = path.join(ROOT, "data/station-breaks/recorded");
const OUT_AUDIO = path.join(ROOT, "public/audio/breaks");
const OUT_META = path.join(ROOT, "src/data/station-break-audio.json");
/** A little under the program's loudest shows; the station ID sits at about -23. */
export const LOUDNESS_LUFS = -21;
export const STING_SEC = 1.4;

const PIPER = process.env.PIPER_BIN ?? path.join(homedir(), ".local/share/hd-piper-venv/bin/piper");
const VOICES = process.env.PIPER_VOICES ?? path.join(homedir(), ".local/share/hd-piper-voices");

/** Three rising notes (E5, A5, C#6) with a soft second harmonic and a quick decay. Not any network's chime. */
export function stingExpr() {
  const notes = [
    [0, 659.25],
    [0.2, 880],
    [0.4, 1108.73],
  ];
  return notes
    .map(
      ([t0, f]) =>
        `between(t,${t0},${STING_SEC})*exp(-3.2*(t-${t0}))*(0.30*sin(2*PI*${f}*(t-${t0}))+0.08*sin(4*PI*${f}*(t-${t0})))`,
    )
    .join("+");
}

/** The AM texture, after the voice and sting are joined. */
export const AM_CHAIN = [
  "highpass=f=300:poles=2",
  "lowpass=f=3200:poles=2",
  "acompressor=threshold=0.08:ratio=4:attack=5:release=120:makeup=2",
  "asoftclip=type=tanh:param=1.2",
  "highpass=f=280",
  "lowpass=f=3400",
].join(",");

function run(cmd, args, input) {
  return execFileSync("nice", ["-n", "15", cmd, ...args], { input, stdio: ["pipe", "pipe", "pipe"] }).toString();
}

function durationOf(file) {
  return Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());
}

function voiceFor(spot, voice, work) {
  const human = path.join(RECORDED, `${spot.id}.wav`);
  if (existsSync(human)) return { file: human, by: "recorded" };
  const model = path.join(VOICES, `${voice.model}.onnx`);
  if (!existsSync(model)) throw new Error(`no Piper voice at ${model} (see the header of this script)`);
  const out = path.join(work, `${spot.id}-voice.wav`);
  run(
    PIPER,
    ["-m", model, "-f", out, "--length-scale", String(voice.lengthScale ?? 1), "--sentence-silence", String(voice.sentenceSilence ?? 0.3)],
    spot.script,
  );
  return { file: out, by: `piper ${voice.model}` };
}

function render(spot, voice, outDir, work) {
  if (/—/.test(spot.script)) throw new Error(`${spot.id}: an em dash in the script`);
  const v = voiceFor(spot, voice, work);
  const out = path.join(outDir, `${spot.id}.mp3`);
  const noise = "anoisesrc=color=pink:amplitude=0.006:sample_rate=22050";
  const graph = [
    `aevalsrc='${stingExpr()}':s=22050:d=${STING_SEC}[sting]`,
    `[0:a]aresample=22050,pan=mono|c0=c0,apad=pad_dur=0.5[v]`,
    `[sting][v]concat=n=2:v=0:a=1,${AM_CHAIN}[dry]`,
    `${noise}[hiss]`,
    `[dry][hiss]amix=inputs=2:duration=first:weights=1 1:normalize=0,loudnorm=I=${LOUDNESS_LUFS}:TP=-2:LRA=7,afade=t=in:d=0.02[out]`,
  ].join(";");
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", v.file, "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-ar", "22050", "-c:a", "libmp3lame", "-b:a", "48k", out]);
  const bytes = readFileSync(out);
  return {
    id: spot.id,
    cart: spot.cart,
    durationSec: Math.round(durationOf(out) * 100) / 100,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    voice: v.by,
    url: `/audio/breaks/${spot.id}.mp3`,
  };
}

function main() {
  const args = process.argv.slice(2);
  const cfg = JSON.parse(readFileSync(SPOTS, "utf8"));
  const voiceIdx = args.indexOf("--voice");
  const outIdx = args.indexOf("--out");
  const voice = voiceIdx >= 0 ? { ...cfg.voice, model: args[voiceIdx + 1] } : cfg.voice;
  const audition = outIdx >= 0;
  const outDir = audition ? args[outIdx + 1] : OUT_AUDIO;
  const only = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--voice" && args[i - 1] !== "--out");
  mkdirSync(outDir, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), "hd-breaks-"));
  try {
    const meta = existsSync(OUT_META) && !audition ? JSON.parse(readFileSync(OUT_META, "utf8")) : {};
    for (const spot of cfg.spots) {
      if (only.length && !only.includes(spot.id)) continue;
      const m = render(spot, voice, outDir, work);
      console.log(`${m.id}  cart ${m.cart}  ${m.durationSec}s  ${m.voice}  -> ${path.join(outDir, `${m.id}.mp3`)}`);
      if (m.durationSec > 22) console.warn(`  ${m.id}: over 22 s; shorten the script or raise the voice's pace`);
      meta[m.id] = m;
    }
    if (!audition) writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + "\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
